import { describe, test, expect } from 'vitest';

/**
 * 入口健壮性：以 modules/index.js 为顶层入口直接 import 不得抛错。
 *
 * 历史缺陷（已修）：以 modules/index 为入口时，pluginApi 的自动装载循环在 chat.js
 * 仍在求值时执行 Object.entries(ModulesIndex)，未完成模块的命名空间为 undefined，
 * 抛 `TypeError: Cannot convert undefined or null to object`。修复：模块装载改为惰性
 * （首次访问触发，此时所有模块已就绪），并对未就绪命名空间做防御跳过。
 */
describe('modules/index 作为顶层入口', () => {
  test('直接 import 不抛错，且经 pluginApi 惰性装载后 API 面完整', async () => {
    const ModulesIndex = await import('../../../js/modules/index.js');
    expect(typeof ModulesIndex).toBe('object');
    expect(Object.keys(ModulesIndex).length).toBeGreaterThan(10);

    // 经由 pluginApi 暴露的惰性装载路径，确认核心模块契约可达
    const { listApiMethods } = await import('../../../js/plugins/pluginApi.js');
    const methods = listApiMethods();
    for (const name of ['character', 'chat', 'social', 'conversation', 'memory']) {
      expect(methods[name], `模块 ${name} 应出现在 API 面`).toBeDefined();
    }
  });
});
