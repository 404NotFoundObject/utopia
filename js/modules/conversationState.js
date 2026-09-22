// js/modules/conversationState.js - 会话状态机（含内容完整性、时间阶段、场景识别）

import { getGameTime } from './time.js';
import { getAppState } from '../core/state.js';
import { SCENE_REGISTRY, getSceneDef } from './sceneRegistry.js';

// ============================================================
// 常量
// ============================================================

export const CONV_STATES = {
  IDLE: 'idle',
  USER_ACTIVE: 'user_active',
  AI_RESPONDING: 'ai_responding',
  WAITING_USER: 'waiting_user',
};

export const COMPLETENESS = {
  COMPLETE: 'complete',
  INCOMPLETE: 'incomplete',
  AMBIGUOUS: 'ambiguous',
};

export const PHASE = {
  EMPTY: 'empty',
  ACTIVE: 'active',
  PAUSED: 'paused',
  INTERRUPTED: 'interrupted',
  ENDED: 'ended',
};

const CLOSING_PHRASES = [
  '晚安', '好梦', '睡了', '要睡了', '去睡了', '先睡了', '去休息了',
  '再见', '拜拜', '拜拜啦', '88', '掰掰', '下次聊', '下次再聊',
  '先这样', '先这样吧', '那先这样', '不聊了', '我走了',
  '忙去了', '去忙了', '回头聊', '改天聊', '有时间再聊',
  '好了不说了', '不说了', '就到这吧', '先撤了', '溜了溜了',
  'goodbye', 'good night', 'goodnight', 'bye', 'see you',
  'talk later', 'gotta go', 'gtg', 'ttyl',
];

const CONTINUATION_HINTS = [
  '等等', '等一下', '对了', '我想起来', '还有', '另一个', '另外',
  '话说', '诶对', '啊对', '哦对', '顺便', '顺便问下',
  'wait', 'oh wait', 'by the way', 'btw', 'hold on',
];

const COMPLETE_ENDINGS = ['。', '！', '？', '~', '～', '）', '】', '.', '!', '?'];
const INCOMPLETE_ENDINGS = ['，', ',', '、'];

// ============================================================
// 语义阈值动态读取
// ============================================================
function getSemanticThreshold() {
  try {
    const settings = getAppState().get('settings') || {};
    const t = settings.worldBookSemantic?.threshold;
    const n = typeof t === 'number' ? t : parseFloat(t);
    return Number.isFinite(n) ? n : 0.5;
  } catch (_) {
    return 0.5;
  }
}

// ============================================================
// 默认状态 & 规范化
// ============================================================

export function getDefaultConvState() {
  return {
    state: CONV_STATES.IDLE,
    lastActivityAt: 0,
    lastGameTime: 0,
    lastInitiator: null,
    lastMessageCompleteness: COMPLETENESS.AMBIGUOUS,
    lastMessageCompletenessScore: 0,
    lastMessageCompletenessReasons: [],
    lastMessageSnapshot: null,
    currentScene: null,
  };
}

export function normalizeConvState(conv) {
  const defaults = getDefaultConvState();
  const existing = conv?.convState || {};

  const normalized = { ...defaults, ...existing };

  if (!Array.isArray(normalized.lastMessageCompletenessReasons)) {
    normalized.lastMessageCompletenessReasons = [];
  }

  if (normalized.currentScene) {
    const scene = normalized.currentScene;
    if (!scene.type || !SCENE_REGISTRY[scene.type]) {
      normalized.currentScene = null;
    } else {
      normalized.currentScene = {
        type: scene.type,
        label: scene.label || SCENE_REGISTRY[scene.type].label,
        startedAt: scene.startedAt || 0,
        lastSeenAt: scene.lastSeenAt || 0,
        confidence: scene.confidence ?? 0,
        method: scene.method || 'unknown',
      };
    }
  }

  return normalized;
}

// ============================================================
// 内容完整性判定
// ============================================================

export function analyzeMessageCompleteness(text, role = 'user') {
  const result = {
    level: COMPLETENESS.AMBIGUOUS,
    score: 0,
    confidence: 0.5,
    reasons: [],
  };

  if (!text || typeof text !== 'string') {
    result.reasons.push('empty_text');
    return result;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    result.reasons.push('empty_text');
    return result;
  }

  const lower = trimmed.toLowerCase();
  let score = 0;

  const matchedClosing = CLOSING_PHRASES.find(p => lower.includes(p.toLowerCase()));
  if (matchedClosing) {
    score += 40;
    result.reasons.push(`closing_phrase:${matchedClosing}`);
  }

  const matchedContinuation = CONTINUATION_HINTS.find(p => lower.includes(p.toLowerCase()));
  if (matchedContinuation) {
    score -= 45;
    result.reasons.push(`continuation_hint:${matchedContinuation}`);
  }

  const trailing = trimmed.slice(-1);
  const lastTwo = trimmed.slice(-2);
  const lastThree = trimmed.slice(-3);

  if (lastThree === '...' || /…+$/.test(trimmed)) {
    score -= 30;
    result.reasons.push('ellipsis');
  } else if (lastTwo === '..') {
    score -= 25;
    result.reasons.push('ellipsis_two_dots');
  } else if (trailing === '…') {
    score -= 30;
    result.reasons.push('ellipsis_cn');
  } else if (COMPLETE_ENDINGS.includes(trailing)) {
    score += 20;
    result.reasons.push(`complete_punctuation:${trailing}`);
  } else if (INCOMPLETE_ENDINGS.includes(trailing)) {
    score -= 35;
    result.reasons.push(`incomplete_punctuation:${trailing}`);
  } else {
    score -= 5;
    result.reasons.push(`no_punctuation:${trailing}`);
  }

  if (role === 'user' && (trailing === '？' || trailing === '?')) {
    score -= 20;
    result.reasons.push('user_question');
  }

  if (trimmed.length < 4) {
    score -= 5;
    result.reasons.push('very_short');
  }

  result.score = score;

  if (score >= 50) {
    result.level = COMPLETENESS.COMPLETE;
    result.confidence = Math.min(1, score / 100);
  } else if (score <= -30) {
    result.level = COMPLETENESS.INCOMPLETE;
    result.confidence = Math.min(1, -score / 100);
  } else {
    result.level = COMPLETENESS.AMBIGUOUS;
    result.confidence = 0.5;
  }

  return result;
}

// ============================================================
// 时间阶段判定
// ============================================================
export function getConversationPhase(conv, now = null) {
  const nowTime = now || getGameTime();
  const messages = (conv?.messages || []).filter(m => m.role === 'user' || m.role === 'assistant');

  if (messages.length === 0) {
    return {
      phase: PHASE.EMPTY,
      hoursSince: 0,
      daysSince: 0,
      lastRole: null,
      lastMessagePreview: '',
      completeness: COMPLETENESS.AMBIGUOUS,
      completenessScore: 0,
      completenessReasons: [],
    };
  }

  const lastMsg = messages[messages.length - 1];
  const lastTime = lastMsg.timestamp || nowTime;
  const hoursSince = (nowTime - lastTime) / (1000 * 60 * 60);
  const daysSince = hoursSince / 24;

  const state = normalizeConvState(conv);
  let completeness;
  if (state.lastMessageSnapshot?.timestamp === lastTime
      && state.lastMessageCompletenessReasons?.length > 0) {
    completeness = {
      level: state.lastMessageCompleteness,
      score: state.lastMessageCompletenessScore,
      confidence: 0.8,
      reasons: state.lastMessageCompletenessReasons,
    };
  } else {
    completeness = analyzeMessageCompleteness(lastMsg.content, lastMsg.role);
  }

  const isIncomplete = completeness.level === COMPLETENESS.INCOMPLETE;
  const isComplete = completeness.level === COMPLETENESS.COMPLETE;

  let phase;
  if (hoursSince < 2) {
    phase = PHASE.ACTIVE;
  } else if (hoursSince < 24) {
    phase = isIncomplete ? PHASE.INTERRUPTED : PHASE.PAUSED;
  } else {
    if (isIncomplete) {
      phase = PHASE.INTERRUPTED;
    } else if (isComplete) {
      phase = PHASE.ENDED;
    } else {
      phase = PHASE.PAUSED;
    }
  }

  return {
    phase,
    hoursSince,
    daysSince,
    lastRole: lastMsg.role,
    lastMessagePreview: (lastMsg.content || '').slice(0, 50),
    lastMessageTimestamp: lastTime,
    completeness: completeness.level,
    completenessScore: completeness.score,
    completenessReasons: completeness.reasons,
  };
}

// ============================================================
// 场景识别
// ============================================================

export function extractSceneByKeywords(messages) {
  if (!messages || messages.length === 0) return null;
  const recent = messages.slice(-8);

  const scores = {};
  const recentLength = recent.length;

  recent.forEach((msg, idx) => {
    if (msg.role === 'system') return;
    const recencyWeight = (idx + 1) / recentLength;
    const content = (msg.content || '').toLowerCase();
    if (!content) return;

    for (const [type, def] of Object.entries(SCENE_REGISTRY)) {
      if (type === 'chat' || type === 'unknown') continue;
      if (!def.keywords || def.keywords.length === 0) continue;

      let hits = 0;
      for (const kw of def.keywords) {
        if (content.includes(kw.toLowerCase())) hits++;
      }
      if (hits > 0) {
        scores[type] = (scores[type] || 0) + hits * recencyWeight;
      }
    }
  });

  let best = null;
  let bestScore = 0;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = type;
    }
  }

  if (!best || bestScore < 1.0) return null;

  return {
    type: best,
    confidence: Math.min(1, bestScore / 4),
    method: 'keyword',
  };
}

export async function extractSceneBySemantic(messages) {
  if (!messages || messages.length === 0) return null;
  const recent = messages.filter(m => m.role !== 'system').slice(-6);
  if (recent.length === 0) return null;

  try {
    const { getMemoryEmbedder, isMemoryVectorReady } = await import('./memory.js');
    if (!isMemoryVectorReady()) return null;
    const embedder = getMemoryEmbedder();
    if (!embedder) return null;

    const combined = recent.map(m => m.content || '').join(' ').trim();
    if (!combined) return null;

    const msgVec = await embedder(combined, { pooling: 'mean', normalize: true });

    let best = null;
    let bestSim = 0;

    for (const [type, def] of Object.entries(SCENE_REGISTRY)) {
      if (type === 'chat' || type === 'unknown') continue;
      if (!def.semanticQuery) continue;

      try {
        const queryVec = await embedder(def.semanticQuery, { pooling: 'mean', normalize: true });
        const sim = cosineSimilarity(msgVec.data, queryVec.data);
        if (sim > bestSim) {
          bestSim = sim;
          best = type;
        }
      } catch (e) {
        // 单个查询失败不影响其他
      }
    }

    if (!best || bestSim < getSemanticThreshold()) return null;

    return {
      type: best,
      confidence: bestSim,
      method: 'semantic',
    };
  } catch (e) {
    console.warn('[ConversationState] 语义场景识别失败:', e);
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ============================================================
// 场景更新
// ============================================================

export async function updateConversationScene(conv) {
  const state = normalizeConvState(conv);
  const messages = (conv.messages || []).filter(m => m.role === 'user' || m.role === 'assistant');
  if (messages.length === 0) return null;

  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role !== 'user') {
    if (state.currentScene) {
      state.currentScene.lastSeenAt = lastMsg.timestamp || getGameTime();
    }
    return state.currentScene;
  }

  let sceneResult = extractSceneByKeywords(messages);
  if (!sceneResult) {
    sceneResult = await extractSceneBySemantic(messages);
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

// ============================================================
// 状态转换
// ============================================================

export function buildConvStateOnMessage(conv, message) {
  const state = normalizeConvState(conv);
  const now = message.timestamp || Date.now();
  const gameNow = getGameTime();

  state.lastActivityAt = now;
  state.lastGameTime = gameNow;

  if (message.role === 'user') {
    state.lastInitiator = 'user';
    state.state = CONV_STATES.USER_ACTIVE;
  } else if (message.role === 'assistant') {
    state.lastInitiator = 'character';
    state.state = CONV_STATES.WAITING_USER;
  } else if (message.role === 'system') {
    state.lastInitiator = 'system';
  }

  if (message.role === 'user' || message.role === 'assistant') {
    const analysis = analyzeMessageCompleteness(message.content, message.role);
    state.lastMessageCompleteness = analysis.level;
    state.lastMessageCompletenessScore = analysis.score;
    state.lastMessageCompletenessReasons = analysis.reasons;
    state.lastMessageSnapshot = {
      role: message.role,
      content: message.content,
      timestamp: now,
    };
  }

  return state;
}

// ============================================================
// 调试
// ============================================================

export function debugConversation(conv) {
  const state = normalizeConvState(conv);
  const phase = getConversationPhase(conv);
  const scene = state.currentScene;

  const result = {
    state: state.state,
    phase: phase.phase,
    hoursSince: phase.hoursSince.toFixed(2),
    daysSince: phase.daysSince.toFixed(2),
    completeness: {
      level: phase.completeness,
      score: phase.completenessScore,
      reasons: phase.completenessReasons,
    },
    lastMessage: {
      role: phase.lastRole,
      preview: phase.lastMessagePreview,
    },
    currentScene: null,
  };

  if (scene) {
    const sceneDef = getSceneDef(scene.type);
    result.currentScene = {
      type: scene.type,
      label: scene.label,
      confidence: scene.confidence,
      method: scene.method,
      elapsedHours: ((getGameTime() - scene.lastSeenAt) / (1000 * 60 * 60)).toFixed(2),
      maxDuration: sceneDef.maxDuration,
      staleThreshold: sceneDef.staleThreshold,
      sensitivity: sceneDef.sensitivity,
      reframable: scene.reframeMode !== null,
    };
  }

  return result;
}

// ============================================================
// 批量规范化（单聊）
// ============================================================

export async function normalizeAllConversations() {
  const { getStores } = await import('../core/db.js');
  const stores = await getStores();
  const allConvs = await stores.conversations.getAll();

  let updated = 0;
  let scanned = 0;

  for (const conv of allConvs) {
    scanned++;
    let needUpdate = false;

    if (!conv.convState) {
      conv.convState = normalizeConvState(conv);
      needUpdate = true;
    }

    const messages = (conv.messages || []).filter(m => m.role === 'user' || m.role === 'assistant');
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      const snapshot = conv.convState.lastMessageSnapshot;
      if (!snapshot || snapshot.timestamp !== lastMsg.timestamp) {
        try {
          const tempConv = { ...conv, messages: messages.slice(0, -1) };
          const newState = buildConvStateOnMessage(tempConv, lastMsg);
          if (conv.convState.currentScene) {
            newState.currentScene = conv.convState.currentScene;
          }
          conv.convState = newState;
          needUpdate = true;
        } catch (e) {
          console.warn(`[ConversationState] 重建 ${conv.id} 的 convState 失败:`, e);
        }
      }
    }

    if (needUpdate) {
      try {
        await stores.conversations.update(conv.id, conv);
        updated++;
      } catch (e) {
        console.warn(`[ConversationState] 保存 ${conv.id} 失败:`, e);
      }
    }
  }

  return { updated, scanned };
}

// ============================================================
// 批量规范化（群聊）
// ============================================================

export async function normalizeAllGroups() {
  const { getStores } = await import('../core/db.js');
  const stores = await getStores();
  const allGroups = await stores.groups.getAll();

  let updated = 0;
  let scanned = 0;

  for (const group of allGroups) {
    scanned++;
    let needUpdate = false;

    // ---------- 字段迁移（原 app.js migrateGroupFields 合并而来） ----------
    // summary / lastSummaryIndex 缺失时补齐，避免 DB 字段长期处于未定义状态。
    if (group.summary === undefined) {
      group.summary = '';
      needUpdate = true;
    }
    if (group.lastSummaryIndex === undefined) {
      group.lastSummaryIndex = 0;
      needUpdate = true;
    }
    // convState 不在此处显式设 null —— 由下方 `if (!group.convState)`
    // 分支直接用 normalizeConvState(group) 返回完整默认对象，一步到位。

    // ---------- convState 规范化 ----------
    if (!group.convState) {
      group.convState = normalizeConvState(group);
      needUpdate = true;
    }

    let messages = [];
    try {
      const rawMessages = await stores.group_messages.getByIndex('groupId', group.id);
      if (rawMessages && rawMessages.length > 0) {
        const sorted = rawMessages.sort((a, b) => a.timestamp - b.timestamp);
        messages = sorted.map(m => ({
          id: m.id,
          role: m.senderType === 'user' ? 'user' : 'assistant',
          content: m.content,
          timestamp: m.timestamp,
        }));
      }
    } catch (e) {
      console.warn(`[ConversationState] 读取群组 ${group.id} 消息失败:`, e);
    }

    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      const snapshot = group.convState.lastMessageSnapshot;
      if (!snapshot || snapshot.timestamp !== lastMsg.timestamp) {
        try {
          const tempConv = { id: group.id, messages: messages.slice(0, -1) };
          const newState = buildConvStateOnMessage(tempConv, lastMsg);
          if (group.convState.currentScene) {
            newState.currentScene = group.convState.currentScene;
          }
          group.convState = newState;
          needUpdate = true;
        } catch (e) {
          console.warn(`[ConversationState] 重建群组 ${group.id} 的 convState 失败:`, e);
        }
      }
    }

    if (needUpdate) {
      try {
        group.updatedAt = group.updatedAt || Date.now();
        await stores.groups.update(group.id, group);
        updated++;
      } catch (e) {
        console.warn(`[ConversationState] 保存群组 ${group.id} 失败:`, e);
      }
    }
  }

  return { updated, scanned };
}