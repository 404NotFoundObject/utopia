// js/modules/transitionDecider.js - 场景转场决策器（含 LLM 裁决 + 人设染色）
//
// 职责：
//   1. 决策矩阵：时间跨度 × 相关性 → 策略
//   2. LLM 裁决：模糊情况下调用 LLM 判定
//   3. 生成转场提示词（含人设染色）
//   4. 与冷落感知协调
//
// 设计原则：
//   - 规则优先，LLM 兜底
//   - LLM 触发条件严格白名单，避免过度消耗
//   - 转场提示词只给方向，不写死示例，让人设自由发挥
//   - 失败降级：LLM 失败时用规则决策

import { getGameTime } from './time.js';
import { sendChatRequest } from '../core/api.js';
import { getAppState } from '../core/state.js';
import {
  SCENE_REGISTRY,
  getSceneDef,
  getSceneReframeHint,
  isReframable,
  isSensitive,
  buildPersonaBrief,
  getToneHint,
} from './sceneRegistry.js';
import { getConversationPhase, normalizeConvState } from './conversationState.js';

// ============================================================
// 策略枚举
// ============================================================

export const TRANSITION_STRATEGIES = {
  NONE: 'none',                               // 无需转场
  CONTINUE: 'continue',                       // 直接接续
  SOFT_CONTINUE: 'soft_continue',             // 模糊但倾向接续
  REFRAME: 'reframe',                         // 场景重构（"第二顿饭"）
  COMPLETE_OLD: 'complete_old',               // 承认旧场景结束
  SHIFT: 'shift',                             // 温和切换话题
  SOFT_SHIFT: 'soft_shift',                   // 模糊切换
  CROSS_DAY_RELATED: 'cross_day_related',     // 跨天 + 相关
  CROSS_DAY_TRANSITION: 'cross_day_transition', // 跨天 + 无关
};

// ============================================================
// 相关性判定
// ============================================================

/**
 * 判定用户新消息与场景的相关性
 *
 * 三级判断：
 *   - 命中 2+ 场景关键词 → related
 *   - 命中 1 个关键词或含过渡词 → ambiguous
 *   - 命中 0 关键词且含切换词 → unrelated
 *   - 否则 → ambiguous（保守）
 *
 * @param {string} userMessage
 * @param {Object} scene - { type, label, ... }
 * @returns {'related' | 'unrelated' | 'ambiguous'}
 */
export function checkSceneRelevance(userMessage, scene) {
  if (!userMessage || !scene) return 'ambiguous';
  const content = userMessage.toLowerCase().trim();
  if (content.length === 0) return 'ambiguous';

  const sceneDef = getSceneDef(scene.type);
  const keywords = sceneDef.keywords || [];

  // 1. 关键词匹配
  let hitCount = 0;
  for (const kw of keywords) {
    if (content.includes(kw.toLowerCase())) hitCount++;
  }

  if (hitCount >= 2) return 'related';

  // 2. 过渡词（表示承接上文）
  const continuationHints = ['对了', '还有', '另外', '顺便', '话说', '诶', '那个', '刚才', '刚刚'];
  if (continuationHints.some(w => content.includes(w))) return 'related';

  // 3. 切换话题词
  const shiftHints = ['不聊了', '换个话题', '说点别的', '新话题', '对了说', '算了'];
  if (shiftHints.some(w => content.includes(w))) return 'unrelated';

  if (hitCount === 1) return 'ambiguous';

  // 0 命中，倾向 unrelated，但保留 ambiguous 让 LLM 裁决
  return 'unrelated';
}

// ============================================================
// 规则决策（LLM 的前置）
// ============================================================

/**
 * 规则决策：返回 { strategy, source: 'rule' } 或 { needLLM: true, ... }
 *
 * @param {Object} conv - 会话对象
 * @param {Object} scene - 当前场景
 * @param {string} userMessage
 * @returns {Object} 决策结果
 */
function decideByRules(conv, scene, userMessage) {
  const now = getGameTime();
  const sceneDef = getSceneDef(scene.type);
  const lastSeenAt = scene.lastSeenAt || conv.updatedAt || now;
  const elapsedHours = (now - lastSeenAt) / (1000 * 60 * 60);

  const maxDur = sceneDef.maxDuration;
  const staleThresh = sceneDef.staleThreshold;
  const relevance = checkSceneRelevance(userMessage, scene);
  const sensitive = isSensitive(scene.type);
  const reframable = isReframable(scene.type);

  // ---------- 敏感场景：单独处理 ----------
  if (sensitive) {
    if (elapsedHours < maxDur) {
      // 短时间内：允许接续
      return {
        strategy: relevance === 'unrelated' ? TRANSITION_STRATEGIES.SHIFT : TRANSITION_STRATEGIES.CONTINUE,
        source: 'rule',
        elapsedHours,
        relevance,
        needLLM: false,
      };
    }
    // 时间过长：敏感场景强制 complete_old，不做 reframe
    return {
      strategy: TRANSITION_STRATEGIES.COMPLETE_OLD,
      source: 'rule',
      elapsedHours,
      relevance,
      needLLM: false,
      forcedSensitive: true,
    };
  }

  // ---------- 时间 < maxDuration ----------
  if (elapsedHours < maxDur) {
    if (relevance === 'related') {
      return { strategy: TRANSITION_STRATEGIES.CONTINUE, source: 'rule', elapsedHours, relevance, needLLM: false };
    }
    if (relevance === 'unrelated') {
      return { strategy: TRANSITION_STRATEGIES.SHIFT, source: 'rule', elapsedHours, relevance, needLLM: false };
    }
    return { strategy: TRANSITION_STRATEGIES.SOFT_CONTINUE, source: 'rule', elapsedHours, relevance, needLLM: false };
  }

  // ---------- maxDuration < 时间 < staleThreshold ----------
  if (elapsedHours < staleThresh) {
    // 模糊地带：可循环场景优先 reframe
    if (reframable && relevance !== 'unrelated') {
      return {
        strategy: TRANSITION_STRATEGIES.REFRAME,
        source: 'rule',
        elapsedHours,
        relevance,
        needLLM: false,
      };
    }
    if (relevance === 'related') {
      return { strategy: TRANSITION_STRATEGIES.SOFT_CONTINUE, source: 'rule', elapsedHours, relevance, needLLM: false };
    }
    if (relevance === 'unrelated') {
      return { strategy: TRANSITION_STRATEGIES.SOFT_SHIFT, source: 'rule', elapsedHours, relevance, needLLM: false };
    }
    // ambiguous：交给 LLM 裁决
    return { needLLM: true, elapsedHours, relevance };
  }

  // ---------- 时间 > staleThreshold ----------
  // 场景一定已结束
  if (elapsedHours >= 24) {
    // 跨天
    if (relevance === 'related') {
      return { strategy: TRANSITION_STRATEGIES.CROSS_DAY_RELATED, source: 'rule', elapsedHours, relevance, needLLM: false };
    }
    return { strategy: TRANSITION_STRATEGIES.CROSS_DAY_TRANSITION, source: 'rule', elapsedHours, relevance, needLLM: false };
  }

  // 同日内超过 staleThreshold
  if (reframable && relevance === 'related') {
    return {
      strategy: TRANSITION_STRATEGIES.REFRAME,
      source: 'rule',
      elapsedHours,
      relevance,
      needLLM: false,
    };
  }
  if (relevance === 'related' || relevance === 'ambiguous') {
    return { strategy: TRANSITION_STRATEGIES.COMPLETE_OLD, source: 'rule', elapsedHours, relevance, needLLM: false };
  }
  return { strategy: TRANSITION_STRATEGIES.SHIFT, source: 'rule', elapsedHours, relevance, needLLM: false };
}

// ============================================================
// LLM 裁决触发条件
// ============================================================

/**
 * 判断是否应该调用 LLM 裁决
 * 严格白名单：避免不必要消耗
 */
function shouldInvokeLLMArbiter(conv, scene, userMessage) {
  const settings = getAppState().get('settings') || {};
  const arbiterSettings = settings.llmArbiter || {};

  // 用户开关
  if (arbiterSettings.enabled === false) return false;

  // 消息太短
  if (!userMessage || userMessage.trim().length < 3) return false;

  const now = getGameTime();
  const sceneDef = getSceneDef(scene.type);
  const lastSeenAt = scene.lastSeenAt || conv.updatedAt || now;
  const elapsedHours = (now - lastSeenAt) / (1000 * 60 * 60);

  const relevance = checkSceneRelevance(userMessage, scene);

  // 1. 场景置信度过低
  if (scene.confidence < 0.6) return true;

  // 2. 相关性模糊
  if (relevance === 'ambiguous') return true;

  // 3. 时间处于模糊地带 + 相关性非明确相关
  if (elapsedHours > sceneDef.maxDuration
      && elapsedHours < sceneDef.staleThreshold
      && relevance !== 'related') {
    return true;
  }

  // 4. 时间处于 staleThreshold 附近（±30%）
  const staleLower = sceneDef.staleThreshold * 0.7;
  const staleUpper = sceneDef.staleThreshold * 1.3;
  if (elapsedHours > staleLower && elapsedHours < staleUpper) {
    return true;
  }

  return false;
}

// ============================================================
// LLM 裁决
// ============================================================

/**
 * 构建 LLM 裁决的 prompt
 */
function buildArbiterPrompt(conv, scene, userMessage) {
  const messages = (conv.messages || []).filter(m => m.role !== 'system');
  const recentMessages = messages.slice(-6).map(m => {
    const role = m.role === 'user' ? '用户' : '角色';
    return `${role}: ${m.content}`;
  }).join('\n');

  const lastMsg = messages[messages.length - 1];
  const hoursSince = lastMsg
    ? (getGameTime() - (lastMsg.timestamp || Date.now())) / (1000 * 60 * 60)
    : 0;

  const sceneDef = getSceneDef(scene.type);

  return `你是对话场景分析器。判断用户新消息与之前场景的关系。

【背景】
- 对话最后活跃：${hoursSince.toFixed(1)} 小时前
- 上次场景：${sceneDef.label}（置信度 ${scene.confidence.toFixed(2)}，识别方式 ${scene.method}）
- 场景合理时效：${sceneDef.maxDuration} 小时
- 场景过期阈值：${sceneDef.staleThreshold} 小时

【最近的对话】
${recentMessages}

【用户的新消息】
"${userMessage}"

【任务】
分析三个维度，只输出 JSON，不要任何解释：

1. relevance：用户新消息与上次场景的相关性
   - related：明显相关（如吃饭场景说"吃饱了"）
   - unrelated：明显无关（如切换话题）
   - ambiguous：模糊

2. strategy：应对策略
   - continue：直接接续（时间短，场景仍在进行）
   - reframe：场景重构（把"持续过久的场景"重构为合理阶段，如"吃了第二顿"）
   - complete_old：承认旧场景结束（用户在对旧场景收尾）
   - shift：温和切换话题
   - cross_day_transition：跨天转场

3. reframe_hint：若 strategy 为 reframe，简述重构方向（1 句）；否则留空

【判断示例】
- 吃饭场景，间隔 10 小时，用户说"吃饱了" → {"relevance":"related","strategy":"reframe","reframe_hint":"用户可能在吃第二顿或对之前的收尾"}
- 睡觉场景，间隔 8 小时，用户说"我醒了" → {"relevance":"related","strategy":"continue","reframe_hint":""}
- 亲密场景，间隔 3 小时，用户说"我们继续" → {"relevance":"related","strategy":"complete_old","reframe_hint":""}
- 用户说"对了" → 通常 related

输出格式：
{"relevance":"...","strategy":"...","reframe_hint":"..."}`;
}

/**
 * 解析 LLM 返回的 JSON（多层次容错）
 */
function parseArbiterJson(text) {
  if (!text) return null;

  // 剥离代码块
  let cleaned = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();

  // 直接解析
  let parsed = tryParse(cleaned);
  if (parsed) return parsed;

  // 提取最外层 JSON 对象
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    parsed = tryParse(jsonMatch[0]);
    if (parsed) return parsed;
  }

  // 修复截断
  const partialMatch = cleaned.match(/\{[\s\S]*/);
  if (partialMatch) {
    let partial = partialMatch[0];
    // 补齐引号和花括号
    const openQuotes = (partial.match(/"/g) || []).length;
    if (openQuotes % 2 === 1) partial += '"';
    const openBraces = (partial.match(/\{/g) || []).length;
    const closeBraces = (partial.match(/\}/g) || []).length;
    partial += '}'.repeat(Math.max(0, openBraces - closeBraces));
    parsed = tryParse(partial);
    if (parsed) return parsed;
  }

  return null;
}

function tryParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * 调用 LLM 裁决
 * @returns {Promise<Object|null>}
 */
async function invokeLLMArbiter(conv, scene, userMessage) {
  const prompt = buildArbiterPrompt(conv, scene, userMessage);

  try {
    console.log('[TransitionDecider] 调用 LLM 裁决');
    const response = await sendChatRequest({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: '你是对话场景分析器。只输出 JSON 对象，不要任何解释或 markdown 代码块。',
      temperature: 0.1,
      maxTokens: 300,
      stream: false,
    });

    const content = response.content?.trim();
    if (!content) {
      console.warn('[TransitionDecider] LLM 裁决返回空');
      return null;
    }

    const result = parseArbiterJson(content);
    if (!result) {
      console.warn('[TransitionDecider] LLM 裁决 JSON 解析失败:', content.slice(0, 200));
      return null;
    }

    // 校验
    const validStrategies = Object.values(TRANSITION_STRATEGIES);
    const validRelevances = ['related', 'unrelated', 'ambiguous'];

    if (!validStrategies.includes(result.strategy)) {
      console.warn('[TransitionDecider] LLM 返回无效策略:', result.strategy);
      return null;
    }
    if (!validRelevances.includes(result.relevance)) {
      console.warn('[TransitionDecider] LLM 返回无效相关性:', result.relevance);
      return null;
    }

    console.log('[TransitionDecider] LLM 裁决结果:', result);
    return result;
  } catch (e) {
    console.warn('[TransitionDecider] LLM 裁决调用失败:', e);
    return null;
  }
}

// ============================================================
// 主决策入口
// ============================================================

/**
 * 决策转场策略（规则 + LLM 裁决）
 *
 * @param {Object} conv - 会话对象
 * @param {string} userMessage - 用户新消息
 * @returns {Promise<Object>} 决策结果
 */
export async function decideTransition(conv, userMessage) {
  const state = normalizeConvState(conv);
  const scene = state.currentScene;

  // ---------- 无场景：无需转场 ----------
  if (!scene) {
    return {
      strategy: TRANSITION_STRATEGIES.NONE,
      source: 'no_scene',
      scene: null,
      sceneDef: null,
      elapsedHours: 0,
      relevance: 'ambiguous',
    };
  }

  // ---------- 规则决策 ----------
  const ruleDecision = decideByRules(conv, scene, userMessage);

  // ---------- 不需 LLM ----------
  if (!ruleDecision.needLLM) {
    const sceneDef = getSceneDef(scene.type);
    return {
      strategy: ruleDecision.strategy,
      source: ruleDecision.source,
      scene,
      sceneDef,
      elapsedHours: ruleDecision.elapsedHours,
      relevance: ruleDecision.relevance,
      reframeHint: ruleDecision.strategy === TRANSITION_STRATEGIES.REFRAME
        ? getSceneReframeHint(scene.type, ruleDecision.elapsedHours)
        : null,
      forcedSensitive: ruleDecision.forcedSensitive || false,
    };
  }

  // ---------- 需要 LLM ----------
  if (shouldInvokeLLMArbiter(conv, scene, userMessage)) {
    const llmResult = await invokeLLMArbiter(conv, scene, userMessage);

    if (llmResult) {
      const sceneDef = getSceneDef(scene.type);
      // 敏感场景：LLM 若返回 reframe，强制改为 complete_old
      let strategy = llmResult.strategy;
      if (isSensitive(scene.type) && strategy === TRANSITION_STRATEGIES.REFRAME) {
        strategy = TRANSITION_STRATEGIES.COMPLETE_OLD;
        console.log('[TransitionDecider] 敏感场景，reframe 降级为 complete_old');
      }
      return {
        strategy,
        source: 'llm',
        scene,
        sceneDef,
        elapsedHours: ruleDecision.elapsedHours,
        relevance: llmResult.relevance,
        reframeHint: llmResult.reframe_hint || null,
      };
    }
    // LLM 失败，走降级
  }

  // ---------- 降级：用规则结果 ----------
  const sceneDef = getSceneDef(scene.type);
  // ambiguous 情况下，走 complete_old 保守策略
  return {
    strategy: TRANSITION_STRATEGIES.COMPLETE_OLD,
    source: 'fallback',
    scene,
    sceneDef,
    elapsedHours: ruleDecision.elapsedHours,
    relevance: ruleDecision.relevance,
    reframeHint: null,
  };
}

// ============================================================
// 策略指令生成
// ============================================================

/**
 * 获取策略的核心指令（描述"做什么"）
 */
function getStrategyInstruction(strategy, sceneDef, relevance) {
  switch (strategy) {
    case TRANSITION_STRATEGIES.CONTINUE:
      return `直接接续之前的话题，不需要提及时间跨度。`;

    case TRANSITION_STRATEGIES.SOFT_CONTINUE:
      return `倾向接续之前的话题。可以自然融入当前场景。`;

    case TRANSITION_STRATEGIES.REFRAME:
      return `时间已经过去较久，"${sceneDef.label}"这个具体场景已经结束，但用户的话与它相关。请把它重构为合理的阶段转换——例如"又吃了一顿"、"这是第二觉"、"还在打？"。不要假装场景还在进行。`;

    case TRANSITION_STRATEGIES.COMPLETE_OLD:
      return `时间过去很久，"${sceneDef.label}"早已结束。${sceneDef.transitionTemplate || ''} 承认时间跨度，接住用户的话，但不要质问用户"你为什么离开这么久"。`;

    case TRANSITION_STRATEGIES.SHIFT:
      return `用户切换了话题。自然过渡，不需要刻意提起"${sceneDef.label}"。`;

    case TRANSITION_STRATEGIES.SOFT_SHIFT:
      return `时间过去了一段时间，用户的话题与"${sceneDef.label}"关系不大。自然过渡即可。`;

    case TRANSITION_STRATEGIES.CROSS_DAY_RELATED:
      return `已经跨天。用户的话与"${sceneDef.label}"相关，请把旧场景当作"过去的记忆"来承接。可以表达"还记得上次你说…"式的关联，但不要刻意。`;

    case TRANSITION_STRATEGIES.CROSS_DAY_TRANSITION:
      return `已经跨天。用户开启了新话题。自然开场即可，不要主动提起旧场景。`;

    default:
      return '';
  }
}

/**
 * 获取策略的"避免"清单
 */
function getStrategyAvoid(strategy, sceneDef) {
  const avoid = [];

  if (strategy === TRANSITION_STRATEGIES.CONTINUE || strategy === TRANSITION_STRATEGIES.SOFT_CONTINUE) {
    return '（无需特别避免）';
  }

  avoid.push('不要机械地调侃"你干嘛去了"或"怎么才回来"');
  avoid.push('不要假装旧场景还在进行');

  if (strategy === TRANSITION_STRATEGIES.REFRAME) {
    avoid.push('不要直接说"吃太久了吧"这种质疑时间的话——除非你的人设就是这样');
    avoid.push('不要把重构写成固定模板，用你的人设语气表达');
  }

  if (strategy === TRANSITION_STRATEGIES.COMPLETE_OLD) {
    avoid.push('不要质问用户离开的原因');
    avoid.push('不要表现出"被抛弃"的委屈（除非冷落感知明确要求）');
  }

  if (strategy === TRANSITION_STRATEGIES.CROSS_DAY_RELATED) {
    avoid.push('不要精确计算时间（如"你 22 小时 15 分钟前说…"）');
  }

  return avoid.map(a => `- ${a}`).join('\n');
}

/**
 * 获取场景的特殊提示（敏感场景专用）
 */
function getSpecialRules(strategy, sceneDef, decision) {
  const rules = [];

  if (sceneDef.sensitivity === 'high') {
    if (sceneDef.label === '亲密') {
      rules.push(`【亲密场景特殊规则】`);
      rules.push(`绝对不要假装刚才还在进行亲密互动。`);
      rules.push(`不要主动提起上次的亲密细节，除非用户先提。`);
      rules.push(`用日常语气接住用户的新发言。`);
    } else if (sceneDef.label === '争执') {
      rules.push(`【冲突场景特殊规则】`);
      rules.push(`争执的情绪会残留。不要假装什么都没发生。`);
      rules.push(`如果用户友好，可以慢慢缓和；如果用户若无其事，可以有点小情绪。`);
    }
  }

  if (decision.reframeHint) {
    rules.push(`\n【重构方向】${decision.reframeHint}`);
  }

  return rules.length > 0 ? '\n' + rules.join('\n') : '';
}

// ============================================================
// 转场提示词生成（含人设染色）
// ============================================================

/**
 * 生成转场提示词
 *
 * @param {Object} decision - decideTransition 的返回
 * @param {Object} conv - 会话对象
 * @param {Object} character - 角色对象（用于人设染色）
 * @param {string} userMessage - 用户新消息
 * @returns {string} 转场提示词，若无需转场返回空串
 */
export function buildTransitionPrompt(decision, conv, character, userMessage) {
  const { strategy, sceneDef, elapsedHours, relevance } = decision;

  // 无需转场
  if (strategy === TRANSITION_STRATEGIES.NONE
      || strategy === TRANSITION_STRATEGIES.CONTINUE) {
    return '';
  }

  // 时间描述
  let hoursText;
  if (elapsedHours < 1) {
    hoursText = `${Math.round(elapsedHours * 60)} 分钟前`;
  } else if (elapsedHours < 24) {
    hoursText = `${Math.round(elapsedHours)} 小时前`;
  } else {
    hoursText = `${Math.round(elapsedHours / 24)} 天前`;
  }

  // 人设摘要
  const personaBrief = buildPersonaBrief(character);

  // 情感状态
  let emotionText = '';
  if (character.emotionState) {
    const e = character.emotionState;
    emotionText = `愉悦度 ${Math.round(e.valence)}，唤醒度 ${Math.round(e.arousal)}，好感度 ${Math.round(e.affection)}`;
  } else {
    emotionText = '中性';
  }

  // 策略指令
  const instruction = getStrategyInstruction(strategy, sceneDef, relevance);
  const avoid = getStrategyAvoid(strategy, sceneDef);
  const specialRules = getSpecialRules(strategy, sceneDef, decision);

  // 语气方向
  const toneHint = getToneHint(character);

  return `【场景转场】
上次场景：${sceneDef.label}（约 ${hoursText}）
用户新消息：${userMessage}
当前策略：${strategy}
相关性：${relevance}

【角色人设】
${personaBrief}

【当前情感状态】
${emotionText}

【处理原则】
1. ${instruction}
2. 用符合你人设的方式表达——活泼/温柔/高冷/毒舌，都请自然体现
3. 保持对话连贯性——用户的新消息是当前焦点，旧场景是背景${specialRules}

【避免】
${avoid}

【语气参考】（仅供参考，不要照抄！请根据你的人设自由发挥）
${toneHint}`;
}

// ============================================================
// 与冷落感知的协调
// ============================================================

/**
 * 协调冷落提示与转场决策
 *
 * 规则：
 *   - continue / soft_continue：对话活跃，冷落不触发
 *   - cross_day_*：冷落必须用期待语气（非抱怨）
 *   - reframe：冷落减半（语气偏轻）
 *   - complete_old / shift：冷落保持
 *
 * @param {Object} decision - 转场决策
 * @param {string} coldPrompt - 冷落提示词
 * @returns {string} 调整后的冷落提示词
 */
export function coordinateColdPrompt(decision, coldPrompt) {
  if (!coldPrompt) return coldPrompt;
  const strategy = decision?.strategy;

  // 对话活跃，不注入冷落
  if (strategy === TRANSITION_STRATEGIES.CONTINUE
      || strategy === TRANSITION_STRATEGIES.SOFT_CONTINUE) {
    return '';
  }

  // 跨天场景：冷落改为期待语气
  if (strategy === TRANSITION_STRATEGIES.CROSS_DAY_RELATED
      || strategy === TRANSITION_STRATEGIES.CROSS_DAY_TRANSITION) {
    return coldPrompt
      .replace(/抱怨|委屈|怨念/g, '想念')
      .replace(/孤独/g, '想念')
      + '\n（注意：语气要自然、期待，不要抱怨或讽刺。）';
  }

  // 重构场景：冷落减半（保留但语气轻）
  if (strategy === TRANSITION_STRATEGIES.REFRAME) {
    return coldPrompt + '\n（注意：语气要轻，不要显得"被冷落"很严重。）';
  }

  return coldPrompt;
}

// ============================================================
// 便捷入口：一站式决策 + 提示词生成
// ============================================================

/**
 * 一站式：决策 + 生成提示词
 *
 * @param {Object} conv
 * @param {Object} character
 * @param {string} userMessage
 * @returns {Promise<{ decision, prompt }>}
 */
export async function analyzeAndBuildTransition(conv, character, userMessage) {
  const decision = await decideTransition(conv, userMessage);
  const prompt = decision.strategy === TRANSITION_STRATEGIES.NONE
    ? ''
    : buildTransitionPrompt(decision, conv, character, userMessage);

  return { decision, prompt };
}