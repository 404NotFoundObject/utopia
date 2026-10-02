// js/modules/emotionEngine.js - 六维情感引擎（含引擎开关 + 个性化 profile）
import { getStores } from '../core/db.js';
import { getAppState } from '../core/state.js';
import { getGameTime } from './time.js';
import { updateCharacter } from './character.js';
import { sendChatRequest } from '../core/api.js';
import globalEventBus from '../core/eventBus.js';
import { getEmotionProfile } from './profileDefaults.js';
import { classifyEmotion } from './emotionClassifier.js';
import { EVENT_TYPE_IDS } from './emotionLexicon.js';

// ---------- 常量 ----------
const EMOTION_DECAY_RATE = 0.02;
const NEEDS_DECAY_RATE = 0.005;
const AFFECTION_DECAY_RATE = 0.001;

const RELATION_MIN = -100;
const RELATION_MAX = 100;

function isEmotionEngineEnabled() {
  const settings = getAppState().get('settings') || {};
  return settings.engineFlags?.emotion !== false;
}

// ---------- 默认状态 ----------
export function getDefaultEmotionState() {
  return {
    valence: 0,
    arousal: 0,
    dominance: 0,
    attention: 0,
    surprise: 0,
    energy: 0,
    needs: {
      safety: 70,
      esteem: 60,
      belonging: 50,
      autonomy: 50,
      pleasure: 50,
    },
    affection: 0,
    trust: 0,
    intimacy: 0,
    lastUpdate: 0,
  };
}

// ---------- 基于性格初始化情感状态 ----------
export function getInitialEmotionState(personality) {
  const state = getDefaultEmotionState();
  const p = personality || {};
  const neuroticism = (p.neuroticism || 50) / 100;
  const extraversion = (p.extraversion || 50) / 100;
  const agreeableness = (p.agreeableness || 50) / 100;
  const openness = (p.openness || 50) / 100;
  const conscientiousness = (p.conscientiousness || 50) / 100;
  const expressiveness = (p.expressiveness || 50) / 100;

  state.valence = -20 * (1 - agreeableness) - 10 * neuroticism;
  state.arousal = 20 * neuroticism + 10 * extraversion - 5;
  state.dominance = 5 - 15 * neuroticism + 10 * (1 - agreeableness);
  state.attention = -10 * (1 - extraversion);
  state.surprise = 5 * openness;
  state.energy = 10 + 20 * conscientiousness - 15 * neuroticism;

  state.affection = -30 * (1 - agreeableness);
  state.trust = -20 * (1 - agreeableness);
  state.intimacy = -10 * (1 - extraversion) - 10 * (1 - agreeableness);

  state.needs.safety = 70 - 40 * neuroticism;
  state.needs.esteem = 50 + 30 * conscientiousness;
  state.needs.belonging = 50 - 30 * (1 - agreeableness) - 20 * (1 - extraversion);
  state.needs.autonomy = 50 + 20 * (1 - agreeableness) + 10 * extraversion;
  state.needs.pleasure = 50 - 20 * neuroticism + 10 * extraversion;

  const dims = ['valence', 'arousal', 'dominance', 'attention', 'surprise', 'energy'];
  for (const dim of dims) {
    state[dim] = Math.max(-100, Math.min(100, state[dim]));
  }
  state.affection = Math.max(RELATION_MIN, Math.min(RELATION_MAX, state.affection));
  state.trust = Math.max(RELATION_MIN, Math.min(RELATION_MAX, state.trust));
  state.intimacy = Math.max(RELATION_MIN, Math.min(RELATION_MAX, state.intimacy));
  for (const key in state.needs) {
    state.needs[key] = Math.max(0, Math.min(100, state.needs[key]));
  }
  state.lastUpdate = getGameTime();
  return state;
}

// ---------- 情绪感知配置 ----------

/**
 * 读取情绪感知相关设置。
 *
 * semanticMode：
 *   'off'    完全不使用语义层
 *   'auto'   仅当规则层证据不足时才调用语义层（默认，不付额外开销）
 *   'always' 总是调用语义层，最准但每条消息都要做一次向量计算
 *
 * @returns {{semanticMode: 'off'|'auto'|'always', useLLMArbiter: boolean}}
 */
function getPerceptionSettings() {
  const settings = getAppState().get('settings') || {};
  const raw = settings.emotionPerception || {};
  return {
    semanticMode: ['off', 'auto', 'always'].includes(raw.semanticMode) ? raw.semanticMode : 'auto',
    useLLMArbiter: raw.useLLMArbiter === true,
  };
}

// ---------- 意图分类 ----------

/**
 * 识别用户消息的情绪意图。
 *
 * 识别本身交给三层级联分类器（规则层 → 语义层 → LLM 仲裁）：
 *   - 规则层处理否定与施受关系，把「我不喜欢你」判为拒绝而非亲密
 *   - 语义层覆盖词表之外的表达
 *   - LLM 仅在证据冲突时介入
 *
 * 返回结构在 type / intensity / confidence 之上扩展了
 * layer / margin / ambivalent / target 等字段，既有调用方无需改动。
 *
 * @param {string} text
 * @param {boolean} [useLLM] 是否允许 LLM 仲裁（设置项亦可开启）
 * @param {{debug?: boolean, perception?: {semanticMode?: string, useLLMArbiter?: boolean}}} [opts]
 *        perception 用于临时覆盖设置项，供调试面板做对照实验，不落库
 * @returns {Promise<Object>}
 */
export async function classifyUserMessage(text, useLLM = false, opts = {}) {
  if (!isEmotionEngineEnabled()) {
    return { type: 'neutral', intensity: 0, confidence: 0, layer: 'disabled' };
  }

  const perception = { ...getPerceptionSettings(), ...(opts.perception || {}) };
  const useLLMArbiter = useLLM === true || perception.useLLMArbiter === true;

  return classifyEmotion(text, {
    semanticMode: perception.semanticMode,
    useLLMArbiter,
    llmArbiter: useLLMArbiter ? classifyWithLLM : null,
    debug: opts.debug === true,
  });
}

/**
 * LLM 仲裁器。仅在前两层证据冲突时被调用。
 *
 * 要求只返回「类别」与「强度」两行，避免模型输出解释文本难以解析。
 * 提示词里显式强调否定与施事两类易错点，与规则层形成互补。
 *
 * @param {string} text
 * @returns {Promise<{type: string, intensity: number, confidence: number}|null>}
 */
async function classifyWithLLM(text) {
  const labels = EVENT_TYPE_IDS.filter(id => id !== 'neutral');
  const prompt = [
    '请判断下面这条消息对「你」而言属于哪一类情感事件。',
    `可选类别：${labels.join(', ')}。`,
    '注意两个易错点：否定（「我不喜欢你」是对立而非亲密）、施事（「他喜欢你」是第三方示好而非用户表达亲密）。',
    '只返回两行，不要任何解释：',
    '第一行：类别名称',
    '第二行：强度，0 到 1 之间的小数',
    '',
    `消息内容：${text}`,
  ].join('\n');

  try {
    const response = await sendChatRequest({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: '你是情感分析专家，只按要求的格式输出。',
      temperature: 0.1,
      maxTokens: 20,
      stream: false,
    });

    const lines = String(response.content || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    const label = (lines[0] || '').toLowerCase().replace(/[^a-z_]/g, '');
    if (!EVENT_TYPE_IDS.includes(label)) return null;

    const parsed = parseFloat(lines[1]);
    const intensity = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.6;

    return { type: label, intensity, confidence: 0.8 };
  } catch (e) {
    return null;
  }
}

// ---------- 性格参数调节因子 ----------
function getPersonalityFactors(personality) {
  const p = personality || {};
  return {
    neuroticism: (p.neuroticism || 50) / 100,
    extraversion: (p.extraversion || 50) / 100,
    agreeableness: (p.agreeableness || 50) / 100,
    openness: (p.openness || 50) / 100,
    conscientiousness: (p.conscientiousness || 50) / 100,
    expressiveness: (p.expressiveness || 50) / 100,
  };
}

// ---------- 事件影响向量 ----------
function getEventImpact(eventType, intensity, factors) {
  const { neuroticism, extraversion, agreeableness, openness, expressiveness } = factors;
  const base = {
    valence: 0, arousal: 0, dominance: 0, attention: 0, surprise: 0, energy: 0,
    needs: { safety: 0, esteem: 0, belonging: 0, autonomy: 0, pleasure: 0 },
    affection: 0, trust: 0, intimacy: 0
  };

  switch (eventType) {
    case 'praise':
      base.valence = 20 * intensity * (1 + extraversion * 0.3);
      base.arousal = 10 * intensity * (1 + extraversion * 0.2);
      base.dominance = 5 * intensity * (1 + extraversion * 0.1);
      base.attention = 5 * intensity * (1 + extraversion * 0.2);
      base.energy = 8 * intensity * (1 + extraversion * 0.2);
      base.needs.esteem = 15 * intensity * (1 + agreeableness * 0.3);
      base.needs.belonging = 5 * intensity * (1 + agreeableness * 0.2);
      base.affection = 5 * intensity * (1 + agreeableness * 0.5);
      base.trust = 3 * intensity * (1 + agreeableness * 0.3);
      base.intimacy = 2 * intensity * (1 + expressiveness * 0.4);
      break;
    case 'criticism':
      base.valence = -25 * intensity * (1 + neuroticism * 0.4);
      base.arousal = 15 * intensity * (1 + neuroticism * 0.3);
      base.dominance = -10 * intensity * (1 + neuroticism * 0.2);
      base.attention = -5 * intensity * (1 + neuroticism * 0.2);
      base.energy = -10 * intensity * (1 + neuroticism * 0.2);
      base.needs.esteem = -20 * intensity * (1 + agreeableness * 0.3);
      base.needs.safety = -10 * intensity * (1 + neuroticism * 0.3);
      base.affection = -8 * intensity * (1 + (1 - agreeableness) * 0.5);
      base.trust = -5 * intensity * (1 + (1 - agreeableness) * 0.4);
      base.intimacy = -3 * intensity * (1 + (1 - agreeableness) * 0.3);
      break;
    case 'care':
      base.valence = 15 * intensity * (1 + agreeableness * 0.3);
      base.arousal = -5 * intensity * (1 + neuroticism * 0.2);
      base.dominance = 5 * intensity * (1 + agreeableness * 0.2);
      base.attention = 10 * intensity * (1 + extraversion * 0.2);
      base.energy = 5 * intensity * (1 + extraversion * 0.1);
      base.needs.safety = 20 * intensity * (1 + agreeableness * 0.3);
      base.needs.belonging = 15 * intensity * (1 + agreeableness * 0.3);
      base.affection = 6 * intensity * (1 + agreeableness * 0.5);
      base.trust = 8 * intensity * (1 + agreeableness * 0.4);
      base.intimacy = 5 * intensity * (1 + expressiveness * 0.3);
      break;
    case 'neglect':
      base.valence = -10 * intensity * (1 + neuroticism * 0.3);
      base.arousal = 5 * intensity * (1 + neuroticism * 0.2);
      base.dominance = -5 * intensity * (1 + neuroticism * 0.2);
      base.attention = -15 * intensity * (1 + neuroticism * 0.3);
      base.energy = -5 * intensity * (1 + neuroticism * 0.2);
      base.needs.belonging = -15 * intensity * (1 + agreeableness * 0.3);
      base.needs.safety = -8 * intensity * (1 + neuroticism * 0.3);
      base.affection = -3 * intensity * (1 + (1 - agreeableness) * 0.4);
      base.trust = -5 * intensity * (1 + (1 - agreeableness) * 0.3);
      break;
    case 'funny':
      base.valence = 15 * intensity * (1 + openness * 0.3);
      base.arousal = 15 * intensity * (1 + extraversion * 0.2);
      base.dominance = 5 * intensity * (1 + extraversion * 0.1);
      base.attention = 10 * intensity * (1 + extraversion * 0.2);
      base.surprise = 10 * intensity * (1 + openness * 0.3);
      base.energy = 10 * intensity * (1 + extraversion * 0.2);
      base.needs.pleasure = 20 * intensity * (1 + openness * 0.3);
      base.needs.belonging = 5 * intensity * (1 + extraversion * 0.2);
      base.affection = 3 * intensity * (1 + agreeableness * 0.3);
      break;
    case 'intimate':
      base.valence = 25 * intensity * (1 + expressiveness * 0.4);
      base.arousal = 20 * intensity * (1 + expressiveness * 0.3);
      base.dominance = 10 * intensity * (1 + expressiveness * 0.2);
      base.attention = 15 * intensity * (1 + extraversion * 0.3);
      base.energy = 15 * intensity * (1 + expressiveness * 0.3);
      base.needs.belonging = 20 * intensity * (1 + agreeableness * 0.3);
      base.needs.esteem = 10 * intensity * (1 + agreeableness * 0.2);
      base.needs.pleasure = 15 * intensity * (1 + expressiveness * 0.3);
      base.affection = 10 * intensity * (1 + agreeableness * 0.4);
      base.trust = 5 * intensity * (1 + agreeableness * 0.3);
      base.intimacy = 15 * intensity * (1 + expressiveness * 0.5);
      break;

    // ---------- 道歉：缓和 + 修复关系 ----------
    case 'apology':
      base.valence = 12 * intensity * (1 + agreeableness * 0.3);
      base.arousal = -8 * intensity * (1 + neuroticism * 0.2);
      base.dominance = 5 * intensity * (1 + extraversion * 0.1);
      base.attention = 8 * intensity;
      base.needs.safety = 8 * intensity;
      base.needs.esteem = 5 * intensity;
      base.affection = 4 * intensity * (1 + agreeableness * 0.3);
      base.trust = 6 * intensity * (1 + agreeableness * 0.4);
      break;

    // ---------- 请求：被依赖 + 略感束缚 ----------
    case 'request':
      base.valence = 3 * intensity * (1 + agreeableness * 0.3);
      base.arousal = 2 * intensity;
      base.dominance = 3 * intensity * (1 + extraversion * 0.2);
      base.attention = 10 * intensity * (1 + extraversion * 0.2);
      base.needs.esteem = 8 * intensity * (1 + agreeableness * 0.3);
      base.needs.autonomy = -3 * intensity * (1 - agreeableness * 0.5);
      base.affection = 2 * intensity * (1 + agreeableness * 0.4);
      break;

    // ---------- 命令：强负面 + 自主权受损 ----------
    case 'command':
      base.valence = -12 * intensity * (1 + (1 - agreeableness) * 0.6);
      base.arousal = 10 * intensity * (1 + neuroticism * 0.3);
      base.dominance = -15 * intensity * (1 + (1 - agreeableness) * 0.5);
      base.attention = 5 * intensity;
      base.needs.autonomy = -20 * intensity * (1 + (1 - agreeableness) * 0.5);
      base.needs.esteem = -8 * intensity * (1 + (1 - agreeableness) * 0.3);
      base.affection = -5 * intensity * (1 + (1 - agreeableness) * 0.4);
      base.trust = -4 * intensity * (1 + (1 - agreeableness) * 0.3);
      break;

    // ---------- 坦露心事：强正 + 深度信任建立 ----------
    case 'disclosure':
      base.valence = 15 * intensity * (1 + agreeableness * 0.3);
      base.arousal = -5 * intensity * (1 + neuroticism * 0.2);
      base.attention = 15 * intensity * (1 + extraversion * 0.3);
      base.needs.belonging = 15 * intensity * (1 + agreeableness * 0.3);
      base.needs.esteem = 10 * intensity * (1 + agreeableness * 0.2);
      base.needs.safety = 8 * intensity;
      base.affection = 8 * intensity * (1 + agreeableness * 0.4);
      base.trust = 12 * intensity * (1 + agreeableness * 0.5);
      base.intimacy = 10 * intensity * (1 + expressiveness * 0.4);
      break;

    // ---------- 侮辱：最强负面事件（强于 criticism） ----------
    case 'insult':
      base.valence = -35 * intensity * (1 + neuroticism * 0.5);
      base.arousal = 25 * intensity * (1 + neuroticism * 0.4);
      base.dominance = -15 * intensity * (1 + neuroticism * 0.3);
      base.attention = -10 * intensity;
      base.energy = -12 * intensity * (1 + neuroticism * 0.3);
      base.needs.esteem = -30 * intensity * (1 + (1 - agreeableness) * 0.3);
      base.needs.safety = -15 * intensity * (1 + neuroticism * 0.3);
      base.needs.belonging = -12 * intensity;
      base.affection = -15 * intensity * (1 + (1 - agreeableness) * 0.5);
      base.trust = -12 * intensity * (1 + (1 - agreeableness) * 0.4);
      base.intimacy = -6 * intensity * (1 + (1 - agreeableness) * 0.3);
      break;

    // ---------- 八卦：中度正 + 社交愉悦 ----------
    case 'gossip':
      base.valence = 8 * intensity * (1 + openness * 0.3);
      base.arousal = 12 * intensity * (1 + extraversion * 0.3);
      base.attention = 10 * intensity * (1 + extraversion * 0.2);
      base.surprise = 8 * intensity * (1 + openness * 0.4);
      base.energy = 5 * intensity * (1 + extraversion * 0.2);
      base.needs.belonging = 8 * intensity * (1 + extraversion * 0.2);
      base.needs.pleasure = 10 * intensity * (1 + openness * 0.3);
      base.affection = 2 * intensity * (1 + agreeableness * 0.2);
      break;

    // ---------- 拒绝疏离：关系层面的直接否定，伤害集中在归属与亲密 ----------
    case 'rejection':
      base.valence = -38 * intensity * (1 + neuroticism * 0.5);
      base.arousal = 20 * intensity * (1 + neuroticism * 0.4);
      base.dominance = -12 * intensity * (1 + neuroticism * 0.3);
      base.attention = -8 * intensity;
      base.energy = -12 * intensity * (1 + neuroticism * 0.3);
      base.needs.belonging = -30 * intensity * (1 + agreeableness * 0.3);
      base.needs.safety = -20 * intensity * (1 + neuroticism * 0.3);
      base.needs.esteem = -15 * intensity * (1 + (1 - agreeableness) * 0.3);
      base.affection = -25 * intensity * (1 + (1 - agreeableness) * 0.4);
      base.trust = -20 * intensity * (1 + (1 - agreeableness) * 0.4);
      base.intimacy = -18 * intensity * (1 + expressiveness * 0.3);
      break;

    // ---------- 第三方示好：竞争威胁，特征是高唤醒 + 高关注 + 安全感下降 ----------
    case 'rival_affection':
      base.valence = -18 * intensity * (1 + neuroticism * 0.5);
      base.arousal = 28 * intensity * (1 + neuroticism * 0.4);
      base.dominance = -5 * intensity;
      base.attention = 20 * intensity * (1 + extraversion * 0.2);
      base.surprise = 15 * intensity * (1 + openness * 0.3);
      base.energy = -3 * intensity;
      base.needs.safety = -18 * intensity * (1 + neuroticism * 0.4);
      base.needs.belonging = -10 * intensity * (1 + agreeableness * 0.3);
      base.needs.esteem = -6 * intensity;
      base.affection = -6 * intensity * (1 + (1 - agreeableness) * 0.3);
      base.trust = -8 * intensity * (1 + (1 - agreeableness) * 0.4);
      base.intimacy = -4 * intensity;
      break;

    // ---------- 安抚澄清：紧张解除，特征是唤醒显著下降、安全感回升 ----------
    case 'reassurance':
      base.valence = 18 * intensity * (1 + agreeableness * 0.3);
      base.arousal = -18 * intensity * (1 + neuroticism * 0.3);
      base.dominance = 6 * intensity;
      base.attention = 8 * intensity;
      base.energy = 4 * intensity;
      base.needs.safety = 22 * intensity * (1 + neuroticism * 0.4);
      base.needs.belonging = 12 * intensity * (1 + agreeableness * 0.3);
      base.needs.esteem = 6 * intensity;
      base.affection = 5 * intensity * (1 + agreeableness * 0.4);
      base.trust = 12 * intensity * (1 + agreeableness * 0.4);
      base.intimacy = 4 * intensity;
      break;

    // ---------- 感谢：被认可，重心在自尊与关系确认，唤醒变化小 ----------
    case 'gratitude':
      base.valence = 16 * intensity * (1 + agreeableness * 0.3);
      base.arousal = 6 * intensity;
      base.dominance = 4 * intensity * (1 + extraversion * 0.1);
      base.attention = 8 * intensity;
      base.energy = 6 * intensity * (1 + extraversion * 0.1);
      base.needs.esteem = 18 * intensity * (1 + agreeableness * 0.3);
      base.needs.belonging = 12 * intensity * (1 + agreeableness * 0.3);
      base.needs.pleasure = 8 * intensity;
      base.affection = 8 * intensity * (1 + agreeableness * 0.4);
      base.trust = 8 * intensity * (1 + agreeableness * 0.3);
      base.intimacy = 4 * intensity;
      break;

    // ---------- 抱怨：角色承担倾听，关注上升；愿意抱怨本身是信任信号 ----------
    case 'complaint':
      base.valence = -8 * intensity * (1 + neuroticism * 0.3);
      base.arousal = 8 * intensity * (1 + neuroticism * 0.2);
      base.dominance = -3 * intensity;
      base.attention = 14 * intensity * (1 + extraversion * 0.2);
      base.energy = -6 * intensity * (1 + neuroticism * 0.2);
      base.needs.pleasure = -8 * intensity;
      base.needs.autonomy = -2 * intensity;
      base.affection = -1 * intensity;
      base.trust = 2 * intensity;
      base.intimacy = 2 * intensity;
      break;

    // ---------- 调侃：亲密化的打趣，愉悦与亲密同时上升，支配感略降 ----------
    case 'teasing':
      base.valence = 14 * intensity * (1 + extraversion * 0.3);
      base.arousal = 14 * intensity * (1 + extraversion * 0.2);
      base.dominance = -6 * intensity * (1 - extraversion * 0.2);
      base.attention = 12 * intensity * (1 + extraversion * 0.2);
      base.surprise = 10 * intensity * (1 + openness * 0.3);
      base.energy = 10 * intensity * (1 + extraversion * 0.2);
      base.needs.pleasure = 16 * intensity * (1 + openness * 0.3);
      base.needs.belonging = 10 * intensity * (1 + extraversion * 0.2);
      base.affection = 6 * intensity * (1 + agreeableness * 0.4);
      base.trust = 3 * intensity;
      base.intimacy = 8 * intensity * (1 + expressiveness * 0.4);
      break;

    // ---------- 主动分享：角色自主发起消息，轻微满足分享欲（审计 B-6） ----------
    // 这是「自主动作」而非「响应用户输入」，影响保持轻微，避免主动发言反过来
    // 大幅改写角色情绪。重点是归属感与愉悦感的微小提升 + 唤醒略降（表达后的放松）。
    case 'proactive_share':
      base.valence = 6 * intensity * (1 + extraversion * 0.3);
      base.arousal = -4 * intensity * (1 + neuroticism * 0.2);
      base.attention = 4 * intensity * (1 + extraversion * 0.2);
      base.energy = -2 * intensity;
      base.needs.belonging = 8 * intensity * (1 + agreeableness * 0.3);
      base.needs.pleasure = 6 * intensity * (1 + extraversion * 0.2);
      base.affection = 2 * intensity * (1 + agreeableness * 0.3);
      break;

    default:
      base.valence = 2 * intensity;
      base.attention = 2 * intensity;
      base.needs.pleasure = 2 * intensity;
  }
  return base;
}

// ============================================================
// 时间驱动更新（★ 受 emotionalDecayFactor 缩放）
// ============================================================
export async function updateEmotionByTime(character, hours) {
  if (!character || !character.emotionState) return;
  if (!isEmotionEngineEnabled()) return;

  const state = character.emotionState;
  const factors = getPersonalityFactors(character.personalityParameters);
  const { neuroticism, agreeableness } = factors;

  // ★ 读取个性化 profile
  const profile = getEmotionProfile(character);
  const decayMultiplier = profile.emotionalDecayFactor;

  const decayFactor = 1 - neuroticism * 0.3;
  const dims = ['valence', 'arousal', 'dominance', 'attention', 'surprise', 'energy'];
  for (const dim of dims) {
    if (state[dim] !== undefined) {
      // ★ 衰减速率乘以 decayMultiplier
      //   高 decayMultiplier → 情绪平复更快
      // 用一阶线性衰减的解析解 state *= exp(-k)（k = 衰减速率 × 时长），
      // 避免单步欧拉积分在高倍速（hours 大）下系数 >1 导致的符号翻转。
      let k = EMOTION_DECAY_RATE * hours * decayFactor * decayMultiplier;
      if (!Number.isFinite(k)) k = 0;   // 防非有限 decayMultiplier 把 NaN 写进 state
      state[dim] *= Math.exp(-k);
    }
  }

  // 需求消退：同样用解析解渐近趋近 0，避免大 hours 下线性衰减直接砸到 clamp 地板。
  let needK = NEEDS_DECAY_RATE * hours * (1 - (factors.conscientiousness || 0.5) * 0.5);
  if (!Number.isFinite(needK)) needK = 0;
  for (let key in state.needs) {
    const k = needK * (1 + (key === 'pleasure' ? 0.5 : 0));
    state.needs[key] *= Math.exp(-k);
  }

  // 好感衰减：改用与六维一致的解析解，趋近 0 而非线性跨零翻转。
  //   高 decayMultiplier（情绪恢复快）→ 好感也恢复快。
  //   负值（厌恶）用 0.5× 速率消退，保持「讨厌比喜欢消退更慢」的原始意图。
  const affectionBaseK = AFFECTION_DECAY_RATE * hours
    * (1 + (1 - agreeableness) * 0.5)
    / Math.max(0.3, decayMultiplier);
  let affectionK = Number.isFinite(affectionBaseK) ? affectionBaseK : 0;
  if (state.affection < 0) affectionK *= 0.5;
  state.affection *= Math.exp(-affectionK);

  for (const dim of dims) {
    state[dim] = Math.max(-100, Math.min(100, state[dim]));
  }
  state.affection = Math.max(RELATION_MIN, Math.min(RELATION_MAX, state.affection));
  state.trust = Math.max(RELATION_MIN, Math.min(RELATION_MAX, state.trust));
  state.intimacy = Math.max(RELATION_MIN, Math.min(RELATION_MAX, state.intimacy));

  state.lastUpdate = getGameTime();
  await updateCharacter(character.id, { emotionState: state }, { skipReload: true });

  globalEventBus.emit('emotion:updated', {
    characterId: character.id,
    state: state,
    timestamp: Date.now(),
  });
}

// ============================================================
// 事件驱动更新（★ 受 sensitivity / volatility / attachment / trustRecovery）
// ============================================================
export async function handleInteraction(character, eventType, intensity = 0.5) {
  if (!character || !character.emotionState) return;
  if (!isEmotionEngineEnabled()) return;

  const state = character.emotionState;
  const factors = getPersonalityFactors(character.personalityParameters);

  // ★ 读取个性化 profile
  const profile = getEmotionProfile(character);

  const impact = getEventImpact(eventType, intensity, factors);

  // ★ 敏感度与波动性缩放
  //   sensitivity = 0.5 → 系数 1.0（基准）
  //   sensitivity = 1.0 → 系数 1.5（更敏感）
  //   sensitivity = 0.0 → 系数 0.5（更迟钝）
  const sensitivityScale = 0.5 + profile.emotionalSensitivity;
  const volatilityScale = 0.5 + profile.emotionalVolatility;
  const totalScale = sensitivityScale * volatilityScale;

  // 六维情绪：受 sensitivity × volatility 双重缩放
  for (const key of ['valence', 'arousal', 'dominance', 'attention', 'surprise', 'energy']) {
    if (impact[key] !== undefined) {
      state[key] += impact[key] * totalScale;
      state[key] = Math.max(-100, Math.min(100, state[key]));
    }
  }

  // needs 维度：只用 sensitivity 缩放
  //   needs 反映的是内在需求，与"波动性"无关
  for (const key in impact.needs) {
    if (state.needs[key] !== undefined) {
      state.needs[key] += impact.needs[key] * sensitivityScale;
      state.needs[key] = Math.max(0, Math.min(100, state.needs[key]));
    }
  }

  // 好感：只用 sensitivity 缩放
  state.affection += impact.affection * sensitivityScale;
  state.affection = Math.max(RELATION_MIN, Math.min(RELATION_MAX, state.affection));

  // 信任：正向事件受 trustRecoveryFactor 放大（易信任者快速建立信任）
  //       负向事件受 sensitivity 缩放（敏感者更容易受伤）
  const trustScale = impact.trust > 0
    ? profile.trustRecoveryFactor
    : sensitivityScale;
  state.trust += impact.trust * trustScale;
  state.trust = Math.max(RELATION_MIN, Math.min(RELATION_MAX, state.trust));

  // 亲密：正向事件受 attachmentSpeed 缩放（易依恋者快速建立亲密）
  //       负向事件受 sensitivity 缩放
  const intimacyScale = impact.intimacy > 0
    ? 0.5 + profile.attachmentSpeed
    : sensitivityScale;
  state.intimacy += impact.intimacy * intimacyScale;
  state.intimacy = Math.max(RELATION_MIN, Math.min(RELATION_MAX, state.intimacy));

  state.lastUpdate = getGameTime();
  await updateCharacter(character.id, { emotionState: state }, { skipReload: true });

  globalEventBus.emit('emotion:interaction', {
    characterId: character.id,
    eventType,
    intensity,
    state: state,
    timestamp: Date.now(),
  });
}

export async function refreshEmotion(character) {
  if (!character) return;
  if (!isEmotionEngineEnabled()) return;

  const now = getGameTime();
  const lastUpdate = character.emotionState?.lastUpdate || now;
  const hours = (now - lastUpdate) / (1000 * 60 * 60);
  if (hours > 0.1) {
    await updateEmotionByTime(character, hours);
  }
}

// ============================================================
// 情绪标签映射
// ============================================================
export function getEmotionLabel(state) {
  if (!state) return '中性';
  const { valence, arousal, dominance, attention, surprise, energy, affection, trust, intimacy, needs } = state;
  const esteem = needs?.esteem || 50;
  const safety = needs?.safety || 50;
  const belonging = needs?.belonging || 50;

  if (valence > 50 && arousal > 30 && dominance > 20 && attention > 20 && energy > 30) return '兴奋';
  if (valence > 50 && arousal < -20 && dominance > 10 && energy > 10) return '平静愉悦';
  if (valence < -50 && arousal > 50 && dominance > 30 && attention > 20) return '愤怒';
  if (valence < -50 && arousal > 50 && dominance < -30 && attention > 20) return '恐惧';
  if (valence < -50 && arousal < -20 && dominance < -10 && energy < -20) return '悲伤';
  if (valence > 30 && arousal > 50 && surprise > 30) return '惊喜';
  // 亲密感 > 20 即判定为爱慕
  if (valence > 40 && dominance > 30 && attention > 30 && intimacy > 20) return '爱慕';
  // 信任度 < 0 才判定为嫉妒
  if (valence < -30 && arousal > 40 && dominance < -20 && trust < 0) return '嫉妒';
  if (valence < -30 && arousal < -20 && dominance < -40 && energy < -30) return '羞愧';
  if (valence > 50 && dominance > 40 && esteem > 70) return '自豪';
  if (valence > 30 && arousal > 50 && dominance < -20 && safety > 70) return '敬畏';
  // 好感 < -40 才判定为怨恨，避免轻微负面即触发
  if (valence < -50 && arousal > 20 && dominance > 20 && affection < -40) return '怨恨';
  if (valence < -20 && arousal < -50 && dominance < -20 && belonging < 30) return '惆怅';
  if (valence > 20 && arousal < -30 && energy < -30) return '平静';
  if (valence < -20 && arousal > 10 && surprise > 20) return '厌恶';
  if (valence > 20 && arousal < 10 && attention > 20) return '期待';
  return '中性';
}

export function getEmotionDescription(character) {
  if (!character || !character.emotionState) return '情绪平稳';
  const state = character.emotionState;
  const label = getEmotionLabel(state);
  const dims = `愉悦${Math.round(state.valence)}，唤醒${Math.round(state.arousal)}，支配${Math.round(state.dominance)}，关注${Math.round(state.attention)}，意外${Math.round(state.surprise)}，精力${Math.round(state.energy)}`;
  return `${label}（${dims}）`;
}

// ============================================================
// 提示词构建（★ 根据 profile 附加人格化提示）
// ============================================================
export function buildEmotionPrompt(character) {
  if (!character || !character.emotionState) return '';
  if (!isEmotionEngineEnabled()) return '';

  const state = character.emotionState;
  const profile = getEmotionProfile(character);
  const label = getEmotionLabel(state);
  const dimDesc = `愉悦度:${Math.round(state.valence)}，唤醒度:${Math.round(state.arousal)}，支配度:${Math.round(state.dominance)}，关注度:${Math.round(state.attention)}，意外度:${Math.round(state.surprise)}，精力:${Math.round(state.energy)}`;
  const needsDesc = Object.entries(state.needs).map(([k, v]) => `${k}:${Math.round(v)}`).join('，');

  let prompt = `【当前情感状态】${label}
【六维情绪】${dimDesc}
【好感度】${Math.round(state.affection)}，【信任度】${Math.round(state.trust)}，【亲密感】${Math.round(state.intimacy)}
【需求状态】${needsDesc}
请根据当前情感状态调整你的回复语气和内容。`;

  // ★ 高敏感 / 高波动角色附加提示
  if (profile.emotionalSensitivity > 0.7) {
    prompt += '\n你是一个情感敏锐的人，容易受到他人言行的触动。';
  }
  if (profile.emotionalVolatility > 0.7) {
    prompt += '\n你的情绪波动较大，喜悦与悲伤都可能来得很强烈。';
  }
  if (profile.emotionalDecayFactor > 1.5) {
    prompt += '\n你情绪恢复得很快，不会长时间沉浸在某一种情绪里。';
  } else if (profile.emotionalDecayFactor < 0.6) {
    prompt += '\n你情绪恢复得较慢，一旦被触动会持续较长时间。';
  }

  return prompt;
}