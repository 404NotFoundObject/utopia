// js/modules/groupMembers.js - 群成员查询（唯一实现）
//
// 审计 P3-5：群成员查询（含角色/用户字段补全）此前在 groupChat.js 与
// groupChatEngine.js 各有一份逐行相同的实现。抽到本模块，两个调用方共用，
// 避免「修一处漏一处」。
//
// 之所以不直接由 groupChatEngine 复用 groupChat 的导出：groupChat.js 已
// import groupChatEngine.js（单向依赖），反向 import 会形成循环依赖，故此处分层。

import { getStores } from '../core/db.js';

/**
 * 读取群成员列表，并为每个成员补全 `character`（角色）或 `user`（用户）详情。
 *
 * @param {string} groupId - 群 ID。
 * @param {Object} [storesOverride] - 可选的已打开 stores，避免重复调用 getStores()。
 * @returns {Promise<Array<Object>>} 成员数组，元素为 `{ ...member, character }` 或 `{ ...member, user }`。
 */
export async function getGroupMembers(groupId, storesOverride = null) {
  const stores = storesOverride || await getStores();
  const members = await stores.group_members.getByIndex('groupId', groupId);
  const enriched = [];
  for (const m of members) {
    if (m.memberType === 'character') {
      const char = await stores.characters.get(m.memberId);
      enriched.push({ ...m, character: char });
    } else {
      const settings = await stores.settings.get('app_settings');
      enriched.push({ ...m, user: settings?.user || { name: '用户' } });
    }
  }
  return enriched;
}
