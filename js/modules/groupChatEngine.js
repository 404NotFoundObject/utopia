// js/modules/groupChatEngine.js
import { getStores } from '../core/db.js';
import { getAppState } from '../core/state.js';
import { sendChatRequest } from '../core/api.js';
import { getGameTime } from './time.js';
import { syncCharacterState } from './character.js';
import { getTempParams } from '../core/runtimeParams.js';
import { extractMentionNames } from './mentionUtils.js';

const _autoSpeakLocks = new Set();

function getAutoSpeakSamplingParams(settings) {
  const temp = getTempParams();
  const temperature = (temp.temperature !== null && temp.temperature !== undefined)
    ? temp.temperature
    : 0.8;
  const maxTokens = (temp.maxTokens !== null && temp.maxTokens !== undefined)
    ? temp.maxTokens
    : 400;
  return { temperature, maxTokens };
}

export async function decideSpeaker(groupId, userMessage, context = {}) {
  const stores = await getStores();
  const members = await getGroupMembersWithDetails(groupId, stores);

  const activeCharacters = members
    .filter(m => m.memberType === 'character' && !m.isMuted && m.character)
    .map(m => m.character);

  if (activeCharacters.length === 0) return null;

  const mentioned = extractMentionsFromMessage(userMessage, activeCharacters);
  if (mentioned.length === 1) {
    console.log('[GroupEngine] 检测到 @ 提及，选择:', mentioned[0].name);
    return mentioned[0];
  }
  if (mentioned.length > 1) {
    console.log('[GroupEngine] 多个 @ 提及，选择最近发言最少的');
    return selectByLeastRecent(mentioned, members);
  }

  console.log('[GroupEngine] 无 @ 提及，进入 LLM 裁决');

  const allSorted = (await stores.group_messages.getByIndex('groupId', groupId))
    .sort((a, b) => b.timestamp - a.timestamp);

  const filtered = allSorted.filter((m, idx) =>
    !(idx === 0 && m.senderType === 'user' && m.content === userMessage)
  );

  const recentMessages = filtered.slice(0, 6).reverse();

  const historyText = recentMessages.map(m => {
    if (m.senderType === 'user') return `用户: ${m.content}`;
    const senderName = members.find(mem => mem.memberId === m.senderId)?.character?.name || m.senderId;
    return `${senderName}: ${m.content}`;
  }).join('\n');

  return await llmDecideSpeaker(userMessage, activeCharacters, historyText);
}

async function llmDecideSpeaker(userMessage, characters, historyText) {
  const memberList = characters.map((c, i) =>
    `${i + 1}. ${c.name}（${c.description || '无简介'}）`
  ).join('\n');

  const prompt = `你是一个群聊对话调度器。用户发送了一条消息，你需要决定由群里的哪个角色来回应。

群成员：
${memberList}

${historyText ? `【最近对话】\n${historyText}\n\n` : ''}用户消息：${userMessage}

请根据以下规则选择回应者：
1. 如果消息明显是针对某个角色的（如提到了角色名），优先选择该角色。
2. 如果用户上一条消息 @ 了某角色，或明显在延续与某角色的对话，优先延续该角色。
3. 如果消息是开放性问题，选择最可能感兴趣的角色。
4. 如果消息是面向全体的，选择性格最外向或最近未发言的角色。

请只输出一个角色名（必须是上述列表中的名字），不要输出其他内容。`;

  try {
    const response = await sendChatRequest({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: '你是一个群聊调度器，只输出角色名。',
      temperature: 0.3,
      maxTokens: 50,
      stream: false,
    });
    let name = response.content.trim();
    const matched = characters.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (matched) {
      console.log('[GroupEngine] LLM 裁决选中:', matched.name);
      return matched;
    } else {
      const fallback = characters.find(c => name.includes(c.name) || c.name.includes(name));
      if (fallback) {
        console.log('[GroupEngine] LLM 裁决模糊匹配:', fallback.name);
        return fallback;
      }
      console.warn('[GroupEngine] LLM 返回的名字未匹配任何角色:', name);
      const random = characters[Math.floor(Math.random() * characters.length)];
      console.log('[GroupEngine] 回退到随机选择:', random.name);
      return random;
    }
  } catch (e) {
    console.warn('[GroupEngine] LLM裁决失败，回退随机选择:', e);
    const random = characters[Math.floor(Math.random() * characters.length)];
    console.log('[GroupEngine] 回退到随机选择:', random.name);
    return random;
  }
}

/**
 * 从消息中提取 @ 提及的角色
 * @param {string} message - 消息内容
 * @param {Object[]} characters - 候选角色列表
 * @returns {Object[]} 被提及的角色数组（去重）
 */
export function extractMentionsFromMessage(message, characters) {
  const nameMap = {};
  const idMap = {};
  for (const c of characters) {
    nameMap[c.name] = c;
    idMap[c.id] = c;
  }
  const result = [];
  for (const token of extractMentionNames(message)) {
    // 优先按名字匹配，其次按 ID 匹配
    const found = nameMap[token] || idMap[token];
    if (found && !result.includes(found)) {
      result.push(found);
    }
  }
  return result;
}

function selectByLeastRecent(characters, members) {
  const memberMap = {};
  for (const m of members) {
    if (m.character) memberMap[m.character.id] = m;
  }
  let selected = characters[0];
  let oldest = Infinity;
  for (const c of characters) {
    const m = memberMap[c.id];
    if (m && m.lastActiveAt < oldest) {
      oldest = m.lastActiveAt;
      selected = c;
    }
  }
  return selected;
}

async function getGroupMembersWithDetails(groupId, stores) {
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

export async function runAutoSpeakCycle(groupId, options = {}) {
  if (_autoSpeakLocks.has(groupId)) {
    console.debug(`[GroupEngine] 自主发言仍在进行中，跳过本轮: ${groupId}`);
    return;
  }
  _autoSpeakLocks.add(groupId);

  try {
    const stores = await getStores();
    const group = await stores.groups.get(groupId);
    if (!group || group.status === 'disbanded') return;

    const members = await getGroupMembersWithDetails(groupId, stores);
    const activeCharacters = members
      .filter(m => m.memberType === 'character' && !m.isMuted && m.character)
      .map(m => ({ ...m, character: m.character }));

    for (const member of activeCharacters) {
      const character = member.character;
      const lastActive = member.lastActiveAt || 0;
      const now = getGameTime();

      const probability = calculateSpeakProbability(
        character,
        group,
        lastActive,
        now
      );

      if (Math.random() < probability) {
        await generateAutoSpeak(groupId, character.id, members);
        await sleep(1000);
      }
    }
  } finally {
    _autoSpeakLocks.delete(groupId);
  }
}

function calculateSpeakProbability(character, group, lastActive, now) {
  const extraversion = (character.personalityParameters?.extraversion || 50) / 100;
  const energy = character.bodyState?.energy || 50;
  const elapsed = (now - lastActive) / 1000;
  const interval = group.settings?.autoSpeakInterval || 180;

  let prob = 0.03 * extraversion * (energy / 100);
  const timeFactor = Math.min(1, elapsed / interval);
  prob += 0.08 * timeFactor;

  if (character.bodyState?.specialStates?.includes('亢奋')) {
    prob *= 1.5;
  }
  if (character.bodyState?.specialStates?.includes('萎靡')) {
    prob *= 0.5;
  }

  return Math.min(0.7, Math.max(0.01, prob));
}

async function generateAutoSpeak(groupId, characterId, members) {
  const stores = await getStores();
  const character = await stores.characters.get(characterId);
  if (!character) return;

  const group = await stores.groups.get(groupId);
  if (!group) return;

  try {
    await syncCharacterState(characterId);
  } catch (e) {
    console.warn('[GroupEngine] 同步角色状态失败:', e);
  }

  const recentMessages = (await stores.group_messages.getByIndex('groupId', groupId))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 20)
    .reverse();

  const activeLevel = calculateActiveLevel(members);

  const otherNames = members
    .filter(m => m.memberType === 'character' && m.memberId !== characterId)
    .map(m => m.character?.name)
    .filter(Boolean);

  const taskInstruction = `你正在群聊中"主动发言"。不是回复某条消息，而是根据当前氛围自然说一句（10-30字）。

要求：
- 结合你当前的性格、情感、身体状态，符合人设
- 可以分享心情、回应之前的讨论、承接话题
- 语气自然，像群聊里自然的插话
- 只输出你要说的话，不要添加任何前缀、旁白或第三人称描写
${otherNames.length > 0 ? `- 其他成员：${otherNames.join('、')}。可以 @ 他们` : ''}
- 直接输出你的话`;

  let finalMessages = [];
  let fullSystem = '';
  try {
    const { buildGroupMessagesForAPI } = await import('./groupChat.js');
    const result = await buildGroupMessagesForAPI(
      groupId,
      character,
      '',
      group,
      recentMessages,
      members,
      activeLevel,
      { taskInstruction }
    );
    finalMessages = result.finalMessages;
    fullSystem = result.fullSystem;

    if (finalMessages.length === 0) {
      finalMessages = [{ role: 'user', content: taskInstruction }];
    }
  } catch (e) {
    console.warn('[GroupEngine] buildGroupMessagesForAPI 失败，回退到手拼降级:', e);
    const fallbackOtherNames = otherNames.join('、') || '（无）';
    fullSystem = [
      character.systemPrompt || '',
      `你是群聊中的角色"${character.name}"。`,
      character.description ? `简介：${character.description}` : '',
      character.personality ? `性格：${character.personality}` : '',
      `其他成员：${fallbackOtherNames}`,
    ].filter(Boolean).join('\n\n');
    finalMessages = [{ role: 'user', content: taskInstruction }];
  }

  const state = getAppState();
  const sampling = getAutoSpeakSamplingParams(state.get('settings'));

  try {
    let response = await sendChatRequest({
      messages: finalMessages,
      systemPrompt: fullSystem,
      temperature: sampling.temperature,
      maxTokens: sampling.maxTokens,
      stream: false,
    });

    let content = response.content?.trim();

    if (!content) {
      console.warn(`[GroupEngine] ${character.name} 自主发言首次生成空回复，尝试重试`);
      try {
        response = await sendChatRequest({
          messages: finalMessages,
          systemPrompt: fullSystem,
          temperature: Math.min(2, sampling.temperature + 0.1),
          maxTokens: sampling.maxTokens,
          stream: false,
        });
        content = response.content?.trim();
      } catch (e) {
        console.warn('[GroupEngine] 自主发言重试失败:', e);
      }
    }

    if (content) {
      const mentions = extractMentionsFromMessage(
        content,
        members.filter(m => m.memberType === 'character').map(m => m.character).filter(Boolean)
      );

      const { sendGroupMessage } = await import('./groupChat.js');
      try {
        await sendGroupMessage(
          groupId,
          character.id,
          'character',
          content,
          mentions.map(c => c.id),
          null,   // replyTo
          true    // emitEvent：与原有行为一致
        );
      } catch (sendErr) {
        console.warn('[GroupEngine] 自主发言消息落库失败:', sendErr?.message || sendErr);
      }
    }
  } catch (e) {
    console.warn('[GroupEngine] 自主发言生成失败:', e);
  }
}

function calculateActiveLevel(members) {
  if (!members || members.length === 0) return '正常';
  const now = getGameTime();
  const activeThreshold = 5 * 60 * 1000;
  const activeCount = members.filter(m => {
    const lastActive = m.lastActiveAt || 0;
    return now - lastActive < activeThreshold;
  }).length;
  const ratio = activeCount / members.length;
  if (ratio > 0.7) return '活跃';
  if (ratio > 0.4) return '正常';
  if (ratio > 0.2) return '低活跃';
  return '冷清';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export const GroupChatEngine = {
  decideSpeaker,
  runAutoSpeakCycle,
  calculateSpeakProbability,
  extractMentionsFromMessage,
};

export default GroupChatEngine;