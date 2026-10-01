/* 生成 README 演示 GIF：Playwright 截帧 + canvas 解码 + gifencoder 编码。
 *
 * 用法：node tools/capture-gif.mjs [--url http://...]
 * 输出：assets/screenshots/demo.gif
 *
 * 依赖（临时，--no-save 安装）：playwright（随项目）+ gifencoder（自带 canvas）
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GIFEncoder = require('gifencoder');
const { loadImage } = require('canvas');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'screenshots');
const OUT_GIF = path.join(OUT_DIR, 'demo.gif');
const URL = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://127.0.0.1:8080/';

const VIEWPORT = { width: 900, height: 620 };
const SCALE = 0.7;

async function capture(page, delayMs = 80) {
  await page.waitForTimeout(delayMs);
  return await page.screenshot({ type: 'png' });
}

async function closeModal(page) {
  // 直接通过点击 .modal-close 关闭；若失败则强制隐藏 overlay
  const closeBtn = page.locator('.modal-close:visible').first();
  if (await closeBtn.count()) {
    await closeBtn.click({ force: true }).catch(() => {});
  }
  // 兜底：强制给 overlay 加 hidden，确保后续点击不被拦截
  await page.evaluate(() => {
    const ov = document.getElementById('modalOverlay');
    if (ov) ov.classList.add('hidden');
  });
  await page.waitForTimeout(500);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();

  await page.goto(URL);
  await page.waitForFunction(() => Boolean(window.__utopiaReady), null, { timeout: 60000 });
  await page.waitForTimeout(600);

  // 预置一个演示角色（导入路径 skipApiCheck，不依赖 API Key），让界面有真实内容
  await page.evaluate(async () => {
    const { importCharacter } = await import('/js/modules/character.js');
    await importCharacter({
      name: '凌川',
      description: '毒舌但心软的青年剑客，嘴上不饶人，行动上却总是护着你。',
      personality: '外表冷淡毒舌，内心细腻温柔，说话简短直接，不擅长表达感情。',
      first_mes: '……你怎么才来。雪都下这么大 了，站在门口发什么呆。',
      scenario: '初雪的傍晚，山间客栈。',
      avatar: '',
    }, 'demo-card.json').catch(err => console.warn('预置角色失败:', err));
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__utopiaReady), null, { timeout: 60000 });
  await page.waitForTimeout(800);

  const frames = [];

  // 调试：同时保存每帧 PNG 便于人工检查
  const DEBUG_PNG = process.argv.includes('--debug-png');
  const saveDebug = async (i, buf) => {
    if (!DEBUG_PNG) return;
    fs.writeFileSync(path.join(OUT_DIR, `demo-frame-${i}.png`), buf);
  };

  // 1. 主界面（亮色）
  console.log('[1] 主界面');
  {
    const buf = await capture(page, 600);
    frames.push(buf); await saveDebug(1, buf);
  }

  // 2. 打开设置
  console.log('[2] 打开设置');
  await page.click('#settingsBtn');
  {
    const buf = await capture(page, 600);
    frames.push(buf); await saveDebug(2, buf);
  }

  // 3. 切到微信主题
  console.log('[3] 切微信主题');
  await page.selectOption('#settingsThemeSelect', 'wechat');
  {
    const buf = await capture(page, 500);
    frames.push(buf); await saveDebug(3, buf);
  }

  // 4. 关闭设置
  console.log('[4] 关闭设置');
  await closeModal(page);
  {
    const buf = await capture(page, 800);
    frames.push(buf); await saveDebug(4, buf);
  }

  // 5. 打开朋友圈
  console.log('[5] 打开朋友圈');
  await page.click('#socialBtn');
  {
    const buf = await capture(page, 700);
    frames.push(buf); await saveDebug(5, buf);
  }
  await closeModal(page);

  // 6. 打开世界书
  console.log('[6] 打开世界书');
  await page.click('#worldbookBtn');
  {
    const buf = await capture(page, 700);
    frames.push(buf); await saveDebug(6, buf);
  }
  await closeModal(page);

  // 7. 切回亮色主题
  console.log('[7] 切回亮色');
  await page.click('#settingsBtn');
  await page.selectOption('#settingsThemeSelect', 'light');
  {
    const buf = await capture(page, 500);
    frames.push(buf); await saveDebug(7, buf);
  }
  await closeModal(page);
  {
    const buf = await capture(page, 800);
    frames.push(buf); await saveDebug(8, buf);
  }

  await browser.close();

  if (frames.length < 2) { console.error('帧数不足'); process.exit(1); }
  console.log(`共 ${frames.length} 帧，开始合成 GIF...`);

  const w = Math.round(VIEWPORT.width * SCALE);
  const h = Math.round(VIEWPORT.height * SCALE);

  const encoder = new GIFEncoder(w, h);
  encoder.createReadStream().pipe(fs.createWriteStream(OUT_GIF));
  encoder.start();
  encoder.setRepeat(0);       // 无限循环
  encoder.setDelay(90);       // ~11fps
  encoder.setQuality(10);

  for (const buf of frames) {
    const img = await loadImage(buf);
    const cvs = require('canvas').createCanvas(w, h);
    const ctx2d = cvs.getContext('2d');
    ctx2d.drawImage(img, 0, 0, w, h);
    const { data } = ctx2d.getImageData(0, 0, w, h);
    encoder.addFrame(data);
  }
  encoder.finish();

  await new Promise(r => setTimeout(r, 500));
  const size = fs.statSync(OUT_GIF).size;
  console.log(`已生成 ${OUT_GIF}（${(size / 1024).toFixed(0)} KB）`);
}

main().catch(err => { console.error(err); process.exit(1); });
