/* 全量冒烟：插件系统 + 所有设置分区 + 各功能屏 + 主题切换 + 窗口装饰器
 *
 * 用法：
 *   node tools/smoke-full.mjs                       # 默认 http://127.0.0.1:8080/
 *   node tools/smoke-full.mjs --url https://xxx     # 校验部署后的站点
 *
 * 退出码：0 = 全部通过；1 = 存在失败项或非外部噪声的控制台错误
 */
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const URL = urlArg >= 0 && args[urlArg + 1] ? args[urlArg + 1] : 'http://127.0.0.1:8080/';
const results = [];
const errors = [];
const warns = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
}

const EXTERNAL = /cdnjs|jsdelivr|googleapis|gstatic|fonts\.|ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION)/i;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !EXTERNAL.test(t)) errors.push(t);
  if (m.type() === 'warning' && !EXTERNAL.test(t)) warns.push(t);
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

function mark(label) {
  errors.push('--- ' + label + ' ---');
  warns.push('--- ' + label + ' ---');
}

/**
 * 启动应用并就绪。冷启动偶尔会因浏览器资源争抢超出就绪等待，
 * 因此带有限次重试；连续失败才视为真实故障。
 */
async function boot(page, url, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => Boolean(window.__utopiaReady), null, { timeout: 60000 });
      return;
    } catch (e) {
      lastErr = e;
      console.log(`  启动第 ${i}/${tries} 次未就绪：${String(e.message).split('\n')[0]}，重试…`);
      await page.waitForTimeout(1500);
    }
  }
  throw lastErr;
}

await boot(page, URL);
await page.waitForTimeout(600);
mark('启动');

// ---------- 准备数据 ----------
await page.evaluate(async () => {
  const { createCharacter } = await import('/js/modules/character.js');
  const { getAppState } = await import('/js/core/state.js');
  const avatar =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#07c160"/></svg>'
    );
  await createCharacter({ name: '冒烟角色', avatar, description: '冒烟用' }, { skipApiCheck: true });
  const st = getAppState();
  const settings = st.get('settings') || {};
  st.set('settings', { ...settings, user: { ...(settings.user || {}), name: '我', avatar } });
});
await page.waitForTimeout(500);
mark('准备数据');

// ---------- 1. 主题全覆盖 ----------
mark('主题切换');
const themeIds = await page.evaluate(async () => {
  const { getAvailableThemes } = await import('/js/ui/layout/theme.js');
  return getAvailableThemes().map((t) => t.id);
});
check('可取到主题列表', themeIds.length >= 5, themeIds.join(', '));

for (const id of themeIds) {
  const info = await page.evaluate(async (tid) => {
    const { applyTheme, getCurrentTheme } = await import('/js/ui/layout/theme.js');
    applyTheme(tid);
    await new Promise((r) => setTimeout(r, 250));
    const cs = getComputedStyle(document.documentElement);
    return {
      current: getCurrentTheme(),
      dataTheme: document.documentElement.dataset.theme,
      secondary: cs.getPropertyValue('--color-bg-secondary').trim(),
      appPad: getComputedStyle(document.getElementById('app')).paddingTop,
      barDisplay: getComputedStyle(document.getElementById('pwaTitleBar')).display,
      meta: document.querySelector('meta[name="theme-color"]')?.content,
    };
  }, id);
  check(
    `主题 ${id} 生效`,
    info.current === id && info.dataTheme === id && !!info.secondary,
    `data-theme=${info.dataTheme} secondary=${info.secondary}`
  );
  check(
    `主题 ${id} · 非 WCO 下装饰条隐藏且不挤压布局`,
    info.barDisplay === 'none' && info.appPad === '0px',
    `display=${info.barDisplay} appPadding=${info.appPad}`
  );
  check(`主题 ${id} · meta theme-color 同步`, info.meta === info.secondary, `meta=${info.meta}`);
}

await page.evaluate(async () => {
  const { applyTheme } = await import('/js/ui/layout/theme.js');
  applyTheme('wechat');
});
await page.waitForTimeout(300);

// ---------- 2. 侧栏按钮 / 功能屏 ----------
async function openScreen(label, fn) {
  mark(label);
  const r = await page.evaluate(fn);
  await page.waitForTimeout(600);
  const modal = await page.evaluate(() => {
    const overlay = document.getElementById('modalOverlay');
    const content = document.getElementById('modalContent');
    return {
      visible: overlay && !overlay.classList.contains('hidden'),
      len: content ? content.innerHTML.trim().length : 0,
    };
  });
  check(`${label} 可打开`, r !== false && modal.len > 20, `内容长度=${modal.len}`);
  await page.evaluate(async () => {
    const { closeModal } = await import('/js/ui/components/modal.js');
    closeModal();
  });
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() =>
    document.getElementById('modalOverlay').classList.contains('hidden')
  );
  check(`${label} 可关闭`, closed);
}

// 注意：以下四个渲染函数内部自带 openModal，不能在外层再包一次
await openScreen('创建角色表单', async () => {
  const m = await import('/js/ui/screens/characterFormUI.js');
  m.renderCharacterForm();
});

await openScreen('创建群组表单', async () => {
  const m = await import('/js/ui/screens/groupFormUI.js');
  m.renderGroupForm();
});

await openScreen('导入界面', async () => {
  const m = await import('/js/ui/screens/importUI.js');
  m.renderImportModal();
});

await openScreen('帮助', async () => {
  const m = await import('/js/ui/screens/helpUI.js');
  m.renderHelpModal();
});

await openScreen('世界书', async () => {
  document.getElementById('worldbookBtn').click();
});

await openScreen('插件管理', async () => {
  document.getElementById('pluginBtn').click();
});

await openScreen('朋友圈', async () => {
  document.getElementById('socialBtn').click();
});

await openScreen('情感调试', async () => {
  const m = await import('/js/ui/screens/emotionDebugUI.js');
  m.openEmotionDebug();
});

// ---------- 3. 设置面板：全部分区 + 保存 ----------
mark('设置面板');
const settingsInfo = await page.evaluate(async () => {
  const main = await import('/js/ui/screens/settingsUI.js');
  const { openModal, closeModal } = await import('/js/ui/components/modal.js');
  openModal(main.renderSettingsModal());
  await main.bindSettingsSave(document.getElementById('modalContent'));
  await new Promise((r) => setTimeout(r, 800));
  const content = document.getElementById('modalContent');
  return {
    sections: [...content.querySelectorAll('.settings-section h3')].map((h) => h.textContent.trim()),
    inputs: content.querySelectorAll('input,select,textarea,button').length,
    hasSave: !!content.querySelector('#saveSettingsBtn'),
    titlebarRows: {
      glass: !!content.querySelector('#settingsTitlebarGlass'),
      alpha: !!content.querySelector('#settingsTitlebarAlpha'),
      blur: !!content.querySelector('#settingsTitlebarBlur'),
      color: !!content.querySelector('#settingsTitlebarColor'),
    },
    closeModal: typeof closeModal,
  };
});
check('设置分区齐全', settingsInfo.sections.length >= 14, `${settingsInfo.sections.length} 个：${settingsInfo.sections.join(' / ')}`);
check('设置含保存按钮与大量控件', settingsInfo.hasSave && settingsInfo.inputs > 20, `控件 ${settingsInfo.inputs} 个`);
check(
  '窗口装饰器四项控件齐备',
  Object.values(settingsInfo.titlebarRows).every(Boolean),
  JSON.stringify(settingsInfo.titlebarRows)
);

// 拖动滑块 → 即时生效
const sliderRes = await page.evaluate(() => {
  const a = document.getElementById('settingsTitlebarAlpha');
  const b = document.getElementById('settingsTitlebarBlur');
  a.value = '40';
  a.dispatchEvent(new Event('input', { bubbles: true }));
  b.value = '26';
  b.dispatchEvent(new Event('input', { bubbles: true }));
  const root = document.documentElement;
  return {
    alpha: root.style.getPropertyValue('--pwa-glass-alpha').trim(),
    blur: root.style.getPropertyValue('--pwa-glass-blur').trim(),
    saved: JSON.parse(localStorage.getItem('utopia_wco_titlebar') || '{}'),
    alphaText: document.getElementById('settingsTitlebarAlphaText').textContent,
  };
});
check(
  '滑块即时写入 CSS 变量与 localStorage',
  sliderRes.alpha === '0.4' && sliderRes.blur === '26px' && sliderRes.saved.alpha === 0.4,
  JSON.stringify(sliderRes)
);

// 保存设置
await page.evaluate(() => document.getElementById('saveSettingsBtn').click());
await page.waitForTimeout(800);
const saved = await page.evaluate(async () => {
  const { getAppState } = await import('/js/core/state.js');
  const s = getAppState().get('settings') || {};
  return { keys: Object.keys(s).length, hasUser: !!s.user };
});
check('保存设置无异常且设置已落库', saved.keys > 0, `settings 字段 ${saved.keys} 个`);
await page.evaluate(async () => {
  const { closeModal } = await import('/js/ui/components/modal.js');
  closeModal();
});

// ---------- 4. 主题制作器真实往返（会重建设置面板并恢复表单） ----------
mark('主题制作器往返');
const makerRound = await page.evaluate(async () => {
  const main = await import('/js/ui/screens/settingsUI.js');
  const { openModal } = await import('/js/ui/components/modal.js');
  openModal(main.renderSettingsModal());
  await main.bindSettingsSave(document.getElementById('modalContent'));
  await new Promise((r) => setTimeout(r, 600));

  document.getElementById('settingsThemeMakerBtn').click();
  await new Promise((r) => setTimeout(r, 1500));
  const makerOpen = !!document.querySelector('#modalContent .theme-maker-v2');
  const themeBefore = document.documentElement.dataset.theme;

  // 真实关闭：点右上角 ×，走 openModal 的 onClose 回调 → 重建设置面板
  document.querySelector('#modalContent .modal-close').click();
  await new Promise((r) => setTimeout(r, 1800));

  const content = document.getElementById('modalContent');
  return {
    makerOpen,
    themeBefore,
    themeAfter: document.documentElement.dataset.theme,
    rowsAfter: !!content.querySelector('#settingsTitlebarAlpha'),
    alphaAfter: content.querySelector('#settingsTitlebarAlpha')?.value,
    blurAfter: content.querySelector('#settingsTitlebarBlur')?.value,
    sections: content.querySelectorAll('.settings-section h3').length,
    saveBtn: !!content.querySelector('#saveSettingsBtn'),
  };
});
check('主题制作器可打开', makerRound.makerOpen, JSON.stringify(makerRound));
check('关闭后回到设置面板且主题未被改动', makerRound.sections >= 14 && makerRound.saveBtn && makerRound.themeAfter === makerRound.themeBefore,
  `sections=${makerRound.sections} theme=${makerRound.themeBefore}→${makerRound.themeAfter}`);
check('往返后窗口装饰器控件重建且值被恢复', makerRound.rowsAfter && makerRound.alphaAfter === '40' && makerRound.blurAfter === '26',
  `alpha=${makerRound.alphaAfter} blur=${makerRound.blurAfter}`);
await page.evaluate(async () => {
  const { closeModal } = await import('/js/ui/components/modal.js');
  closeModal();
});
await page.waitForTimeout(300);

// ---------- 5. 插件系统 ----------
mark('插件系统');
const pluginRes = await page.evaluate(async () => {
  const vfs = await import('/js/plugins/pluginVfs.js');
  const uiBridge = await import('/js/plugins/uiBridge.js');
  const uiRuntime = await import('/js/plugins/uiRuntime.js');

  const manifest = {
    id: 'com.utopia.smoke',
    name: '冒烟插件',
    version: '1.0.0',
    main: 'main.js',
    ui: 'ui.js',
    permissions: ['ui:inject', 'storage'],
    enabled: true,
  };
  const enc = new TextEncoder();
  const files = {
    'manifest.json': enc.encode(JSON.stringify(manifest)),
    'main.js': enc.encode('export default { setup(api, mf) { return () => {}; } };'),
    'ui.js': enc.encode(`
      export default {
        setup(api, mf) {
          window.__smokeApi = api;
          const off1 = api.registerSlot('sidebar-top', () => '<div class="smoke-sidebar">SMOKE-SIDEBAR</div>');
          const off2 = api.registerSlot('settings-sections', () => '<div class="smoke-settings">SMOKE-SETTINGS</div>');
          api.utils.showToast('冒烟插件已加载', 'info', 1200);
          window.__smokeOff = () => { off1(); off2(); };
          return () => window.__smokeOff();
        }
      };
    `),
  };

  await vfs.deletePlugin(manifest.id).catch(() => {});
  await vfs.savePlugin(manifest, files, { enabled: true });

  const loaded = await uiBridge.loadUiScript(manifest);
  uiRuntime.rescan();
  await new Promise((r) => setTimeout(r, 400));

  await vfs.kvSet(manifest.id, 'k', { a: 1 });
  const kvVal = await vfs.kvGet(manifest.id, 'k');
  const all = await vfs.getAllPlugins();

  return {
    hasApi: !!window.__smokeApi,
    sidebarFilled: !!document.querySelector('[data-plugin-id="com.utopia.smoke"] .smoke-sidebar'),
    sidebarCount: document.querySelectorAll('[data-plugin-id="com.utopia.smoke"]').length,
    kvRoundTrip: JSON.stringify(kvVal) === JSON.stringify({ a: 1 }),
    kvVal: JSON.stringify(kvVal),
    installed: all.some((p) => p.manifest && p.manifest.id === manifest.id),
    teardownIsFn: typeof loaded?.teardown === 'function',
  };
});
check('插件 UI 脚本加载并拿到 api', pluginRes.hasApi, JSON.stringify(pluginRes));
check('插件槽位注入到 DOM', pluginRes.sidebarFilled, `注入节点 ${pluginRes.sidebarCount} 个`);
check('插件 KV 存储读写往返', pluginRes.kvRoundTrip);
check('插件已持久化到 VFS', pluginRes.installed);

// 插件注入出现在设置面板
const pluginInSettings = await page.evaluate(async () => {
  const main = await import('/js/ui/screens/settingsUI.js');
  const { openModal, closeModal } = await import('/js/ui/components/modal.js');
  openModal(main.renderSettingsModal());
  await main.bindSettingsSave(document.getElementById('modalContent'));
  await new Promise((r) => setTimeout(r, 700));
  const has = !!document.querySelector('#modalContent .smoke-settings');
  closeModal();
  return has;
});
check('插件注入出现在设置面板槽位', pluginInSettings);

// 插件列表 + 停用 / 启用 + 卸载
const pluginLifecycle = await page.evaluate(async () => {
  const mgr = await import('/js/plugins/pluginManager.js');
  const vfs = await import('/js/plugins/pluginVfs.js');
  const uiBridge = await import('/js/plugins/uiBridge.js');
  const uiRuntime = await import('/js/plugins/uiRuntime.js');
  const out = {};
  out.listed = (await mgr.listInstalledPlugins()).some((p) => p.id === 'com.utopia.smoke');
  await mgr.disablePlugin('com.utopia.smoke').catch((e) => { out.disableErr = String(e); });
  await new Promise((r) => setTimeout(r, 400));
  out.disabledEnabled = (await vfs.getPlugin('com.utopia.smoke'))?.enabled;
  await mgr.enablePlugin('com.utopia.smoke').catch((e) => { out.enableErr = String(e); });
  await new Promise((r) => setTimeout(r, 600));
  out.reEnabled = (await vfs.getPlugin('com.utopia.smoke'))?.enabled;
  // 卸载：清 UI 注入 + VFS
  uiBridge.unregisterAllInjections('com.utopia.smoke');
  uiRuntime.unregisterAllSlots('com.utopia.smoke');
  await vfs.deletePlugin('com.utopia.smoke');
  uiRuntime.rescan();
  await new Promise((r) => setTimeout(r, 400));
  out.removed = document.querySelectorAll('[data-plugin-id="com.utopia.smoke"]').length;
  out.gone = !(await vfs.getAllPlugins()).some((p) => p.manifest?.id === 'com.utopia.smoke');
  return out;
});
check('插件出现在已安装列表', pluginLifecycle.listed, JSON.stringify(pluginLifecycle));
check('插件停用 / 启用往返', pluginLifecycle.disabledEnabled === false && pluginLifecycle.reEnabled === true,
  `disable=${pluginLifecycle.disabledEnabled} enable=${pluginLifecycle.reEnabled}`);
check('插件卸载后 DOM 与 VFS 均无残留', pluginLifecycle.removed === 0 && pluginLifecycle.gone,
  `残留节点=${pluginLifecycle.removed}`);

// ---------- 6. 聊天相关 ----------
mark('聊天');
const chatRes = await page.evaluate(async () => {
  const list = document.getElementById('characterList');
  const first = list?.querySelector('.character-item');
  first?.click();
  await new Promise((r) => setTimeout(r, 500));
  const ta = document.getElementById('messageInput');
  ta.value = '冒烟测试消息';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const send = document.getElementById('sendBtn');
  const cs = getComputedStyle(send);
  return {
    containerVisible: getComputedStyle(document.getElementById('chatContainer')).display !== 'none',
    sendDisabledAtIdle: send.disabled,
    sendLabel: getComputedStyle(send, '::after').content,
    sendBg: cs.backgroundColor,
    inputBg: getComputedStyle(document.getElementById('chatInput')).backgroundColor,
    chatBg: getComputedStyle(document.getElementById('chatMessages')).backgroundColor,
    headerBg: getComputedStyle(document.getElementById('chatHeader')).backgroundColor,
    headerShadow: getComputedStyle(document.getElementById('chatHeader')).boxShadow,
  };
});
check('选中角色后聊天容器可见', chatRes.containerVisible, JSON.stringify(chatRes));
check('发送按钮可用且为微信「发送」文字按钮', chatRes.sendLabel.includes('发送'), chatRes.sendLabel);
check('输入区与页面底色分层（微信主题）', chatRes.inputBg !== chatRes.chatBg, `input=${chatRes.inputBg} chat=${chatRes.chatBg}`);
check('顶栏与聊天页同色且有阴影', chatRes.headerBg === chatRes.chatBg && chatRes.headerShadow !== 'none',
  `header=${chatRes.headerBg} shadow=${chatRes.headerShadow}`);

// ---------- 7. 窗口装饰器（强制 WCO） ----------
mark('窗口装饰器');
const wcoRes = await page.evaluate(async () => {
  document.documentElement.dataset.wco = 'on';
  await new Promise((r) => setTimeout(r, 300));
  const bar = document.getElementById('pwaTitleBar');
  const cs = getComputedStyle(bar);
  const app = getComputedStyle(document.getElementById('app'));
  const rect = bar.getBoundingClientRect();
  const sidebarBtn = document.getElementById('settingsBtn');
  return {
    display: cs.display,
    height: cs.height,
    backdrop: cs.backdropFilter,
    appPad: app.paddingTop,
    z: cs.zIndex,
    overlapsSidebar: sidebarBtn ? sidebarBtn.getBoundingClientRect().top >= rect.bottom - 1 : null,
  };
});
check('WCO 下装饰条显示且高度取自 env 回退', wcoRes.display === 'block' && wcoRes.height === '32px', JSON.stringify(wcoRes));
check('装饰条启用磨砂模糊', /blur/.test(wcoRes.backdrop), wcoRes.backdrop);
check('应用内容让出标题栏高度、不被遮挡', wcoRes.appPad === '32px' && wcoRes.overlapsSidebar === true,
  `appPadding=${wcoRes.appPad} 不重叠=${wcoRes.overlapsSidebar}`);
await page.evaluate(() => {
  document.documentElement.dataset.wco = 'off';
});

// ---------- 8. 移动端视口 ----------
mark('移动端视口');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
const mobile = await page.evaluate(() => {
  const dock = document.querySelector('.sidebar-footer');
  return {
    view: document.documentElement.dataset.wxMobileView || document.body.dataset.wxMobileView || null,
    dockVisible: dock ? getComputedStyle(dock).display !== 'none' : false,
    appPad: getComputedStyle(document.getElementById('app')).paddingTop,
  };
});
check('移动端视口切换无异常', mobile.appPad === '0px', JSON.stringify(mobile));
await page.setViewportSize({ width: 1280, height: 900 });

// ---------- 汇总 ----------
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log('\n================ 冒烟结果 ================');
for (const r of results) {
  console.log(`${r.ok ? '  ✔' : '  ✘'} ${r.name}${r.detail ? `  \x1b[90m${r.detail}\x1b[0m` : ''}`);
}
console.log(`\n通过 ${results.length - failed.length}/${results.length}`);

// 控制台错误（按阶段分组，剔除外部资源噪声）
const realErrors = errors.filter((e) => !EXTERNAL.test(e) && !e.startsWith('---'));
const realWarns = warns.filter((w) => !EXTERNAL.test(w) && !w.startsWith('---'));
console.log(`\n控制台错误 ${realErrors.length} 条：`);
for (const e of [...new Set(realErrors)].slice(0, 25)) console.log('   ! ' + e.slice(0, 200));
console.log(`\n控制台警告 ${realWarns.length} 条：`);
for (const w of [...new Set(realWarns)].slice(0, 15)) console.log('   · ' + w.slice(0, 160));

process.exit(failed.length || realErrors.length ? 1 : 0);
