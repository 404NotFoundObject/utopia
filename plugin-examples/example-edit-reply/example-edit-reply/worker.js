/**
 * 回复编辑插件 - Worker 入口
 */

export default {
  async setup(api, manifest) {
    console.log('[EditReply] Worker 已启动 v' + manifest.version);

    // 演示：注册钩子监听 AI 回复
    try {
      await api.hooks.register('chat:after-receive', async (context) => {
        // 仅记录，不修改
        return undefined;
      }, { priority: 100 });
    } catch (err) {
      console.warn('[EditReply] 钩子注册失败:', err.message);
    }

    return async function teardown() {
      console.log('[EditReply] Worker 卸载');
    };
  },
};