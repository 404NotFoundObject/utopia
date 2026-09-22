// js/modules/groupChat.js
import { getStores, withKeyLock } from '../core/db.js';
import { getAppState } from '../core/state.js';
import { generateUUID } from '../core/utils.js';
import { getGameTime, getTimeContext } from './time.js';
import { GroupChatEngine } from './groupChatEngine.js';
import { sendChatRequest } from '../core/api.js';
import { syncCharacterState } from './character.js';
import globalEventBus from '../core/eventBus.js';
import * as groupChatUI from '../ui/screens/groupChatUI.js';
import { extractMentionNames } from './mentionUtils.js';
import {
  buildConvStateOnMessage,
  normalizeConvState,
  extractSceneByKeywords,
  extractSceneBySemantic,
} from './conversationState.js';
import { buildCrossDayPrompt } from './crossDayAwareness.js';
import { analyzeAndBuildTransition } from './transitionDecider.js';
import { SCENE_REGISTRY } from './sceneRegistry.js';
import { getTempParams } from '../core/runtimeParams.js';
import { applyInjection } from './injector.js';
import { buildEmotionPrompt } from './emotionEngine.js';
import { buildBodyPrompt } from './bodyState.js';
import {
  fitContextByBudget,
  systemMsg,
  PRIORITY,
  computeBudget,
  getWorldBookBudgetRatio,
} from './tokenBudget.js';

function toFiniteNumber(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function extractMentionsByName(text, members) {
  if (!text) return [];
  const nameMap = Object.create(null);
  for (const m of members) {
    if (m.memberType === 'character' && m.character && m.character.name) {
      nameMap[m.character.name] = m.character;
    }
  }
  const mentioned = [];
  const seen = new Set();
  for (const name of extractMentionNames(text)) {
    const char = nameMap[name];
    if (char && !seen.has(char.id)) {
      seen.add(char.id);
      mentioned.push(char);
    }
  }
  return mentioned;
}

function getGroupSamplingParams(settings) {
  const temp = getTempParams();
  const s = settings || {};
  const tempOverride = toFiniteNumber(temp.temperature);
  const settingsTemp = toFiniteNumber(s.temperature);
  const temperature = tempOverride ?? settingsTemp ?? 0.7;
  const maxOverride = toFiniteNumber(temp.maxTokens);
  const maxTokens = maxOverride ?? 400;
  return { temperature, maxTokens };
}

const _summaryLocks = new Set();

/**
 * 计算群组活跃度
 */
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

function getConversationStateSettings() {
  const settings = getAppState().get('settings') || {};
  const cs = settings.conversationState || {};
  return {
    enabled: cs.enabled !== false,
    crossDayEnabled: cs.crossDayEnabled !== false,
    transitionEnabled: cs.transitionEnabled !== false,
  };
}

function refreshCharacterFromState(characterId) {
  const fresh = (getAppState().get('characters') || []).find(c => c.id === characterId);
  return fresh || null;
}

async function buildFakeConvForGroup(groupId) {
  const stores = await getStores();
  const group = await stores.groups.get(groupId);
  if (!group) return null;
  const messages = await getGroupMessages(groupId, 50);
  const convMessages = messages.map(m => ({
    id: m.id,
    role: m.senderType === 'user' ? 'user' : 'assistant',
    content: m.content,
    timestamp: m.timestamp,
  }));
  return {
    id: group.id,
    characterId: null,
    messages: convMessages,
    convState: group.convState || null,
    updatedAt: group.updatedAt,
  };
}

async function updateGroupConversationScene(group, messages) {
  const state = normalizeConvState(group);
  const convMessages = (messages || []).filter(m => m.senderType === 'user' || m.senderType === 'character');
  if (convMessages.length === 0) return null;

  const lastMsg = convMessages[convMessages.length - 1];
  if (lastMsg.senderType !== 'user') {
    if (state.currentScene) {
      state.currentScene.lastSeenAt = lastMsg.timestamp || getGameTime();
    }
    return state.currentScene;
  }

  const keywordMessages = convMessages.map(m => ({
    role: m.senderType === 'user' ? 'user' : 'assistant',
    content: m.content,
    timestamp: m.timestamp,
  }));

  let sceneResult = extractSceneByKeywords(keywordMessages);
  if (!sceneResult) {
    sceneResult = await extractSceneBySemantic(keywordMessages);
  }

  if (!sceneResult) {
    if (state.currentScene) {
      state.currentScene.lastSeenAt = lastMsg.timestamp || getGameTime();
      return state.currentScene;
    }
    return null;
  }

  const now = lastMsg.timestamp || getGameTime();
  const oldScene = state.currentScene;

  if (oldScene?.type === sceneResult.type) {
    state.currentScene = {
      ...oldScene,
      lastSeenAt: now,
      confidence: Math.max(oldScene.confidence || 0, sceneResult.confidence),
      method: sceneResult.method,
    };
  } else {
    state.currentScene = {
      type: sceneResult.type,
      label: SCENE_REGISTRY[sceneResult.type].label,
      startedAt: now,
      lastSeenAt: now,
      confidence: sceneResult.confidence,
      method: sceneResult.method,
    };
  }

  return state.currentScene;
}

async function buildGroupContextPrompts(groupId, character, userMessage) {
  const result = {
    crossDayPrompt: '',
    transitionPrompt: '',
    decision: { strategy: 'none' },
  };

  const csSettings = getConversationStateSettings();
  if (!csSettings.enabled) return result;

  try {
    const fakeConv = await buildFakeConvForGroup(groupId);
    if (!fakeConv) return result;

    if (csSettings.crossDayEnabled) {
      try {
        result.crossDayPrompt = buildCrossDayPrompt(fakeConv, character, { scene: 'group' });
      } catch (e) {
        console.warn('[GroupChat] 群聊跨天感知失败:', e);
      }
    }

    if (csSettings.transitionEnabled && userMessage) {
      try {
        const transitionResult = await analyzeAndBuildTransition(fakeConv, character, userMessage);
        result.transitionPrompt = transitionResult.prompt;
        result.decision = transitionResult.decision;
      } catch (e) {
        console.warn('[GroupChat] 群聊场景转场失败:', e);
      }
    }
  } catch (e) {
    console.warn('[GroupChat] 构建群聊上下文提示失败:', e);
  }

  return result;
}

export async function buildGroupMessagesForAPI(
  groupId,
  character,
  userMessage,
  group,
  recentMessages,
  members,
  activeLevel,
  opts = {}
) {
  const state = getAppState();
  const settings = state.get('settings') || {};

  const memberNameMap = {};
  const charMembers = [];
  for (const m of members) {
    if (m.memberType === 'character' && m.character) {
      memberNameMap[m.character.id] = m.character.name;
      charMembers.push(m.character);
    }
  }
  const charCount = charMembers.length;
  const memberNames = charMembers.map(c => c.name).filter(Boolean).join('、');

  const defaultTaskInstruction = `请以"${character.name}"的身份，回复群聊中最近的用户消息。
- 只输出角色说的话，不要添加旁白或第三人称描写
- 保持角色人设和语气一致
- 长度 10-50 字
- 如需 @ 其他角色，格式为 "@角色名"`;
  const taskInstruction = opts.taskInstruction || defaultTaskInstruction;

  const systemMessages = [];

  const groupPersona = `【群聊情境】
你正在一个群聊中，你的身份是"${character.name}"。

群组：${group.name || '（未命名）'}
描述：${group.description || '（无）'}
成员数：${charCount} 人
成员：${memberNames || '（无）'}
活跃度：${activeLevel}

【本次任务】
${taskInstruction}

【输出格式】
历史消息中，其他成员的发言被包裹在 <speaker name="角色名">...</speaker> 中，这是系统标记，用于区分发言人。
你的输出只包含台词本身，不要包含任何 <speaker> 标签、方括号前缀或 "角色名:" 前缀。

【@提及规则】
如需 @ 群里的其他成员，请使用 "@成员名字" 的格式，例如 "@猫猫"。
⚠️ 严禁使用任何 ID、UUID、数字串或哈希值作为 @ 的目标。只能使用成员列表中显示的名字。

✅ 正确输出示例（直接输出台词）：
@猫猫 你今天看起来很开心

❌ 错误输出示例（不要这样）：
@a1b2c3d4-e5f6-7890 你今天看起来很开心
<speaker name="凌川">你今天看起来很开心</speaker>
[凌川] 你今天看起来很开心
凌川: 你今天看起来很开心`;

  systemMessages.push(systemMsg(groupPersona, 'group_persona', PRIORITY.IDENTITY));

  const emotionPrompt = buildEmotionPrompt(character);
  if (emotionPrompt) {
    systemMessages.push(systemMsg(emotionPrompt, 'emotion', PRIORITY.EMOTION));
  }

  const bodyPrompt = buildBodyPrompt(character);
  if (bodyPrompt) {
    systemMessages.push(systemMsg(bodyPrompt, 'body', PRIORITY.BODY));
  }

  if (userMessage) {
    try {
      const { searchMemories } = await import('./memory.js');
      const memories = await searchMemories(character.id, userMessage, 5);
      if (memories.length > 0) {
        const memLines = memories.map((mem, i) =>
          `[${i + 1}] 用户曾说："${mem.userMessage}"\n你曾回答："${mem.assistantMessage}"`
        ).join('\n');
        systemMessages.push(systemMsg(`【长期记忆】\n${memLines}`, 'memory', PRIORITY.MEMORY));
      }
    } catch (e) {
      console.warn('[GroupChat] 记忆检索失败:', e);
    }
  }

  if (group.summary) {
    systemMessages.push(systemMsg(`【群聊摘要】${group.summary}`, 'summary', PRIORITY.SUMMARY));
  }

  try {
    const contextPrompts = await buildGroupContextPrompts(groupId, character, userMessage || '');
    if (contextPrompts.crossDayPrompt) {
      systemMessages.push(systemMsg(contextPrompts.crossDayPrompt, 'crossday', PRIORITY.CROSS_DAY));
    }
    if (contextPrompts.transitionPrompt) {
      systemMessages.push(systemMsg(contextPrompts.transitionPrompt, 'transition', PRIORITY.TRANSITION));
    }
  } catch (e) {
    console.warn('[GroupChat] 构建上下文提示失败:', e);
  }

  const pendingInjection = state.get('pendingInjection');
  if (pendingInjection) {
    systemMessages.push(systemMsg(`【临时注入】${pendingInjection}`, 'injection', PRIORITY.USER_CONTEXT));
    state.set('pendingInjection', null);
  }

  const historyMessages = [];
  for (const m of recentMessages) {
    if (m.senderType === 'user') {
      historyMessages.push({ role: 'user', content: m.content });
    } else {
      const name = memberNameMap[m.senderId] || m.senderId;
      
      historyMessages.push({ role: 'assistant', content: `<speaker name="${name}">${m.content}</speaker>` });
    }
  }

  const modelName = settings?.modelName;
  const tbEnabled = settings.tokenBudget?.enabled !== false;
  const wbBudgetRatio = getWorldBookBudgetRatio();

  let worldBookBudget;
  let systemBudgetOverride;
  {
    const rawBudget = computeBudget(modelName);
    const rawSystemBudget = rawBudget.breakdown.system;
    worldBookBudget = Math.floor(rawSystemBudget * wbBudgetRatio);
    systemBudgetOverride = tbEnabled ? rawSystemBudget - worldBookBudget : undefined;
  }

  const budgetResult = fitContextByBudget({
    modelName,
    systemMessages,
    historyMessages,
    userMessage: '',
    summary: '',
    systemBudgetOverride,
  });

  const messagesForAPI = [
    ...budgetResult.systemKept.map(m => ({ role: 'system', content: m.content })),
    ...budgetResult.historyKept,
  ];

  const timeContext = getTimeContext();
  const context = {
    character,
    emotionState: character.emotionState,
    bodyState: character.bodyState,
    user: {
      ...(settings.user || { name: '用户' }),
      message: userMessage || '',
    },
    group: {
      id: groupId,
      name: group.name || '',
      description: group.description || '',
      memberCount: charCount,
      activeLevel: activeLevel,
      rules: (group.settings && group.settings.rules) || '',
      members: memberNames,
    },
    groupId,
    conversation: { messages: recentMessages },
    ...timeContext,
  };

  let finalMessages = [];
  let fullSystem = '';
  try {
    const result = await applyInjection(messagesForAPI, context, { worldBookBudget });
    fullSystem = result
      .filter(msg => msg.role === 'system')
      .map(msg => msg.content)
      .join('\n\n');
    finalMessages = result.filter(msg => msg.role !== 'system');
  } catch (e) {
    console.warn('[GroupChat] 注入器执行失败，使用降级方案:', e);
    const degradedSystemMsgs = messagesForAPI
      .filter(msg => msg.role === 'system')
      .map(msg => msg.content)
      .filter(c => c && c.trim());
    fullSystem = [
      character.systemPrompt || '',
      ...degradedSystemMsgs,
    ].filter(Boolean).join('\n\n');
    finalMessages = messagesForAPI.filter(msg => msg.role !== 'system');
  }

  return { finalMessages, fullSystem };
}

export async function createGroup(name, ownerId = 'user', avatar = '', chatBg = '') {
  const stores = await getStores();
  const group = {
    id: generateUUID(),
    name,
    avatar,
    chatBg,
    description: '',
    ownerId,
    createdAt: getGameTime(),
    updatedAt: getGameTime(),
    settings: {
      allowInvite: true,
      autoSpeakInterval: 180,
      activeThreshold: 0.3,
      rules: '',
    },
    status: 'active',
    convState: null,
    summary: '',
    lastSummaryIndex: 0,
  };
  await stores.groups.add(group);
  await addGroupMember(group.id, ownerId, 'user', 'owner');
  globalEventBus.emit('group:created', { group });
  return group;
}

export async function getGroup(groupId) {
  const stores = await getStores();
  return await stores.groups.get(groupId);
}

export async function updateGroup(groupId, updates) {
  return withKeyLock('group_state', groupId, async () => {
    const stores = await getStores();
    const existing = await stores.groups.get(groupId);
    if (!existing) throw new Error('群组不存在');
    const updated = { ...existing, ...updates, updatedAt: getGameTime() };
    await stores.groups.update(groupId, updated);
    return updated;
  });
}

export async function disbandGroup(groupId) {
  const stores = await getStores();
  const group = await stores.groups.get(groupId);
  if (!group) return false;

  try {
    const messages = await stores.group_messages.getByIndex('groupId', groupId);
    for (const msg of messages) {
      await stores.group_messages.delete(msg.id);
    }

    const members = await stores.group_members.getByIndex('groupId', groupId);
    for (const member of members) {
      if (member.memberType === 'character') {
        const char = await stores.characters.get(member.memberId);
        if (char && char.groups) {
          char.groups = char.groups.filter(id => id !== groupId);
          await stores.characters.update(member.memberId, char);
        }
      }
      await stores.group_members.delete(member.id);
    }

    await stores.groups.delete(groupId);

    try {
      const groupRules = await stores.world_book.getByIndex('scope', `group:${groupId}`);
      if (groupRules.length > 0) {
        for (const rule of groupRules) {
          await stores.world_book.delete(rule.id);
        }
        console.log(`[GroupChat] 已清理群组 ${groupId} 的 ${groupRules.length} 条世界书规则`);
        try {
          const { reloadWorldBookRules } = await import('./worldBook.js');
          await reloadWorldBookRules();
        } catch (e) {
          console.warn('[GroupChat] 重建世界书规则失败:', e);
        }
      }
    } catch (e) {
      console.warn('[GroupChat] 清理群组世界书规则失败:', e);
    }

    _summaryLocks.delete(groupId);
    globalEventBus.emit('group:disbanded', { groupId });
    return true;
  } catch (error) {
    console.error('[GroupChat] 解散群组失败:', error);
    return false;
  }
}

export async function getGroupsByUser(userId = 'user') {
  const stores = await getStores();
  const members = await stores.group_members.getByIndex('memberId', userId);
  const groupIds = members.map(m => m.groupId);
  const groups = [];
  for (const id of groupIds) {
    const g = await stores.groups.get(id);
    if (g && g.status === 'active') groups.push(g);
  }
  return groups;
}

export async function addGroupMember(groupId, memberId, memberType, role = 'member') {
  const stores = await getStores();
  const member = {
    id: generateUUID(),
    groupId,
    memberId,
    memberType,
    role,
    joinedAt: getGameTime(),
    mutedUntil: null,
    isMuted: false,
    lastActiveAt: getGameTime(),
    speakCount: 0,
  };
  await stores.group_members.add(member);

  if (memberType === 'character') {
    const char = await stores.characters.get(memberId);
    if (char) {
      if (!char.groups) char.groups = [];
      if (!char.groups.includes(groupId)) {
        char.groups.push(groupId);
        await stores.characters.update(memberId, char);
      }
    }
  }
  globalEventBus.emit('group:member-added', { groupId, member });
  return member;
}

export async function removeGroupMember(groupId, memberId, memberType) {
  const stores = await getStores();
  const members = await stores.group_members.getByIndex('groupId', groupId);
  const target = members.find(m => m.memberId === memberId && m.memberType === memberType);
  if (!target) return false;
  await stores.group_members.delete(target.id);

  if (memberType === 'character') {
    const char = await stores.characters.get(memberId);
    if (char && char.groups) {
      char.groups = char.groups.filter(id => id !== groupId);
      await stores.characters.update(memberId, char);
    }
  }
  globalEventBus.emit('group:member-removed', { groupId, memberId, memberType });
  return true;
}

export async function getGroupMembers(groupId) {
  const stores = await getStores();
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

export async function setGroupMemberMute(groupId, memberId, memberType, durationSeconds = null) {
  const stores = await getStores();
  const members = await stores.group_members.getByIndex('groupId', groupId);
  const target = members.find(m => m.memberId === memberId && m.memberType === memberType);
  if (!target) return false;
  target.isMuted = true;
  target.mutedUntil = durationSeconds ? Date.now() + durationSeconds * 1000 : null;
  await stores.group_members.update(target.id, target);
  globalEventBus.emit('group:member-muted', { groupId, memberId, memberType });
  return true;
}

export async function unMuteGroupMember(groupId, memberId, memberType) {
  const stores = await getStores();
  const members = await stores.group_members.getByIndex('groupId', groupId);
  const target = members.find(m => m.memberId === memberId && m.memberType === memberType);
  if (!target) return false;
  target.isMuted = false;
  target.mutedUntil = null;
  await stores.group_members.update(target.id, target);
  globalEventBus.emit('group:member-unmuted', { groupId, memberId, memberType });
  return true;
}

export async function deleteGroupMessage(messageId) {
  const stores = await getStores();
  const msg = await stores.group_messages.get(messageId);
  if (!msg) return false;
  await stores.group_messages.delete(messageId);
  return true;
}

export async function deleteGroupMessages(messageIds) {
  const stores = await getStores();
  for (const id of messageIds) {
    await stores.group_messages.delete(id);
  }
  return true;
}

export async function sendGroupMessage(groupId, senderId, senderType, content, mentions = [], replyTo = null, emitEvent = true) {
  const stores = await getStores();

  if (senderType === 'character') {
    const members = await stores.group_members.getByIndex('groupId', groupId);
    const member = members.find(m => m.memberId === senderId && m.memberType === senderType);
    if (member?.isMuted) {
      const until = member.mutedUntil;
      if (until === null || Date.now() < until) {
        throw new Error(`${senderId} 被禁言`);
      }
      await unMuteGroupMember(groupId, senderId, senderType);
    }
  }

  const msg = {
    id: generateUUID(),
    groupId,
    senderId,
    senderType,
    content,
    mentions,
    replyTo,
    timestamp: getGameTime(),
    isSystem: false,
  };
  await stores.group_messages.add(msg);

  const members = await stores.group_members.getByIndex('groupId', groupId);
  const member = members.find(m => m.memberId === senderId && m.memberType === senderType);
  if (member) {
    member.lastActiveAt = getGameTime();
    member.speakCount = (member.speakCount || 0) + 1;
    await stores.group_members.update(member.id, member);
  }

  const csSettings = getConversationStateSettings();
  if (csSettings.enabled) {
    try {
      await withKeyLock('group_state', groupId, async () => {
        const group = await stores.groups.get(groupId);
        if (!group) return;

        const fakeMessage = {
          role: senderType === 'user' ? 'user' : 'assistant',
          content,
          timestamp: msg.timestamp,
        };
        const fakeConv = { ...group, messages: [] };
        const newState = buildConvStateOnMessage(fakeConv, fakeMessage);

        if (group.convState?.currentScene) {
          newState.currentScene = group.convState.currentScene;
        }
        group.convState = newState;

        try {
          const allMessages = await getGroupMessages(groupId, 20);
          const newScene = await updateGroupConversationScene(group, allMessages);
          if (newScene) {
            group.convState.currentScene = newScene;
          }
        } catch (e) {
          console.warn('[GroupChat] 群聊场景识别失败:', e);
        }

        group.updatedAt = getGameTime();
        await stores.groups.update(groupId, group);
      });
    } catch (e) {
      console.warn('[GroupChat] 更新群聊状态机失败:', e);
    }
  }

  if (emitEvent) {
    globalEventBus.emit('group:message', { groupId, message: msg });
  }

  Promise.resolve()
    .then(() => maybeGenerateGroupSummary(groupId))
    .catch(() => {});

  return msg;
}

export async function getGroupMessages(groupId, limit = 50) {
  const stores = await getStores();
  const all = await stores.group_messages.getByIndex('groupId', groupId);
  return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit).reverse();
}

export async function maybeGenerateGroupSummary(groupId) {
  if (_summaryLocks.has(groupId)) return;
  _summaryLocks.add(groupId);

  try {
    const settings = getAppState().get('settings') || {};
    if (settings.summaryEnabled === false) return;

    const frequency = settings.summaryFrequency ?? 10;
    if (frequency <= 0) return;
    const maxLen = settings.summaryMaxLength ?? 200;

    const stores = await getStores();
    const group = await stores.groups.get(groupId);
    if (!group) return;

    const all = await stores.group_messages.getByIndex('groupId', groupId);
    all.sort((a, b) => a.timestamp - b.timestamp);

    const lastIdx = group.lastSummaryIndex || 0;
    if (all.length - lastIdx < frequency) return;

    const sliceEnd = Math.min(lastIdx + frequency, all.length);
    const toSummarize = all.slice(lastIdx, sliceEnd);

    const charNameCache = new Map();
    const lines = [];
    for (const m of toSummarize) {
      let sender;
      if (m.senderType === 'user') {
        sender = '用户';
      } else {
        if (!charNameCache.has(m.senderId)) {
          const char = await stores.characters.get(m.senderId);
          charNameCache.set(m.senderId, char?.name || m.senderId.slice(0, 8));
        }
        sender = charNameCache.get(m.senderId);
      }
      lines.push(`${sender}: ${m.content}`);
    }
    const text = lines.join('\n');

    const prompt =
      `你是一个对话摘要助手。请根据以下群聊记录，生成一段简洁的摘要，` +
      `保留关键信息（参与角色、讨论主题、重要情节等）。` +
      `${group.summary ? '已有的摘要如下，请在此基础上更新：\n' + group.summary : ''}\n` +
      `群聊记录：\n${text}\n\n` +
      `请生成新的摘要，不超过 ${maxLen} 个token，语言简洁，只包含关键事实。`;

    const response = await sendChatRequest({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: '你是一个对话摘要专家，只输出摘要文本，不要添加额外内容。',
      temperature: 0.3,
      maxTokens: maxLen,
      stream: false,
    });

    const newSummary = (response.content || '').trim();
    if (!newSummary) return;

    await withKeyLock('group_state', groupId, async () => {
      const fresh = await stores.groups.get(groupId);
      if (!fresh) return;
      if ((fresh.lastSummaryIndex || 0) >= sliceEnd) return;

      fresh.summary = newSummary;
      fresh.lastSummaryIndex = sliceEnd;
      fresh.updatedAt = getGameTime();
      await stores.groups.update(groupId, fresh);
    });
  } catch (e) {
    console.warn('[GroupChat] 群聊摘要生成失败:', e);
  } finally {
    _summaryLocks.delete(groupId);
  }
}

export async function generateCharacterReplyStream(groupId, characterId, userMessage, opts = {}) {
  const { mentionDepth = 0, repliedSet = null } = opts;

  const stores = await getStores();
  let character = await stores.characters.get(characterId);
  if (!character) return { content: '', mentions: [] };

  const group = await stores.groups.get(groupId);
  if (!group) return { content: '', mentions: [] };

  await syncCharacterState(characterId);

  {
    const fresh = refreshCharacterFromState(characterId);
    if (fresh) {
      character = fresh;
    }
  }

  const recentMessages = await getGroupMessages(groupId, 20);
  const members = await getGroupMembers(groupId);
  const activeLevel = calculateActiveLevel(members);

  const { finalMessages, fullSystem } = await buildGroupMessagesForAPI(
    groupId,
    character,
    userMessage,
    group,
    recentMessages,
    members,
    activeLevel
  );

  const tempMsgId = generateUUID();
  const tempMsg = {
    id: tempMsgId,
    groupId,
    senderId: character.id,
    senderType: 'character',
    senderName: character.name,
    content: '',
    mentions: [],
    replyTo: null,
    timestamp: Date.now(),
    isSystem: false,
    _temp: true,
  };

  const stateBeforeAppend = getAppState();
  if (stateBeforeAppend.get('currentMode') !== 'group'
      || stateBeforeAppend.get('currentGroupId') !== groupId) {
    console.debug(
      `[GroupChat] 群聊角色回复跳过 DOM 追加：目标已切换 ` +
      `(now=${stateBeforeAppend.get('currentGroupId')}, target=${groupId})`
    );
    return { content: '', mentions: [] };
  }

  groupChatUI.appendGroupMessage(tempMsg);

  const state = getAppState();
  const sampling = getGroupSamplingParams(state.get('settings'));

  let finalContent = '';
  let mentionedCharacters = [];

  try {
    await sendChatRequest({
      messages: finalMessages,
      systemPrompt: fullSystem,
      temperature: sampling.temperature,
      maxTokens: sampling.maxTokens,
      stream: true,
      onChunk: (chunk) => {
        finalContent += chunk;
        groupChatUI.updateGroupMessageContent(tempMsgId, finalContent);
      },
    });

    if (finalContent.trim()) {
      const mentions = GroupChatEngine.extractMentionsFromMessage(
        finalContent,
        members.filter(m => m.memberType === 'character').map(m => m.character).filter(Boolean)
      );
      mentionedCharacters = mentions;

      await sendGroupMessage(groupId, character.id, 'character', finalContent, mentions.map(c => c.id), null, false);

      try {
        const { addMemory } = await import('./memory.js');
        await addMemory(character.id, userMessage, finalContent);
      } catch (e) {
        console.warn('[GroupChat] 记忆存储失败:', e);
      }

      groupChatUI.unmarkGroupStreaming(tempMsgId);
      await groupChatUI.renderMessages(groupId);
    } else {
      groupChatUI.removeGroupMessage(tempMsgId);
    }
  } catch (e) {
    console.warn('[GroupChat] 角色回复生成失败:', e);
    groupChatUI.removeGroupMessage(tempMsgId);
  }

  if (
    mentionDepth < 1 &&
    finalContent.trim() &&
    mentionedCharacters.length > 0
  ) {
    for (const target of mentionedCharacters) {
      if (target.id === character.id) continue;
      if (repliedSet && repliedSet.has(target.id)) continue;
      if (repliedSet) repliedSet.add(target.id);

      await sleep(800);
      try {
        await generateCharacterReplyStream(groupId, target.id, finalContent, {
          mentionDepth: mentionDepth + 1,
          repliedSet,
        });
      } catch (e) {
        console.warn(`[GroupChat] 被 @ 角色 ${target.name} 回复失败:`, e);
      }
    }
  }

  return { content: finalContent, mentions: mentionedCharacters };
}

export async function generateCharacterReplySync(groupId, characterId, userMessage) {
  const stores = await getStores();
  let character = await stores.characters.get(characterId);
  if (!character) return;

  const group = await stores.groups.get(groupId);
  if (!group) return;

  await syncCharacterState(characterId);

  {
    const fresh = refreshCharacterFromState(characterId);
    if (fresh) {
      character = fresh;
    }
  }

  const recentMessages = await getGroupMessages(groupId, 20);
  const members = await getGroupMembers(groupId);
  const activeLevel = calculateActiveLevel(members);

  const { finalMessages, fullSystem } = await buildGroupMessagesForAPI(
    groupId,
    character,
    userMessage,
    group,
    recentMessages,
    members,
    activeLevel
  );

  const state = getAppState();
  const sampling = getGroupSamplingParams(state.get('settings'));

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
      try {
        response = await sendChatRequest({
          messages: finalMessages,
          systemPrompt: fullSystem,
          temperature: Math.min(2, sampling.temperature + 0.2),
          maxTokens: sampling.maxTokens,
          stream: false,
        });
        content = response.content?.trim();
      } catch (e) {
        console.warn('[GroupChat] 重试失败:', e);
      }
    }

    if (content) {
      const members2 = await getGroupMembers(groupId);
      const mentions = GroupChatEngine.extractMentionsFromMessage(
        content,
        members2.filter(m => m.memberType === 'character').map(m => m.character).filter(Boolean)
      );
      await sendGroupMessage(groupId, character.id, 'character', content, mentions.map(c => c.id));

      try {
        const { addMemory } = await import('./memory.js');
        await addMemory(character.id, userMessage, content);
      } catch (e) {
        console.warn('[GroupChat] 记忆存储失败:', e);
      }
    }
  } catch (e) {
    console.warn('[GroupChat] 角色回复生成失败:', e);
  }
}

export const generateCharacterReply = generateCharacterReplySync;

export async function sendUserGroupMessage(groupId, content) {
  const { executeCommand } = await import('./commandEngine.js');
  const { showBanner } = await import('../ui/components/banner.js');
  const state = getAppState();

  if (state.get('sending')) {
    console.warn('[GroupChat] 已有消息正在发送中，忽略本次群聊请求');
    return;
  }
  state.set('sending', true);

  try {
    const group = await getGroup(groupId);
    if (!group) {
      showBanner('❌ 群组不存在', 3000, 'error');
      return;
    }
    const members = await getGroupMembers(groupId);
    const memberNames = members
      .filter(m => m.memberType === 'character' && m.character)
      .map(m => m.character.name)
      .join('、');
    const activeLevel = calculateActiveLevel(members);

    const groupWithDetails = {
      ...group,
      memberCount: members.length,
      members: memberNames || '无成员',
      activeLevel: activeLevel,
    };

    const commandContext = {
      character: null,
      conversation: { messages: await getGroupMessages(groupId, 20) },
      state: state,
      settings: state.get('settings') || {},
      group: groupWithDetails,
      groupId: groupId,
    };

    const cmdResult = await executeCommand(content, commandContext);
    if (cmdResult.handled) {
      if (cmdResult.banner) {
        showBanner(cmdResult.banner, 4000, cmdResult.banner.includes('❌') ? 'error' : 'info');
      }
      return;
    }

    const nameMap = {};
    for (const m of members) {
      if (m.memberType === 'character' && m.character) {
        nameMap[m.character.name] = m.memberId;
      }
    }
    const mentions = [];
    for (const name of extractMentionNames(content)) {
      const id = nameMap[name];
      if (id && !mentions.includes(id)) {
        mentions.push(id);
      }
    }

    await sendGroupMessage(groupId, 'user', 'user', content, mentions);

    const repliedSet = new Set();
    const mentionedCharacters = extractMentionsByName(content, members);

    if (mentionedCharacters.length > 0) {
      for (const char of mentionedCharacters) {
        if (repliedSet.has(char.id)) continue;
        repliedSet.add(char.id);

        try {
          await generateCharacterReplyStream(groupId, char.id, content, {
            mentionDepth: 0,
            repliedSet,
          });
        } catch (e) {
          console.warn(`[GroupChat] 被 @ 角色 ${char.name} 回复失败:`, e);
        }

        if (mentionedCharacters.length > 1) {
          await sleep(800);
        }
      }
    } else {
      const speaker = await GroupChatEngine.decideSpeaker(groupId, content);
      if (speaker && !repliedSet.has(speaker.id)) {
        repliedSet.add(speaker.id);
        try {
          await generateCharacterReplyStream(groupId, speaker.id, content, {
            mentionDepth: 0,
            repliedSet,
          });
        } catch (e) {
          console.warn(`[GroupChat] 角色 ${speaker.name} 回复失败:`, e);
        }
      }
    }

    setTimeout(() => {
      GroupChatEngine.runAutoSpeakCycle(groupId).catch(console.warn);
    }, 5000);
  } finally {
    state.set('sending', false);
  }
}