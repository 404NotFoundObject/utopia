import { describe, test, expect } from 'vitest';

/**
 * 入口健壮性：以 pluginApi.js 为顶层入口直接 import 不得抛错。
 *
 * 历史缺陷（已修）：pluginApi → modules/index → chat → chatUI → uiBridge →
 * pluginRuntime → pluginApi 成环，pluginRuntime 顶层在 pluginApi 函数体执行前
 * 调用 setEventBroadcaster，触发 `ReferenceError: Cannot access 'eventBroadcaster'
 * before initialization`（let 的 TDZ）。修复：eventBroadcaster 改为 var（实例化期
 * 即初始化）；模块装载改为惰性（首次访问触发）。本用例钉住"任何入口都能导入"。
 */
describe('pluginApi 作为顶层入口', () => {
  test('直接 import 不抛错，且插件 API 面完整装载', async () => {
    const mod = await import('../../../js/plugins/pluginApi.js');
    expect(typeof mod.default).toBe('object');
    expect(typeof mod.listApiMethods).toBe('function');

    const methods = mod.listApiMethods();
    // 触发惰性装载后，modules/index 中的核心模块必须可达（导出面 = 契约）
    for (const name of ['character', 'chat', 'social', 'conversation', 'memory']) {
      expect(methods[name], `模块 ${name} 应经惰性装载出现在 API 面`).toBeDefined();
    }
  });
});
