// js/modules/groupChatOperations.js - 群聊高级操作（撤回、重新生成、禁言、移出）
import { getStores } from '../core/db.js';
import { getAppState } from '../core/state.js';
import { generateUUID } from '../core/utils.js';
import { showToast } from '../ui/components/toast.js';
import { getGroup, getGroupMembers, sendGroupMessage, deleteGroupMessage } from './groupChat.js';
import { deleteMemory, addMemory } from './memory.js';
import { GroupChatEngine } from './groupChatEngine.js';

/**
 * 撤回最后一条用户消息及其对应的角色回复（如果有）
 */
export async function undoLastUserMessage(groupId) {
  const stores = await getStores();
  const messages = await stores.group_messages.getByIndex('groupId', groupId);
  messages.sort((a, b) => a.timestamp - b.timestamp);

  // 1. 查找最后一条用户消息
  let userMsgIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].senderType === 'user') {
      userMsgIndex = i;
      break;
    }
  }
  if (userMsgIndex === -1) {
    return { success: false, reason: '没有可撤回的用户消息' };
  }
  const userMsg = messages[userMsgIndex];

  // 2. 查找该用户消息之后的第一条角色回复（可能没有）
  let replyMsg = null;
  for (let i = userMsgIndex + 1; i < messages.length; i++) {
    if (messages[i].senderType === 'character') {
      replyMsg = messages[i];
      break;
    }
  }

  // 3. 删除用户消息和角色回复（如果有）
  await deleteGroupMessage(userMsg.id);
  if (replyMsg) {
    await deleteGroupMessage(replyMsg.id);
  }

  if (replyMsg) {
    const memories = await stores.memories.getByIndex('characterId', replyMsg.senderId);
    for (const mem of memories) {
      if (mem.userMessage === userMsg.content &&
          mem.assistantMessage === replyMsg.content &&
          Math.abs(mem.timestamp - userMsg.timestamp) < 5000) {
        await deleteMemory(mem.id);
      }
    }
  }

  return { success: true };
}

/**
 * 重新生成角色回复
 */
export async function regenerateGroupReply(groupId, messageId, userMessage) {
  const stores = await getStores();
  const msg = await stores.group_messages.get(messageId);
  if (!msg || msg.senderType !== 'character') {
    return { success: false, reason: '消息不存在或不是角色回复' };
  }

  await deleteGroupMessage(messageId);

  const memories = await stores.memories.getByIndex('characterId', msg.senderId);
  for (const mem of memories) {
    if (mem.userMessage === userMessage && mem.assistantMessage === msg.content) {
      await deleteMemory(mem.id);
    }
  }

  const { generateCharacterReply } = await import('./groupChat.js');
  await generateCharacterReply(groupId, msg.senderId, userMessage);

  return { success: true };
}

/**
 * 禁言成员（仅群主）
 */
export async function muteGroupMember(groupId, memberId, durationSeconds = 600, operatorId = 'user') {
  const stores = await getStores();
  const group = await stores.groups.get(groupId);
  if (!group) throw new Error('群组不存在');

  if (group.ownerId !== operatorId) {
    throw new Error('只有群主可以禁言成员');
  }

  const { setGroupMemberMute } = await import('./groupChat.js');
  await setGroupMemberMute(groupId, memberId, 'character', durationSeconds);
  showToast('已禁言', 'success');
}

/**
 * 移出成员（仅群主）
 */
export async function removeGroupMember(groupId, memberId, operatorId = 'user') {
  const stores = await getStores();
  const group = await stores.groups.get(groupId);
  if (!group) throw new Error('群组不存在');
  if (group.ownerId !== operatorId) {
    throw new Error('只有群主可以移出成员');
  }

  const { removeGroupMember: removeMember } = await import('./groupChat.js');
  await removeMember(groupId, memberId, 'character');
  showToast('已移出群聊', 'success');
}

/**
 * 获取当前用户在群组中的权限
 */
export async function getUserRoleInGroup(groupId, userId = 'user') {
  const stores = await getStores();
  const members = await stores.group_members.getByIndex('groupId', groupId);
  const target = members.find(m => m.memberId === userId && m.memberType === 'user');
  return target ? target.role : null;
}