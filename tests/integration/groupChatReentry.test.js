import { describe, it, expect, vi } from 'vitest';

/**
 * 群聊「二次进入无响应」回归。
 *
 * 现象（移动端微信主题）：进入群聊 → 返回列表层 → 再点同一个群，
 * 界面停在列表层不动；必须先随便进一个单聊再退出来，群聊才进得去。
 *
 * 根因：state 对「相同值」直接 return、不通知订阅者。返回列表层时
 * currentGroupId 并未清空，于是再次 openGroupChat(同一 id) 时
 * set 被判定为无变化 → wechatTheme 里负责切到对话页的订阅者收不到通知。
 * selectCharacter（单聊）早有「先置 null 再设值」的防呆，群聊此前没有。
 *
 * 这里断言：连续两次 openGroupChat(同一 id)，订阅者每次都收到通知。
 */

vi.mock('../../js/modules/groupChat.js', () => ({
  getGroup: vi.fn(async (id) => ({ id, name: '测试群', avatar: '' })),
  getGroupMembers: vi.fn(async () => [{ memberId: 'user', memberType: 'user' }]),
  getGroupMessages: vi.fn(async () => []),
  sendUserGroupMessage: vi.fn(async () => {}),
}));

describe('群聊重复进入', () => {
  it('连续两次 openGroupChat(同一群) 都通知订阅者', async () => {
    const { getAppState } = await import('../../js/core/state.js');
    const { openGroupChat } = await import('../../js/ui/screens/groupChatUI.js');
    const s = getAppState();

    const seen = [];
    s.subscribe('currentGroupId', (v) => seen.push(v));

    await openGroupChat('g1');
    await openGroupChat('g1');

    // 第一次 null → 'g1'；第二次先置 null 再设 'g1'，强制走完整通知链路
    expect(seen).toEqual(['g1', null, 'g1']);
  });

  it('切换到另一个群时同样触发通知（正常路径不受影响）', async () => {
    const { getAppState } = await import('../../js/core/state.js');
    const { openGroupChat } = await import('../../js/ui/screens/groupChatUI.js');
    const s = getAppState();

    const seen = [];
    s.subscribe('currentGroupId', (v) => seen.push(v));

    await openGroupChat('g2');

    expect(seen).toEqual(['g2']);
  });
});
