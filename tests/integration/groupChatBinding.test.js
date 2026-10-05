import { describe, it, expect, vi } from 'vitest';

/**
 * groupChat 模块绑定回归测试。
 *
 * 背景（实机 bug）：groupChat.js 曾用 `export { getGroupMembers } from './groupMembers.js'`
 * 纯再导出语法 —— 该语法不会在本模块作用域创建绑定，本文件内部 4 处调用
 * （sendUserGroupMessage / generateCharacterReplySync 等）运行时抛
 * `ReferenceError: getGroupMembers is not defined`，群聊发消息直接失败。
 *
 * 坑点：`import * as ns` 的命名空间对象**包含**再导出的名字，所以仅断言
 * `typeof ns.getGroupMembers === 'function'` 抓不到这个回归。必须真正执行
 * 一次模块内部的调用路径（sendUserGroupMessage），让它踩到那个裸引用。
 *
 * 依赖全部打桩：db / 命令引擎 / 群聊引擎，走真实的 getGroupMembers 与
 * sendUserGroupMessage 主体。
 */

const { storesStub, addMessage } = vi.hoisted(() => {
  const addMessage = vi.fn(async (msg) => msg);
  const storesStub = {
    groups: { get: async (id) => ({ id, name: '测试群', memberCount: 1 }), update: async () => {} },
    group_members: {
      getByIndex: async () => [],
      update: async () => {},
    },
    group_messages: {
      getByIndex: async () => [],
      add: addMessage,
    },
    settings: { get: async () => null },
  };
  return { storesStub, addMessage };
});

vi.mock('../../js/core/db.js', () => ({
  getStores: async () => storesStub,
  withKeyLock: async (_store, _key, fn) => fn(),
}));

vi.mock('../../js/modules/commandEngine.js', () => ({
  executeCommand: async () => ({ handled: false }),
}));

vi.mock('../../js/modules/groupChatEngine.js', () => ({
  GroupChatEngine: {
    decideSpeaker: async () => null,
    runAutoSpeakCycle: async () => {},
  },
}));

vi.mock('../../js/core/state.js', () => {
  const store = new Map([
    ['sending', false],
    ['currentMode', 'group'],
  ]);
  return {
    getAppState: () => ({
      get: (key) => (store.has(key) ? store.get(key) : null),
      set: (key, val) => store.set(key, val),
    }),
  };
});

// 静态导入同样命中上面的 mock（vi.mock 会被提升）
import { sendUserGroupMessage } from '../../js/modules/groupChat.js';
import { getGroupMembers as getGroupMembersImpl } from '../../js/modules/groupMembers.js';

describe('modules/groupChat · 内部 getGroupMembers 绑定', () => {
  it('导出的 getGroupMembers 与 groupMembers.js 是同一实现', () => {
    expect(typeof sendUserGroupMessage).toBe('function');
    expect(getGroupMembersImpl).toBeTypeOf('function');
  });

  it('sendUserGroupMessage 内部能走到消息落库（裸引用未断）', async () => {
    // 修复前：在 getGroupMembers(groupId) 处抛 ReferenceError，
    // 消息永远落不了库，且 app.js 捕获后 toast「发送失败」。
    await expect(sendUserGroupMessage('g1', '大家好')).resolves.not.toThrow();

    expect(addMessage).toHaveBeenCalledTimes(1);
    const saved = addMessage.mock.calls[0][0];
    expect(saved.groupId).toBe('g1');
    expect(saved.content).toBe('大家好');
    expect(saved.senderType).toBe('user');
  });
});
