/**
 * 等微信主题按需注入的 wechat.css 样式表 CSSOM 就绪，且注入期的
 * 过渡禁用标记（data-wx-loading）已解除。
 *
 * wechat-theme.spec.js 与 social-visual.spec.js 都需要等待注入收敛，
 * 抽出单一来源避免两处各写一份 waitForFunction。
 * 非微信主题（light/dark）不注入样式表，直接通过。
 */
export async function waitForWxStylesheet(page, timeout = 10_000) {
  await page.waitForFunction(
    () => {
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme !== 'wechat' && theme !== 'wechat-dark') return true;
      const link = document.querySelector('link[data-wx-stylesheet]');
      return Boolean(link && link.sheet) && !document.documentElement.hasAttribute('data-wx-loading');
    },
    null,
    { timeout },
  );
}
