import { describe, test, expect } from 'vitest';
import * as EmotionEngine from '../../../js/modules/emotionEngine.js';
import { getRequiredPermission } from '../../../js/plugins/permissionChecker.js';

/**
 * 插件 API 面守护（最小面）。
 *
 * pluginApi.js 会把 `modules/index.js` 的**每一个导出模块**自动包装成
 * `api.<模块名>.*`：
 *
 *     ensureModulesLoaded(): for (const [name, exports] of Object.entries(ModulesIndex))
 *       _api[name] = wrapModule(name, exports);
 *
 * 而 modules/index.js 里有 `export * as emotion from './emotionEngine.js'`。
 * 于是结论是：**只要从 emotionEngine 导出的函数，就是插件可以调用的公开
 * 契约**，哪怕主应用里一个调用点都没有。
 *
 * emotion.refreshEmotion 看似没有调用方，但对插件是可达的。这里把它钉住。
 *
 * 模块装载为惰性（首次访问触发），pluginApi / modules/index 作为任意
 * 入口直接 import 都不会触发 TDZ（见 pluginApiEntry / modulesIndexEntry 守护）。
 * 本文件只守「导出面 = 契约」这一条结论本身。
 */
describe('emotionEngine 导出面即插件契约', () => {
  test('refreshEmotion 是对外契约，不得按「无调用方」删除', () => {
    expect(typeof EmotionEngine.refreshEmotion).toBe('function');
    // 主应用确实不调用它：周期性追补由 character.syncCharacterState 承担
    // （后者还一并追补身体状态，阈值也更合理）。它存在的理由是对插件开放。
    expect(getRequiredPermission('emotion.refreshEmotion')).toBe('character:write');
  });

  test('refreshEmotion 仍具备可用的追补语义', async () => {
    // 无异地更新信息时不做事，且不抛错
    await expect(EmotionEngine.refreshEmotion(null)).resolves.toBeUndefined();
  });

  test('周期性追补的主入口仍在 character 侧', async () => {
    const Character = await import('../../../js/modules/character.js');
    expect(typeof Character.syncCharacterState).toBe('function');
    expect(typeof Character.syncAllCharactersState).toBe('function');
  });
});
