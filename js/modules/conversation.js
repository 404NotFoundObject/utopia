// js/modules/conversation.js - 会话管理模块
import { getStores, withKeyLock } from '../core/db.js';
import { getAppState } from '../core/state.js';
import { generateUUID } from '../core/utils.js';
import {
  buildConvStateOnMessage,
  updateConversationScene,
  normalizeConvState,
} from './conversationState.js';

let _stores = null;
async function getS() {
  if (!_stores) _stores = await getStores();
  return _stores;
}

const ensureLocks = new Map();

function isConversationStateEnabled() {
  const settings = getAppState().get('settings') || {};
  const cs = settings.conversationState || {};
  return cs.enabled !== false;
}

function replaceConvInList(list, convId, newConv) {
  if (!Array.isArray(list)) return [];
  let replaced = false;
  const next = list.map(c => {
    if (c.id === convId) {
      replaced = true;
      return newConv;
    }
    return c;
  });
  return replaced ? next : list;
}

function syncConvToState(convId, conv) {
  const state = getAppState();
  const convs = state.get('conversations') || [];
  const next = replaceConvInList(convs, convId, conv);
  if (next !== convs) {
    state.set('conversations', next);
  }
}

// ============================================================
// 会话创建 / 加载
// ============================================================

/**
 * 创建新会话
 *
 * @param {string} characterId
 * @param {Object} [opts]
 * @param {boolean} [opts.setCurrent=true]
 */
export async function createNewConversation(characterId, opts = {}) {
  const { setCurrent = true } = opts;

  const stores = await getS();
  const conv = {
    id: generateUUID(),
    characterId,
    title: '新会话',
    messages: [],
    summary: '',
    lastSummaryIndex: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    convState: null,
  };
  await stores.conversations.add(conv);

  if (setCurrent) {
    const state = getAppState();
    const convs = state.get('conversations') || [];
    state.set('conversations', [conv, ...convs]);
    state.set('currentConversationId', conv.id);
  }
  return conv;
}

/**
 * 加载指定角色的所有会话
 *
 * @param {string} characterId
 * @param {Object} [opts]
 * @param {boolean} [opts.updateState=true]
 */
export async function loadConversations(characterId, opts = {}) {
  const { updateState = true } = opts;

  const stores = await getS();
  const convs = await stores.conversations.getByIndex('characterId', characterId);
  const sorted = convs.slice().sort((a, b) => b.updatedAt - a.updatedAt);

  if (updateState) {
    const state = getAppState();
    state.set('conversations', sorted, { force: true });
  }
  return sorted;
}

export async function getCurrentConversation() {
  const state = getAppState();
  const convId = state.get('currentConversationId');
  if (!convId) return null;
  const stores = await getS();
  return await stores.conversations.get(convId);
}

// ============================================================
// 消息写入
// ============================================================

export async function addMessageToConversation(convId, message) {
  return withKeyLock('conversation', convId, async () => {
    const stores = await getS();
    const conv = await stores.conversations.get(convId);
    if (!conv) return null;

    conv.messages.push(message);
    conv.updatedAt = Date.now();

    if (isConversationStateEnabled()) {
      try {
        conv.convState = buildConvStateOnMessage(conv, message);
      } catch (e) {
        console.warn('[Conversation] 更新 convState 失败:', e);
      }

      try {
        const newScene = await updateConversationScene(conv);
        if (newScene && conv.convState) {
          conv.convState.currentScene = newScene;
        }
      } catch (e) {
        console.warn('[Conversation] 更新场景失败:', e);
      }
    }

    await stores.conversations.update(convId, conv);
    syncConvToState(convId, conv);
    return conv;
  });
}

export async function removeMessageFromConversation(convId, messageId) {
  return withKeyLock('conversation', convId, async () => {
    const stores = await getS();
    const conv = await stores.conversations.get(convId);
    if (!conv) return;
    const index = conv.messages.findIndex(m => m.id === messageId);
    if (index === -1) return;
    conv.messages.splice(index, 1);
    conv.updatedAt = Date.now();

    if (isConversationStateEnabled()) {
      try {
        const messages = conv.messages.filter(m => m.role === 'user' || m.role === 'assistant');
        if (messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          const tempConv = { ...conv, messages: messages.slice(0, -1) };
          conv.convState = buildConvStateOnMessage(tempConv, lastMsg);
        } else {
          conv.convState = null;
        }
      } catch (e) {
        console.warn('[Conversation] 重建 convState 失败:', e);
      }
    }

    await stores.conversations.update(convId, conv);
    syncConvToState(convId, conv);
    return conv;
  });
}

export async function updateMessageInConversation(convId, messageId, updates) {
  return withKeyLock('conversation', convId, async () => {
    const stores = await getS();
    const conv = await stores.conversations.get(convId);
    if (!conv) return null;
    const idx = conv.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return null;

    conv.messages[idx] = { ...conv.messages[idx], ...updates };
    conv.updatedAt = Date.now();

    if (isConversationStateEnabled()) {
      const messages = conv.messages.filter(m => m.role === 'user' || m.role === 'assistant');
      if (messages.length > 0 && messages[messages.length - 1].id === messageId) {
        try {
          const tempConv = { ...conv, messages: messages.slice(0, -1) };
          conv.convState = buildConvStateOnMessage(tempConv, conv.messages[idx]);
        } catch (e) {
          console.warn('[Conversation] 重建 convState 失败:', e);
        }
      }
    }

    await stores.conversations.update(convId, conv);
    syncConvToState(convId, conv);
    return conv.messages[idx];
  });
}

export async function updateConversationWithLock(convId, mutator) {
  return withKeyLock('conversation', convId, async () => {
    const stores = await getS();
    const conv = await stores.conversations.get(convId);
    if (!conv) return null;

    let mutateResult;
    try {
      mutateResult = await mutator(conv);
    } catch (e) {
      console.error('[Conversation] updateConversationWithLock mutator 抛错:', e);
      throw e;
    }

    conv.updatedAt = Date.now();
    await stores.conversations.update(convId, conv);
    syncConvToState(convId, conv);

    return mutateResult;
  });
}

export async function clearConversation(convId) {
  return withKeyLock('conversation', convId, async () => {
    const stores = await getS();
    const conv = await stores.conversations.get(convId);
    if (!conv) return;
    conv.messages = [];
    conv.summary = '';
    conv.lastSummaryIndex = 0;
    conv.updatedAt = Date.now();
    conv.convState = null;
    await stores.conversations.update(convId, conv);
    syncConvToState(convId, conv);
    return conv;
  });
}

export async function deleteConversation(convId) {
  return withKeyLock('conversation', convId, async () => {
    const stores = await getS();
    await stores.conversations.delete(convId);
    const state = getAppState();
    const convs = state.get('conversations') || [];
    state.set('conversations', convs.filter(c => c.id !== convId));
    if (state.get('currentConversationId') === convId) {
      state.set('currentConversationId', null);
    }
  });
}

/**
 * 确保指定角色有一个会话
 */
export async function ensureConversation(characterId) {
  if (ensureLocks.has(characterId)) {
    return ensureLocks.get(characterId);
  }

  const task = (async () => {
    try {
      const state = getAppState();
      const shouldSetCurrent = state.get('currentCharacterId') === characterId;

      let convs = await loadConversations(characterId, {
        updateState: shouldSetCurrent,
      });

      if (!convs || convs.length === 0) {
        const newConv = await createNewConversation(characterId, {
          setCurrent: shouldSetCurrent,
        });
        convs = [newConv];
      } else if (shouldSetCurrent) {
        state.set('currentConversationId', convs[0].id);
      }

      return convs[0];
    } finally {
      ensureLocks.delete(characterId);
    }
  })();

  ensureLocks.set(characterId, task);
  return task;
}

export async function updateConversationSummary(convId, summary, lastIndex) {
  return withKeyLock('conversation', convId, async () => {
    const stores = await getS();
    const conv = await stores.conversations.get(convId);
    if (!conv) return;
    conv.summary = summary;
    conv.lastSummaryIndex = lastIndex;
    conv.updatedAt = Date.now();
    await stores.conversations.update(convId, conv);
    syncConvToState(convId, conv);
    return conv;
  });
}