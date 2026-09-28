import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // 应用通过 index.html 的 importmap 把 "/lib/" 与 "/js/" 映射到项目根目录。
      // Node / Vite 默认会把前导斜杠解析成文件系统根路径，所以必须在测试侧显式复刻该映射，
      // 否则 core/api.js、core/eventBus.js、modules/injector.js 等模块会解析失败。
      { find: /^\/lib\//, replacement: path.resolve(projectRoot, 'lib') + '/' },
      { find: /^\/js\//, replacement: path.resolve(projectRoot, 'js') + '/' },
    ],
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup/vitest.setup.js'],

    include: [
      'tests/unit/**/*.test.js',
      'tests/dom/**/*.test.js',
      'tests/integration/**/*.test.js',
    ],

    // E2E 由 Playwright 单独驱动，不能混进 Vitest 的用例收集
    exclude: ['node_modules/**', 'tests/e2e/**', 'lib/**'],

    // 每个测试文件使用独立的模块注册表，保证 appState / dbInstance 等单例互不污染
    isolate: true,

    // jsdom 环境构建成本很高（本项目约 8s/次）。vmThreads 池会在 worker 内复用
    // 环境实例，同时保持按文件隔离，比默认 threads 池快一个数量级。
    pool: 'vmThreads',

    testTimeout: 10000,

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      include: ['js/**/*.js'],
      exclude: [
        'js/app.js',
        'js/dev/**',
        'js/ui/screens/helpUI.js',
        'js/ui/screens/worldBookHelp.js',
        'lib/**',
      ],
    },
  },
});
