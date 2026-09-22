// js/modules/emotionEngine.js - 六维情感引擎（含引擎开关 + 个性化 profile）
import { getStores } from '../core/db.js';
import { getAppState } from '../core/state.js';
import { getGameTime } from './time.js';
import { updateCharacter } from './character.js';
import { sendChatRequest } from '../core/api.js';
import globalEventBus from '../core/eventBus.js';
import { getEmotionProfile } from './profileDefaults.js';

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

// ---------- 事件词库 ----------
const EVENT_KEYWORDS = {
  praise: {
    words: ['美', '漂亮', '好看', '帅气', '棒', '厉害', '聪明', '机智', '温柔', '体贴', '可爱', '迷人', '真好看', '真棒', '优秀', '出色', '完美', '好啊', '不错', '很好', '真厉害', '太棒了', '了不起', '佩服'],
    patterns: ['你(.*?)好', '太(.*?)了']
  },
  criticism: {
    words: ['笨', '蠢', '傻', '没用', '废物', '差劲', '糟糕', '失败', '失望', '心寒', '讨厌', '恶心', '垃圾', '烂', '差', '不行', '糟糕透顶', '你(.*?)差', '真差'],
    patterns: ['你(.*?)不行', '你真(.*?)']
  },
  care: {
    words: ['怎么了', '还好吗', '没事吧', '担心', '关心', '保重', '注意身体', '吃药', '吃饭', '睡', '保暖', '休息', '多休息', '辛苦了', '累了', '难受吗', '心疼', '你在哪', '安全', '小心'],
    patterns: ['注意(.*?)', '多(.*?)点']
  },
  neglect: {
    words: ['不理', '不回', '消失', '忙', '没空', '忽略', '冷落', '遗忘', '忘了', '忘记', '你(.*?)不理', '你(.*?)不回', '你(.*?)消失'],
    patterns: ['你(.*?)不(.*?)我']
  },
  funny: {
    words: ['哈哈', '呵呵', '嘿嘿', '嘻嘻', '笑', '搞笑', '有趣', '好玩', '开心', '乐', '玩笑', '逗', '幽默', '哈哈', '哈哈哈', '嘿嘿嘿', '笑死', '笑喷', '笑到', '可爱死了'],
    patterns: ['笑(.*?)', '哈哈(.*?)']
  },
  intimate: {
    words: ['爱', '喜欢', '想念', '想你了', '爱你', '喜欢你', '好想你', '亲', '抱', '吻', '甜', '蜜', '亲爱的', '宝贝', '老婆', '老公', '男朋友', '女朋友', '情侣', '暖', '温柔', '你好甜'],
    patterns: ['想你(.*?)', '爱你(.*?)']
  },
  apology: {
    words: ['对不起', '抱歉', '不好意思', '是我的错', '错了', '原谅', '别生气', '我知道错了', '认错', '检讨', '不该', '不是故意', '让你不开心', '让你伤心'],
    patterns: ['对不起(.*?)', '我错了(.*?)']
  },
  request: {
    words: ['帮我', '可以吗', '能', '可以不可以', '请', '请求', '拜托', '麻烦你', '想请你', '能帮我', '可以帮我', '教教我', '告诉我', '帮我一下'],
    patterns: ['帮我(.*?)', '能(.*?)吗']
  },
  command: {
    words: ['必须', '给我', '去', '做', '快', '立刻', '马上', '限你', '命令', '要求', '强制', '给我做', '你去', '你得'],
    patterns: ['你(.*?)去', '你(.*?)做']
  },
  disclosure: {
    words: ['我想告诉你', '我说', '其实', '秘密', '告诉你', '跟你说', '分享', '心事', '心里话', '坦露', '真实', '真心话', '我的过去', '我的故事', '告诉你一个', '跟你说个'],
    patterns: ['我(.*?)告诉你', '其实(.*?)']
  },
  insult: {
    words: ['骂', '侮辱', '羞辱', '瞧不起', '鄙视', '看不起', '贬低', '嘲讽', '讥笑', '喷', '怼', '你(.*?)配吗', '你(.*?)资格', '你(.*?)也不照照镜子'],
    patterns: ['你(.*?)也不(.*?)', '你(.*?)吗']
  },
  gossip: {
    words: ['听说', '八卦', '传闻', '别人说', '好像', '据说', '大家都说', '有人说', '朋友圈', '你知道嘛', '你知道吗', '据说你', '别人都说'],
    patterns: ['听说(.*?)', '据说(.*?)']
  }
};

// ---------- 意图分类 ----------
export async function classifyUserMessage(text, useLLM = false) {
  const engineEnabled = isEmotionEngineEnabled();
  const shouldUseLLM = useLLM && engineEnabled;

  const lower = text.toLowerCase();
  let bestMatch = { type: 'neutral', intensity: 0.2, confidence: 0 };
  for (const [type, data] of Object.entries(EVENT_KEYWORDS)) {
    let score = 0;
    for (const word of data.words) {
      if (lower.includes(word)) score += 2;
    }
    for (const pattern of data.patterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(text)) score += 3;
      } catch (e) {}
    }
    if (score > 0) {
      const intensity = Math.min(1, 0.3 + score * 0.05);
      if (score > bestMatch.confidence) {
        bestMatch = { type, intensity, confidence: score };
      }
    }
  }
  if (bestMatch.confidence < 5 && shouldUseLLM) {
    try {
      const llmResult = await classifyWithLLM(text);
      if (llmResult) return llmResult;
    } catch (e) {
      console.warn('LLM 辅助分类失败，使用词库结果');
    }
  }
  return bestMatch;
}

async function classifyWithLLM(text) {
  const prompt = `请分析用户消息的情感意图，只返回以下类别之一：praise, criticism, care, neglect, funny, intimate, apology, request, command, disclosure, insult, gossip, neutral。
消息内容：${text}
只返回类别名称。`;
  try {
    const response = await sendChatRequest({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: '你是一个情感分析专家，只输出类别名称。',
      temperature: 0.1,
      maxTokens: 20,
      stream: false,
    });
    const label = response.content.trim().toLowerCase();
    const validTypes = Object.keys(EVENT_KEYWORDS).concat('neutral');
    if (validTypes.includes(label)) {
      return { type: label, intensity: 0.6, confidence: 10 };
    }
    return null;
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
      state[dim] += (0 - state[dim]) * EMOTION_DECAY_RATE * hours
        * decayFactor
        * decayMultiplier;
    }
  }

  const needDecay = NEEDS_DECAY_RATE * hours * (1 - (factors.conscientiousness || 0.5) * 0.5);
  for (let key in state.needs) {
    state.needs[key] = Math.max(0, state.needs[key] - needDecay * (1 + (key === 'pleasure' ? 0.5 : 0)));
  }

  // 好感衰减：受 decayMultiplier 反向影响
  //   高 decayMultiplier（情绪恢复快）→ 好感也恢复快
  if (state.affection > 0) {
    state.affection -= AFFECTION_DECAY_RATE * hours
      * (1 + (1 - agreeableness) * 0.5)
      / Math.max(0.3, decayMultiplier);
  } else if (state.affection < 0) {
    state.affection += AFFECTION_DECAY_RATE * hours * 0.5
      / Math.max(0.3, decayMultiplier);
  }

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
  // P2-4: intimacy > 50 → intimacy > 20
  if (valence > 40 && dominance > 30 && attention > 30 && intimacy > 20) return '爱慕';
  // P2-4: trust < 30 → trust < 0
  if (valence < -30 && arousal > 40 && dominance < -20 && trust < 0) return '嫉妒';
  if (valence < -30 && arousal < -20 && dominance < -40 && energy < -30) return '羞愧';
  if (valence > 50 && dominance > 40 && esteem > 70) return '自豪';
  if (valence > 30 && arousal > 50 && dominance < -20 && safety > 70) return '敬畏';
  // P2-4: affection < -30 → affection < -40（略微收紧，避免轻微负面即触发怨恨）
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