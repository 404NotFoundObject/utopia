import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  VERSION_URL,
  parseVersion,
  compareVersions,
  isNewerVersion,
  getLocalVersion,
  fetchRemoteVersion,
  checkForUpdate,
  getUpdateState,
  clearAppCaches,
  applyUpdate,
  showUpdateBanner,
  hideUpdateBanner,
  dismissUpdate,
  getDismissedVersion,
  startUpdateWatch,
  _resetState,
} from '../../../js/core/updateChecker.js';
import { APP_VERSION, STORAGE_VERSION_KEY, DISMISSED_UPDATE_KEY } from '../../../js/core/appMeta.js';

/**
 * 版本检测的一条主线：不依赖「已加载代码里的版本号」。
 *
 * 历史缺陷（P3-10 阶段 B）：checkAppVersion 用 APP_VERSION 比对 localStorage，
 * 而 SW 静态资源走 stale-while-revalidate、CACHE_VERSION 又常年不变 ——
 * 长期不关页面时跑的一直是旧代码，版本号同样是旧的，于是永远不提示。
 */

function mockVersionJson(payload) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => payload,
  }));
}

beforeEach(() => {
  _resetState();
  localStorage.clear();
  hideUpdateBanner();
  // 有些用例会替换 globalThis.fetch，统一在 afterEach 还原
});

afterEach(() => {
  vi.restoreAllMocks();
  hideUpdateBanner();
});

describe('版本号比较', () => {
  test('同位数递增与跨位进位都能判对（3.10.0 比 3.9.9 新）', () => {
    expect(compareVersions('3.9.5', '3.9.4')).toBe(1);
    expect(compareVersions('3.9.4', '3.9.5')).toBe(-1);
    expect(compareVersions('3.9.4', '3.9.4')).toBe(0);
    // 字符串比较会得出 3.10.0 < 3.9.9，必须走数值段
    expect(isNewerVersion('3.10.0', '3.9.9')).toBe(true);
    expect(isNewerVersion('3.9.10', '3.9.9')).toBe(true);
  });

  test('带 v 前缀、不等长、脏数据都能处理', () => {
    expect(parseVersion('v3.9.4')).toEqual([3, 9, 4]);
    expect(isNewerVersion('3.9.4.1', '3.9.4')).toBe(true);
    expect(isNewerVersion('3.9', '3.9.0')).toBe(false); // 补零后相等
    expect(isNewerVersion('', '3.9.4')).toBe(false); // 空
    expect(isNewerVersion('abc', '3.9.4')).toBe(false); // 解析不出数字不当新版本
    expect(isNewerVersion('1.0.0', APP_VERSION)).toBe(false); // 旧版本不误报
  });
});

describe('版本探测', () => {
  test('远端版本更新时报 update-available', async () => {
    const spy = mockVersionJson({ version: '9.9.9', build: '2026-10-03T00:00:00Z', channel: 'stable' });
    globalThis.fetch = spy;

    const result = await checkForUpdate();
    expect(result.status).toBe('update-available');
    expect(result.hasUpdate).toBe(true);
    expect(result.local).toBe(APP_VERSION);
    expect(result.remote).toBe('9.9.9');
    // 必须走 no-store：一旦允许缓存，就等于退回「鸡生蛋」
    const [, init] = spy.mock.calls[0];
    expect(init?.cache).toBe('no-store');
  });

  test('版本相同报 up-to-date', async () => {
    globalThis.fetch = mockVersionJson({ version: APP_VERSION });
    const result = await checkForUpdate();
    expect(result.status).toBe('up-to-date');
    expect(result.hasUpdate).toBe(false);
  });

  test('离线/文件缺失时降级为 unavailable，不抛错不打扰', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const result = await checkForUpdate();
    expect(result.status).toBe('unavailable');
    expect(result.remote).toBeNull();

    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    expect((await checkForUpdate()).status).toBe('unavailable');
  });

  test('版本文件格式不对时视为无效，不当新版本处理', async () => {
    globalThis.fetch = mockVersionJson({ foo: 'bar' });
    expect(await fetchRemoteVersion()).toBeNull();
  });

  test('并列调用共享同一个请求（设定页手点与定时检查同时发生只发一次）', async () => {
    const spy = mockVersionJson({ version: APP_VERSION });
    globalThis.fetch = spy;
    await Promise.all([checkForUpdate(), checkForUpdate()]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('状态与落成', () => {
  test('getUpdateState 记录最近检查时间', async () => {
    globalThis.fetch = mockVersionJson({ version: APP_VERSION });
    expect(getUpdateState().lastCheckedAt).toBeNull();
    await checkForUpdate();
    expect(getUpdateState().lastCheckedAt).toBeTruthy();
    expect(localStorage.getItem('utopia_update_last_check')).toBeTruthy();
  });

  test('applyUpdate 先清缓存再重载，并记录已应用的版本', async () => {
    globalThis.fetch = mockVersionJson({ version: '9.9.9' });
    await checkForUpdate();

    // 清空此前为该用例建立的 SW 桩（jsdom 没有 Cache Storage）
    delete globalThis.caches;
    globalThis.caches = {
      keys: async () => ['utopia-static-v3-9-4', 'other-cache'],
      delete: vi.fn(async () => true),
    };

    const reload = vi.fn();
    const result = await applyUpdate({ reload, waitMs: 10 });

    expect(result.cleared).toBe(2);
    expect(globalThis.caches.delete).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(STORAGE_VERSION_KEY)).toBe('9.9.9');
  });

  test('没有 Cache Storage 时清缓存安全返回 0', async () => {
    delete globalThis.caches;
    expect(await clearAppCaches()).toBe(0);
  });
});

describe('更新横幅', () => {
  test('非阻塞横幅：不打断页面，点「稍后」记住该版本并不再重复', async () => {
    globalThis.fetch = mockVersionJson({ version: '9.9.9' });
    await checkForUpdate();

    const banner = showUpdateBanner({ version: '9.9.9' });
    expect(banner).toBeTruthy();
    expect(document.getElementById('appUpdateBanner')).toBeTruthy();
    expect(banner.textContent).toContain('发现新版本 v9.9.9');
    // 非阻塞：不在文档流中占位，也不使用 confirm / alert
    expect(window.confirm).toBeTruthy(); // 环境自带，未被替换即说明没被调用

    banner.querySelector('.app-update-later').click();
    expect(document.getElementById('appUpdateBanner')).toBeNull();
    expect(getDismissedVersion()).toBe('9.9.9');
  });

  test('「立即更新」触发更新且防重复点击', async () => {
    const onApply = vi.fn(async () => {});
    const banner = showUpdateBanner({ version: '9.9.9', onApply });
    const applyBtn = banner.querySelector('.app-update-apply');

    applyBtn.click();
    expect(onApply).toHaveBeenCalledWith('9.9.9');
    expect(applyBtn.disabled).toBe(true);
    expect(applyBtn.textContent).toBe('更新中…');
  });

  test('同一时刻只保留一条横幅，且已「稍后」的版本不再自动弹', async () => {
    dismissUpdate('9.9.9');
    globalThis.fetch = mockVersionJson({ version: '9.9.9' });
    await checkForUpdate();

    const stop = startUpdateWatch({ runOnStart: false, intervalMs: 60000 });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 30));
    stop();

    // 该版本已被用户点过「稍后」→ 不该再弹
    expect(document.getElementById('appUpdateBanner')).toBeNull();

    // 换成未被忽略的版本才弹
    showUpdateBanner({ version: '10.0.0' });
    expect(document.querySelectorAll('#appUpdateBanner').length).toBe(1);
    localStorage.removeItem(DISMISSED_UPDATE_KEY);
  });

  test('startUpdateWatch 会在启动时登记当前版本并可被 stop 取消', () => {
    vi.useFakeTimers();
    const stop = startUpdateWatch({ runOnStart: true, intervalMs: 1000 });
    expect(localStorage.getItem(STORAGE_VERSION_KEY)).toBe(APP_VERSION);
    // 启动检查是延迟触发的，未到点前不打扰
    expect(document.getElementById('appUpdateBanner')).toBeNull();
    stop();
    vi.useRealTimers();
  });
});

describe('版本通道不进缓存', () => {
  test('version.json 存在且版本号与 appMeta 对齐', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

    const data = JSON.parse(readFileSync(resolve(root, 'version.json'), 'utf-8'));
    expect(typeof data.version).toBe('string');
    expect(data.version).toBe(APP_VERSION);
    expect(data.build).toBeTruthy();
  });

  test('VERSION_URL 指向根目录的 version.json', () => {
    expect(VERSION_URL).toBe('./version.json');
  });
});
