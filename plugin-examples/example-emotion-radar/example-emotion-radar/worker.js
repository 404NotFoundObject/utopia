/**
 * 角色状态雷达图 - Worker 入口
 *
 * 【说明】
 *   本插件是一个**纯 UI 插件**——所有功能（绘制雷达图、订阅事件、打开模态框）
 *   都在 ui.js 中实现，Worker 侧不需要任何逻辑。
 *
 *   但当前插件系统要求 manifest.main 为必填字段（见 pluginValidator.js），
 *   所以这里保留一个空的 setup 函数作为占位。
 *
 *   未来如果插件系统支持纯 UI 插件（main 可选），这个文件可以完全删除。
 *
 * 【为什么不在 Worker 里做数据处理？】
 *   本插件的所有数据都通过 uiApi.api.* 获取（RPC 调用），Worker 侧没有独立
 *   的数据源。且 Worker ↔ UI 的双向自定义消息通道目前尚未完整实现
 *   （见 workerRuntime.js 中 `ui:message` 分支的注释），所以 Worker 主动向
 *   UI 推送数据的能力有限。把逻辑集中放在 ui.js 是更简单且更可靠的做法。
 */

export default {
  async setup(api, manifest) {
    console.log('[Radar] Worker 就绪（无业务逻辑）v' + manifest.version);

    return async function teardown() {
      console.log('[Radar] Worker 已卸载');
    };
  },
};