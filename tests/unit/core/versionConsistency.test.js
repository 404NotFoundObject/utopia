import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

/**
 * 版本号一致性守护。
 *
 * 版本号有四份：运行期真源 appMeta、更新探测通道 version.json（SW 缓存名的来源）、
 * package.json、README 徽章。任一份漏改，表现各不相同却都很隐蔽：
 *   - version.json 没更新 → 客户端永远探测不到新版本
 *   - appMeta 没更新     → 设置页显示的版本与实际不符，排障时被误导
 * 统一由 scripts/release.mjs 更新，这里防止有人手工改漏。
 */
describe('版本号四处一致', () => {
  const appMeta = read('js/core/appMeta.js');
  const versionJson = JSON.parse(read('version.json'));
  const pkg = JSON.parse(read('package.json'));
  const readme = read('README.md');

  const appVersion = appMeta.match(/export const APP_VERSION = '([^']+)'/)?.[1];

  test('四处版本号完全相同', () => {
    expect(appVersion).toBeTruthy();
    expect(versionJson.version).toBe(appVersion);
    expect(pkg.version).toBe(appVersion);
    expect(readme).toContain(`badge/version-${appVersion}-`);
  });

  test('CHANGELOG 的最新条目与当前版本一致', () => {
    const changelog = read('CHANGELOG.md');
    const headings = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0]).toBe(appVersion);
  });

  test('README 更新记录的首个版本小节与当前版本一致', () => {
    const sections = [...readme.matchAll(/^### v(\d+\.\d+\.\d+)/gm)].map((m) => m[1]);
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0]).toBe(appVersion);
  });
});
