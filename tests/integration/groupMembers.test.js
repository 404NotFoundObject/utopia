/**
 * 群成员查询。
 *
 * getGroupMembers 若在 groupChat.js（导出）与 groupChatEngine.js（私有
 * getGroupMembersWithDetails）各放一份，补全逻辑就会修一处漏一处。
 * 现统一由 js/modules/groupMembers.js 提供，groupChat.js 保留 re-export 兼容既有调用方。
 *
 * 本测试同时锁定行为与「唯一实现」约束（re-export 必须指向同一个函数对象）。
 */
import { describe, it, expect } from 'vitest';
import { getStores } from '../../js/core/db.js';
import { getGroupMembers } from '../../js/modules/groupMembers.js';
import { getGroupMembers as getGroupMembersViaGroupChat } from '../../js/modules/groupChat.js';

const uniq = () => Math.random().toString(36).slice(2);

describe('modules/groupMembers#getGroupMembers', () => {
  it('角色成员补 character，用户成员补 user', async () => {
    const stores = await getStores();
    const gid = `g-${uniq()}`;
    const cid = `c-${uniq()}`;

    await stores.characters.add({ id: cid, name: '测试角色' });
    await stores.settings.put({ id: 'app_settings', user: { name: '主人' } });
    await stores.group_members.add({ id: `gm1-${gid}`, groupId: gid, memberId: cid, memberType: 'character', role: 'member' });
    await stores.group_members.add({ id: `gm2-${gid}`, groupId: gid, memberId: 'user', memberType: 'user', role: 'member' });

    const members = await getGroupMembers(gid);

    expect(members).toHaveLength(2);
    const byType = Object.fromEntries(members.map(m => [m.memberType, m]));
    expect(byType.character.character?.name).toBe('测试角色');
    expect(byType.user.character).toBeUndefined();
    expect(byType.user.user?.name).toBe('主人');
  });

  it('群无成员 → 空数组', async () => {
    const members = await getGroupMembers(`g-empty-${uniq()}`);
    expect(members).toEqual([]);
  });

  it('传入已打开的 stores 时复用该连接（不重复开库）', async () => {
    const stores = await getStores();
    const gid = `g-${uniq()}`;
    await stores.group_members.add({ id: `gm-${gid}`, groupId: gid, memberId: 'user', memberType: 'user', role: 'member' });

    const members = await getGroupMembers(gid, stores);
    expect(members).toHaveLength(1);
  });

  it('groupChat.js 的导出与 groupMembers.js 是同一实现（re-export，非副本）', () => {
    expect(getGroupMembersViaGroupChat).toBe(getGroupMembers);
  });
});
