// js/modules/emotionClassifier.js - 情绪识别的规则层与融合层
//
// 职责：
//   1. 规则层：子句切分 + 作用域匹配，识别否定、施事、受体
//   2. 融合层：把规则层 / 语义层 / LLM 三路证据按统一策略合成最终结论
//
// 为什么规则层必须对语义层有否决权：
//   向量模型对「我喜欢你」与「我不喜欢你」的余弦相似度极高（仅差一个否定词），
//   语义相似度天然对否定不可靠。所以否定与施受关系这类**结构性信息**
//   只由规则层裁定，语义层不得推翻。

import {
  EVENT_TYPES,
  NEGATION_TOKENS,
  NEGATION_EXCEPTIONS,
  PRONOUNS,
  CLAUSE_PUNCTUATION,
  CLAUSE_CONJUNCTIONS,
  NEGATION_WINDOW,
  NEUTRAL_TYPE,
  getNegatedType,
} from './emotionLexicon.js';

// 长词优先匹配，避免「一点也不」被拆成「不」重复计数
const NEGATION_SORTED = [...NEGATION_TOKENS].sort((a, b) => b.length - a.length);
const PRONOUN_ALL = Object.entries(PRONOUNS)
  .flatMap(([role, list]) => list.map(word => ({ word, role })))
  .sort((a, b) => b.word.length - a.word.length);

// ============================================================
// 子句切分
// ============================================================

/**
 * 把文本切成子句，并给出每句的权重。
 *
 * 权重设计：靠后的子句更重。中文里「虽然…但是…」的重心在后者，
 * 这条启发式能抓住转折结构，避免前半句的客套话主导判定。
 *
 * @param {string} text
 * @returns {Array<{text: string, index: number, weight: number}>}
 */
export function splitClauses(text) {
  if (typeof text !== 'string' || !text) return [];

  let parts = [text];
  for (const conj of CLAUSE_CONJUNCTIONS) {
    parts = parts.flatMap(p => p.split(conj));
  }
  for (const punct of CLAUSE_PUNCTUATION) {
    parts = parts.flatMap(p => p.split(punct));
  }

  const clauses = parts
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map((p, i) => ({ text: p, index: i, weight: 1 }));

  const n = clauses.length;
  for (let i = 0; i < n; i++) {
    // 单句时权重为 1；多句时从 0.6 线性升到 1.0
    clauses[i].weight = n === 1 ? 1 : 0.6 + 0.4 * (i / (n - 1));
  }
  return clauses;
}

// ============================================================
// 结构识别：否定
// ============================================================

/**
 * 标记子句中被「否定例外词」覆盖的字符位置。
 * 不做这层保护时，「特别喜欢你」会把「别」当否定、「不错」会把「不」当否定。
 * @param {string} clause
 * @returns {Set<number>}
 */
function buildExceptedIndexSet(clause) {
  const excepted = new Set();
  for (const word of NEGATION_EXCEPTIONS) {
    let from = 0;
    for (;;) {
      const at = clause.indexOf(word, from);
      if (at === -1) break;
      for (let k = at; k < at + word.length; k++) excepted.add(k);
      from = at + 1;
    }
  }
  return excepted;
}

/**
 * 统计命中词之前的否定词个数。
 * 奇数表示被否定，偶数表示未被否定（支持「我没有不喜欢你」这类双重否定）。
 *
 * @param {string} clause
 * @param {number} matchStart 命中词的起始下标
 * @param {Set<number>} excepted
 * @returns {number}
 */
function countNegations(clause, matchStart, excepted) {
  const start = Math.max(0, matchStart - NEGATION_WINDOW);
  let count = 0;
  let i = start;

  while (i < matchStart) {
    let matched = null;
    for (const token of NEGATION_SORTED) {
      if (clause.startsWith(token, i)) { matched = token; break; }
    }
    if (matched) {
      if (!excepted.has(i)) count++;
      i += matched.length;
    } else {
      i += 1;
    }
  }
  return count;
}

// ============================================================
// 结构识别：人称
// ============================================================

/**
 * 在 [from, to) 范围内查找最先出现的代词。
 * @param {string} clause
 * @param {number} from
 * @param {number} to
 * @returns {{role: string, at: number}|null}
 */
function findPronounIn(clause, from, to) {
  for (let i = from; i < to; i++) {
    for (const { word, role } of PRONOUN_ALL) {
      if (clause.startsWith(word, i)) return { role, at: i };
    }
  }
  return null;
}

/**
 * 判定一处命中的施事与受体。
 *
 * 判定依据是句中代词相对命中词的位置：
 *   - 命中词之后存在代词 → 属「A-动词-B」结构，前为施事、后为受体
 *     （「我喜欢你」→ 施事=我，受体=你）
 *   - 命中词之后没有代词，且前置代词是「你 / 他」这类非第一人称
 *     → 属形容词谓语，该代词其实是受事
 *     （「你很笨」里的「你」是被评价的对象，不是施事）
 *   - 命中词之后没有代词，且前置代词是「我」
 *     → 「我」是主语而非宾语（「我很喜欢」）。此时若命中词后面还有
 *       实质内容（「我喜欢这个游戏」），说明真正的宾语是别的东西，
 *       用 objectExplicit 标记出来供上层判定。
 *
 * 这三条区分都很关键：若把「你很笨」的「你」当成施事，会错失一次
 * 真实批评；若把「我很喜欢」的「我」当成受体，会把亲密表达判成
 * 与角色无关的转述。
 *
 * @param {string} clause
 * @param {number} matchStart
 * @param {number} matchEnd
 * @returns {{agent: string, target: string, objectExplicit: boolean}}
 */
function resolveAgentTarget(clause, matchStart, matchEnd) {
  const after = findPronounIn(clause, matchStart, clause.length);
  const before = findPronounIn(clause, 0, matchStart);

  if (after) {
    return { agent: before ? before.role : 'unknown', target: after.role, objectExplicit: false };
  }

  if (before && before.role === 'user') {
    // 前置的「我」是主语。对象要么被省略（默认就是角色），要么显式指向别的事物。
    // 语气助词与标点不算「显式宾语」，否则「我很喜欢啊」会被误判。
    const trailing = clause.slice(matchEnd).replace(/[啊呀呢吧了的吗哦喔嘛啦哟哈\s~！。？，,!.?]/g, '');
    return { agent: 'user', target: 'unknown', objectExplicit: trailing.length > 0 };
  }

  return {
    agent: 'unknown',
    target: before ? before.role : 'unknown',
    objectExplicit: false,
  };
}

// ============================================================
// 规则层匹配
// ============================================================

/**
 * 找出某个词在子句中所有非重叠出现位置。
 * @param {string} clause
 * @param {string} word
 * @param {number} cap 单次最多计入几次
 * @returns {number[]}
 */
function findOccurrences(clause, word, cap = 2) {
  const positions = [];
  let from = 0;
  while (positions.length < cap) {
    const at = clause.indexOf(word, from);
    if (at === -1) break;
    positions.push(at);
    from = at + word.length;
  }
  return positions;
}

/**
 * 对单个子句做规则匹配。
 * @param {{text: string, weight: number}} clause
 * @returns {Array<Object>} 命中项
 */
function matchClause(clause) {
  const { text, weight } = clause;
  const lower = text.toLowerCase();
  const excepted = buildExceptedIndexSet(text);
  const hits = [];

  for (const [type, def] of Object.entries(EVENT_TYPES)) {
    const strongPositions = [];

    // 强词：权重 2
    for (const word of def.words || []) {
      for (const at of findOccurrences(lower, word)) {
        const end = at + word.length;
        const { agent, target, objectExplicit } = resolveAgentTarget(text, at, end);
        const negCount = countNegations(text, at, excepted);
        strongPositions.push({ word, at });
        hits.push({
          type,
          word,
          weight: 2,
          clauseWeight: weight,
          negated: negCount % 2 === 1,
          negationCount: negCount,
          agent,
          target,
          objectExplicit,
          source: 'word',
        });
      }
    }

    // 弱词：权重 1，且必须在同子句内已有强词命中时才计入
    // 目的：收纳「去」「做」「能」这类单独出现极易误判的高频字
    if ((def.weakWords || []).length > 0 && strongPositions.length > 0) {
      for (const word of def.weakWords) {
        for (const at of findOccurrences(lower, word)) {
          const end = at + word.length;
          const { agent, target, objectExplicit } = resolveAgentTarget(text, at, end);
          const negCount = countNegations(text, at, excepted);
          hits.push({
            type,
            word,
            weight: 1,
            clauseWeight: weight,
            negated: negCount % 2 === 1,
            negationCount: negCount,
            agent,
            target,
            objectExplicit,
            source: 'weakWord',
          });
        }
      }
    }

    // 正则模式：权重 3。模式本身已表达结构，故不再做否定判定。
    for (const pattern of def.patterns || []) {
      let re;
      try {
        re = new RegExp(pattern, 'i');
      } catch (_) {
        continue;
      }
      const m = re.exec(text);
      if (!m) continue;
      const at = m.index;
      const end = at + m[0].length;
      const { agent, target, objectExplicit } = resolveAgentTarget(text, at, end);
      hits.push({
        type,
        word: m[0],
        weight: 3,
        clauseWeight: weight,
        negated: countNegations(text, at, excepted) % 2 === 1,
        negationCount: 0,
        agent,
        target,
        objectExplicit,
        source: 'pattern',
      });
    }
  }

  return hits;
}

// ============================================================
// 命中解析：否定映射 + 第三方重定向
// ============================================================

/**
 * 把一次原始命中解析为最终事件类别。
 *
 * 判定顺序遵循「结构优先于极性」：
 *   第三方介入改变的是事件主体，比单纯的正负翻转更根本，因此先判。
 *
 * @param {Object} hit
 * @returns {Object} 附加 resolvedType 与 reason 的命中项
 */
export function resolveHitType(hit) {
  const def = EVENT_TYPES[hit.type];
  if (!def) return { ...hit, resolvedType: hit.type, reason: 'unknown' };

  // rival_affection 本身是重定向的终点，跳过二次判定。
  // 若继续往下走，它会因为「施事是第三方 + 极性为负」被反向判成
  // 「吐槽第三方」，把同一句话拆成两个互相打架的类别。
  if (hit.type === 'rival_affection') {
    return { ...hit, resolvedType: 'rival_affection', reason: '第三方示好（直接命中）' };
  }

  const { agent, target, negated } = hit;
  const isPositive = def.polarity === 'positive';
  const isNegative = def.polarity === 'negative';

  if (def.directed) {
    const thirdAsAgent = agent === 'third';
    const thirdAsTarget = target === 'third';
    const agentIsCharacter = agent === 'character';

    // ① 用户对第三方表达正向情感 —— 从角色视角是竞争信号
    if (thirdAsTarget && isPositive) {
      return negated
        ? { ...hit, resolvedType: 'reassurance', reason: '否认对第三方有意' }
        : { ...hit, resolvedType: 'rival_affection', reason: '情感指向第三方' };
    }
    // ② 第三方对角色表达正向情感
    if (thirdAsAgent && isPositive) {
      return negated
        ? { ...hit, resolvedType: 'gossip', reason: '转述第三方（否定）' }
        : { ...hit, resolvedType: 'rival_affection', reason: '第三方示好' };
    }
    // ③ 负面情感指向第三方 —— 与角色无关的吐槽
    if (thirdAsTarget && isNegative) {
      return { ...hit, resolvedType: 'gossip', reason: '吐槽第三方' };
    }
    // ④ 第三方施事的负面表达 —— 转述
    if (thirdAsAgent && isNegative) {
      return { ...hit, resolvedType: 'gossip', reason: '转述第三方负面评价' };
    }
    // ⑤ 转述角色自身的情感（「你喜欢我」）—— 不是用户在表达
    if (agentIsCharacter && isPositive) {
      return { ...hit, resolvedType: 'gossip', reason: '转述角色情感' };
    }
    // ⑥ 亲密表达但宾语显式指向别的事物（如「我喜欢这个游戏」）。
    //    只对 intimate 生效：其他类别的宾语本来就常常是用户自己
    //    （「能帮我一下吗」里的「我」），套用这条会误伤。
    if (hit.type === 'intimate' && hit.objectExplicit === true && isPositive) {
      return { ...hit, resolvedType: 'gossip', reason: '情感对象非角色' };
    }
  }

  // ⑥ 常规：按否定映射到对偶类别；无对偶时由影响向量取反处理
  if (negated) {
    const negatedType = getNegatedType(hit.type);
    if (negatedType) {
      return { ...hit, resolvedType: negatedType, reason: `否定 → ${negatedType}` };
    }
    return { ...hit, resolvedType: hit.type, polarityFlip: true, reason: '否定（向量取反）' };
  }

  return { ...hit, resolvedType: hit.type, reason: '直接命中' };
}

// ============================================================
// 聚合
// ============================================================

const AMBIVALENCE_RATIO = 0.35;
const MARGIN_CONFIDENT = 0.35;
const EVIDENCE_FULL_SCORE = 12;

/**
 * 把命中项聚合成单一结论。
 * @param {Array<Object>} resolvedHits
 * @returns {Object}
 */
function aggregate(resolvedHits) {
  const scores = new Map();
  let positiveScore = 0;
  let negativeScore = 0;
  let flipped = null;

  for (const hit of resolvedHits) {
    if (hit.resolvedType === NEUTRAL_TYPE) continue;
    const value = hit.weight * hit.clauseWeight;
    scores.set(hit.resolvedType, (scores.get(hit.resolvedType) || 0) + value);

    const def = EVENT_TYPES[hit.resolvedType];
    if (def) {
      if (hit.polarityFlip) {
        if (!flipped) flipped = { type: hit.resolvedType, score: 0 };
        flipped.score += value;
        if (def.polarity === 'positive') negativeScore += value;
        else if (def.polarity === 'negative') positiveScore += value;
      } else if (def.polarity === 'positive') {
        positiveScore += value;
      } else if (def.polarity === 'negative') {
        negativeScore += value;
      }
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) {
    return {
      type: NEUTRAL_TYPE,
      score: 0,
      secondType: null,
      secondScore: 0,
      margin: 1,
      confidence: 0,
      ambivalent: false,
      intensity: 0,
      positiveScore: 0,
      negativeScore: 0,
      polarityFlip: null,
      scores: {},
    };
  }

  const [topType, topScore] = ranked[0];
  const [secondType, secondScore] = ranked[1] || [null, 0];

  const margin = topScore > 0 ? (topScore - secondScore) / topScore : 1;
  const evidence = Math.min(1, topScore / EVIDENCE_FULL_SCORE);
  const confidence = Math.max(0, Math.min(1, 0.5 * evidence + 0.5 * margin));

  const bothPresent = positiveScore > 0 && negativeScore > 0;
  const ambivalent = bothPresent
    && Math.min(positiveScore, negativeScore) / Math.max(positiveScore, negativeScore) > AMBIVALENCE_RATIO;

  let intensity = Math.min(1, 0.25 + topScore * 0.05);
  if (ambivalent) intensity *= 0.6;   // 情绪矛盾时削弱强度，避免单边放大

  return {
    type: topType,
    score: topScore,
    secondType,
    secondScore,
    margin,
    confidence,
    ambivalent,
    intensity,
    positiveScore,
    negativeScore,
    polarityFlip: flipped,
    scores: Object.fromEntries(scores),
  };
}

// ============================================================
// 对外：规则层识别
// ============================================================

/**
 * 仅用规则层识别。
 *
 * @param {string} text
 * @param {{debug?: boolean}} [opts]
 * @returns {Object} 识别结果；debug=true 时附带完整判定过程
 */
export function classifyByRules(text, opts = {}) {
  const safeText = typeof text === 'string' ? text : '';
  if (!safeText.trim()) {
    return {
      type: NEUTRAL_TYPE,
      intensity: 0,
      confidence: 0,
      margin: 1,
      ambivalent: false,
      score: 0,
      layer: 'rule',
      clauses: [],
      hits: [],
    };
  }

  const clauses = splitClauses(safeText);
  const allHits = [];
  const clauseDebug = [];

  for (const clause of clauses) {
    const hits = matchClause(clause);
    const resolved = hits.map(resolveHitType);
    allHits.push(...resolved);
    if (opts.debug) {
      clauseDebug.push({
        text: clause.text,
        weight: Number(clause.weight.toFixed(2)),
        hits: resolved.map(h => ({
          word: h.word,
          type: h.type,
          resolvedType: h.resolvedType,
          weight: h.weight,
          source: h.source,
          negated: h.negated,
          negationCount: h.negationCount,
          agent: h.agent,
          target: h.target,
          reason: h.reason,
        })),
      });
    }
  }

  const agg = aggregate(allHits);

  const result = {
    type: agg.type,
    intensity: Number(agg.intensity.toFixed(4)),
    confidence: Number(agg.confidence.toFixed(4)),
    margin: Number(agg.margin.toFixed(4)),
    ambivalent: agg.ambivalent,
    score: Number(agg.score.toFixed(4)),
    secondType: agg.secondType,
    secondScore: Number(agg.secondScore.toFixed(4)),
    positiveScore: Number(agg.positiveScore.toFixed(4)),
    negativeScore: Number(agg.negativeScore.toFixed(4)),
    polarityFlip: agg.polarityFlip ? agg.polarityFlip.type : null,
    scores: agg.scores,
    layer: 'rule',
  };

  if (opts.debug) {
    result.clauses = clauseDebug;
    result.hits = allHits.map(h => ({
      word: h.word,
      type: h.type,
      resolvedType: h.resolvedType,
      negated: h.negated,
      agent: h.agent,
      target: h.target,
      reason: h.reason,
    }));
  }

  return result;
}

/**
 * 规则层是否给出了「结构性裁定」。
 *
 * 结构性裁定指否定或第三方介入这类由语法结构决定、语义相似度无法可靠区分的情况。
 * 一旦命中，融合层必须直接采纳规则层结论，不得让语义层推翻。
 *
 * @param {Object} ruleResult classifyByRules 的结果（需 debug=true）
 * @returns {boolean}
 */
export function hasStructuralVerdict(ruleResult) {
  if (!ruleResult || !Array.isArray(ruleResult.hits)) return false;
  return ruleResult.hits.some(h =>
    h.negated
    || h.agent === 'third'
    || h.target === 'third'
    || h.agent === 'character'
    || /否定|第三方|转述|指向第三方/.test(h.reason || '')
  );
}

/**
 * 规则层结论是否足够确定，无需再询问下层。
 * @param {Object} ruleResult
 * @returns {boolean}
 */
export function isRuleConfident(ruleResult) {
  if (!ruleResult || ruleResult.type === NEUTRAL_TYPE) return false;
  return ruleResult.margin >= MARGIN_CONFIDENT && ruleResult.score >= 2;
}

export { AMBIVALENCE_RATIO, MARGIN_CONFIDENT };

// ============================================================
// 融合层
// ============================================================
//
// 三层证据的量纲不同：规则层是「命中权重累加」，语义层是余弦相似度。
// 融合时各自归一化到 0~1 再加权，权重按规则层证据强度自适应：
// 规则层证据越弱，越把话语权交给语义层 —— 字典覆盖不到的正是这种情况。

const SEM_FLOOR = 0.4;
const SEM_CEIL = 0.9;

/**
 * 规则层得分归一化。最高者为 1，其余按比例。
 * @param {Object} scores
 * @returns {Object}
 */
function normalizeRuleScores(scores) {
  const values = Object.values(scores || {});
  const max = values.length > 0 ? Math.max(...values) : 0;
  if (max <= 0) return {};
  const out = {};
  for (const [type, value] of Object.entries(scores)) out[type] = value / max;
  return out;
}

/**
 * 语义相似度映射到 0~1。低于下限的已被语义层过滤掉。
 * @param {Array<{type: string, score: number}>|null} list
 * @returns {Object}
 */
function normalizeSemanticScores(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    out[item.type] = Math.max(0, Math.min(1, (item.score - SEM_FLOOR) / (SEM_CEIL - SEM_FLOOR)));
  }
  return out;
}

/**
 * 按规则层证据强度决定两层权重。
 * @param {number} ruleEvidence 规则层最高得分
 * @returns {{ruleWeight: number, semWeight: number}}
 */
function resolveWeights(ruleEvidence) {
  const ruleWeight = ruleEvidence >= 6 ? 0.7
    : ruleEvidence >= 4 ? 0.6
      : ruleEvidence >= 2 ? 0.5
        : 0.35;
  return { ruleWeight, semWeight: 1 - ruleWeight };
}

/**
 * 合并两路得分。
 * @param {Object} ruleResult
 * @param {Array|null} semanticList
 * @returns {{fused: Object, ruleNorm: Object, semNorm: Object, ruleWeight: number, semWeight: number}}
 */
export function fuseScores(ruleResult, semanticList) {
  const { ruleWeight, semWeight } = resolveWeights(ruleResult.score || 0);
  const ruleNorm = normalizeRuleScores(ruleResult.scores);
  const semNorm = normalizeSemanticScores(semanticList);

  const types = new Set([...Object.keys(ruleNorm), ...Object.keys(semNorm)]);
  const fused = {};
  for (const type of types) {
    fused[type] = ruleWeight * (ruleNorm[type] || 0) + semWeight * (semNorm[type] || 0);
  }

  return { fused, ruleNorm, semNorm, ruleWeight, semWeight };
}

/**
 * 把融合得分整理成与规则层一致的结论结构。
 * @param {Object} fusion
 * @param {Object} ruleResult
 * @returns {Object}
 */
function finalizeFusion(fusion, ruleResult) {
  const ranked = Object.entries(fusion.fused).sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) {
    return {
      type: NEUTRAL_TYPE,
      intensity: 0,
      confidence: 0,
      margin: 1,
      ambivalent: ruleResult.ambivalent,
      score: 0,
      secondType: null,
      secondScore: 0,
      scores: {},
    };
  }

  const [topType, topScore] = ranked[0];
  const [secondType, secondScore] = ranked[1] || [null, 0];
  const margin = topScore > 0 ? (topScore - secondScore) / topScore : 1;

  // 强度：与规则层结论一致时沿用规则层的强度，保持纯规则路径的行为不变；
  //       结论被语义层改写时按融合得分重新推算。
  const baseIntensity = topType === ruleResult.type
    ? ruleResult.intensity
    : Math.min(1, 0.3 + topScore * 0.4);

  return {
    type: topType,
    intensity: ruleResult.ambivalent ? baseIntensity * 0.6 : baseIntensity,
    confidence: Math.max(0, Math.min(1, 0.5 * Math.min(1, topScore / 0.85) + 0.5 * margin)),
    margin,
    ambivalent: ruleResult.ambivalent,
    score: topScore,
    secondType,
    secondScore,
    scores: fusion.fused,
  };
}

/**
 * 是否需要 LLM 仲裁。
 *
 * 判据是「证据是否冲突」，而不是「分数是否够高」——用固定分数阈值会
 * 让命中词多的句子永久跳过仲裁，即分类器错得越自信、兜底越不介入。
 *
 * @param {Object} fusedResult
 * @returns {boolean}
 */
export function needsArbitration(fusedResult) {
  if (!fusedResult || fusedResult.type === NEUTRAL_TYPE) return false;
  return fusedResult.margin < MARGIN_CONFIDENT || fusedResult.ambivalent === true;
}

// ============================================================
// 对外：三层级联
// ============================================================

/**
 * 构建最终返回结构。
 * 保持 type / intensity 必存，以兼容既有调用方（chat.js 只读这两个字段）。
 */
function buildResult(base, { layer, arbitration, ruleResult, trace, debug, override = null }) {
  const result = {
    type: override?.type ?? base.type,
    intensity: Number(((override?.intensity ?? base.intensity) || 0).toFixed(4)),
    confidence: Number(((override?.confidence ?? base.confidence) || 0).toFixed(4)),
    margin: Number((base.margin ?? 1).toFixed(4)),
    ambivalent: Boolean(base.ambivalent),
    score: Number((base.score || 0).toFixed(4)),
    secondType: base.secondType ?? null,
    secondScore: Number((base.secondScore || 0).toFixed(4)),
    target: override?.target ?? null,
    polarityFlip: ruleResult?.polarityFlip ?? null,
    layer,
    arbitration,
  };

  if (debug) {
    result.clauses = ruleResult?.clauses || [];
    result.scores = base.scores || ruleResult?.scores || {};
    result.trace = trace;
    result.rule = ruleResult ? {
      type: ruleResult.type,
      intensity: ruleResult.intensity,
      confidence: ruleResult.confidence,
      margin: ruleResult.margin,
      score: ruleResult.score,
      ambivalent: ruleResult.ambivalent,
      positiveScore: ruleResult.positiveScore,
      negativeScore: ruleResult.negativeScore,
    } : null;
  }

  return result;
}

/**
 * 三层级联的情绪识别入口。
 *
 * 裁定顺序（不可调换）：
 *   ① 规则层结构性裁定（否定 / 第三方）→ 直接采纳，语义层不得推翻
 *   ② 规则层证据充分 → 直接采纳，不额外付出语义层开销
 *   ③ 语义层补充证据 → 与规则层加权融合
 *   ④ 仅当融合结果前两名差距过小或极性矛盾时，才请 LLM 仲裁
 *
 * @param {string} text
 * @param {{
 *   semanticMode?: 'off'|'auto'|'always',
 *   useLLMArbiter?: boolean,
 *   llmArbiter?: Function|null,
 *   debug?: boolean,
 * }} [options]
 * @returns {Promise<Object>}
 */
export async function classifyEmotion(text, options = {}) {
  const {
    semanticMode = 'auto',
    useLLMArbiter = false,
    llmArbiter = null,
    debug = false,
  } = options;

  const ruleResult = classifyByRules(text, { debug: true });
  const trace = {
    rule: {
      type: ruleResult.type,
      score: ruleResult.score,
      margin: ruleResult.margin,
      ambivalent: ruleResult.ambivalent,
    },
  };

  // ① 结构性裁定：否定与第三方介入是语义相似度无法可靠区分的
  //    （「我爱你」与「我不爱你」在向量空间几乎重合），必须由规则层一票定音。
  if (hasStructuralVerdict(ruleResult) && isRuleConfident(ruleResult)) {
    trace.decision = '规则层结构性裁定，跳过下层';
    return buildResult(ruleResult, {
      layer: 'rule', arbitration: 'structural', ruleResult, trace, debug,
    });
  }

  // ② 规则层已足够确定时，默认不再付语义层开销
  const needSemantic = semanticMode === 'always'
    || (semanticMode === 'auto' && !isRuleConfident(ruleResult));

  let semanticList = null;
  if (needSemantic) {
    try {
      // 动态导入：让纯规则层保持零依赖，单测无需加载模型相关模块
      const semantic = await import('./emotionSemantic.js');
      trace.semanticStatus = semantic.getEmotionSemanticStatus();
      semanticList = await semantic.classifyBySemantics(text);
      trace.semantic = semanticList;
      trace.decision = semanticList ? '规则层 + 语义层融合' : '语义层不可用，仅用规则层';
    } catch (err) {
      trace.semanticError = String((err && err.message) || err);
      trace.decision = '语义层加载失败，仅用规则层';
    }
  } else {
    trace.decision = '规则层证据充分，未启用语义层';
  }

  // ③ 融合
  const fusion = fuseScores(ruleResult, semanticList);
  trace.fusion = {
    ruleWeight: fusion.ruleWeight,
    semWeight: fusion.semWeight,
    fused: fusion.fused,
  };

  const fused = finalizeFusion(fusion, ruleResult);

  // ④ LLM 仲裁：只在证据冲突时触发
  const arbitrate = useLLMArbiter
    && typeof llmArbiter === 'function'
    && needsArbitration(fused);

  if (arbitrate) {
    trace.arbitrationRequested = true;
    try {
      const llmResult = await llmArbiter(text, {
        rule: ruleResult,
        semantic: semanticList,
        fused: fused.scores,
      });
      if (llmResult && llmResult.type && EVENT_TYPES[llmResult.type]) {
        trace.arbitration = { adopted: llmResult };
        return buildResult(fused, {
          layer: 'llm',
          arbitration: 'llm',
          ruleResult,
          trace,
          debug,
          override: {
            type: llmResult.type,
            intensity: typeof llmResult.intensity === 'number' ? llmResult.intensity : fused.intensity,
            confidence: typeof llmResult.confidence === 'number' ? llmResult.confidence : 0.8,
            target: llmResult.target || null,
          },
        });
      }
      trace.arbitration = { adopted: null, raw: llmResult };
    } catch (err) {
      trace.llmError = String((err && err.message) || err);
    }
  }

  return buildResult(fused, {
    layer: semanticList ? 'rule+semantic' : 'rule',
    arbitration: semanticList ? 'fused' : 'rule-only',
    ruleResult,
    trace,
    debug,
  });
}
