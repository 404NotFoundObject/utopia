import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /undo 与 /regen 命令接线测试。
 *
 * 背景（实机 bug）：命令总是在 sendMessage / sendUserGroupMessage 内部执行的，
 * 那两个入口早已 state.set('sending', true)。/undo、/regen 处理器里如果再检查
 * state.get('sending')，恒为 true，命令永远被「正在生成回复」挡住。
 *
 * 这里特意在 sending=true 的状态下调命令，断言命令正常往下走。
 * 只 mock 状态源与 chatOperations，命令引擎走真实实现。
 */

const undoLastMessage = vi.fn(async (convId) => ({
  success: true,
  removed: {
    user: { content: '用户消息' },
    assistant: { content: '角色回复' },
    memories: 2,
  },
}));

const regenerateLastReply = vi.fn(async (convId) => ({
  success: true,
  newContent: '重新生成的回复内容',
}));

vi.mock('../../js/modules/chatOperations.js', () => ({
  undoLastMessage: (...args) => undoLastMessage(...args),
  regenerateLastReply: (...args) => regenerateLastReply(...args),
  // commandEngine 还从该模块导入其它函数，补最小 stub
  updateLastMessage: async () => ({}),
}));

vi.mock('../../js/core/state.js', () => {
  const store = new Map([
    ['sending', true], // 模拟「已在发送流程内」——修复前这让 /undo、/regen 恒被挡
    ['currentConversationId', 'conv-1'],
    ['currentMode', 'chat'],
  ]);
  return {
    getAppState: () => ({
      get: (key) => (store.has(key) ? store.get(key) : null),
      set: (key, val) => store.set(key, val),
    }),
  };
});

// vi.mock 会被提升到文件顶部，静态 import 同样命中 mock，无需动态导入
import { executeCommand } from '../../js/modules/commandEngine.js';

beforeEach(() => {
  undoLastMessage.mockClear();
  regenerateLastReply.mockClear();
});

describe('sending=true 时 /undo 与 /regen 仍可执行', () => {
  it('/undo 不被「正在生成」挡住，正常调用撤回', async () => {
    const res = await executeCommand('/undo', {});
    expect(res.handled).toBe(true);
    expect(res.result.console).not.toContain('正在生成');
    expect(undoLastMessage).toHaveBeenCalledWith('conv-1');
    expect(res.result.console).toContain('已撤回');
  });

  it('/regen 不被「正在生成」挡住，正常调用重新生成', async () => {
    const res = await executeCommand('/regen', {});
    expect(res.handled).toBe(true);
    expect(res.result.console).not.toContain('正在生成');
    expect(regenerateLastReply).toHaveBeenCalledWith('conv-1');
    expect(res.result.console).toContain('已重新生成');
  });
});
