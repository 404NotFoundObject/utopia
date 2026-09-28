import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

/**
 * E2E 配置。
 *
 * 说明：
 *   - 被测对象是纯前端应用，但必须通过 HTTP 访问（ES Modules 与 IndexedDB
 *     在 file:// 协议下会被浏览器限制），因此这里用项目自带的 server.py 起服务。
 *   - 端口写死 8080 并显式传给 server.py。该脚本在端口被占用时会自动 +1 重试，
 *     这会让 webServer 的 url 探测和实际监听端口错位，因此务必显式指定。
 *   - 首次运行需要下载浏览器内核：npx playwright install chromium
 *
 * 并行度说明：应用冷启动要加载 40+ 个 ES 模块、建 11 张 IndexedDB 表，并且会
 * 尝试访问在线时间接口（离线时会等待到超时）。并发多个页面时资源竞争明显，
 * 曾导致 waitForFunction 在 15s 内等不到启动完成。因此这里按顺序执行。
 */
const PORT = 8080;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',

  // 串行执行：见上方并行度说明
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // E2E 偶发抖动是常态：应用冷启动涉及 40+ 模块加载与多次在线时间接口等待，
  // 机器负载高时启动可能超过等待阈值。本地保留 1 次重试以避免误报。
  retries: process.env.CI ? 2 : 1,

  // 启动等待较宽裕，避免慢机器上误判
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // 产物放到系统临时目录，避免污染项目根目录
  outputDir: path.join(os.tmpdir(), 'utopia-playwright'),

  reporter: [
    ['list'],
    ['json', { outputFile: path.join(os.tmpdir(), 'utopia-playwright', 'results.json') }],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  webServer: {
    // 显式指定端口，避免 server.py 的自动 +1 重试导致端口错位
    command: `python server.py ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

