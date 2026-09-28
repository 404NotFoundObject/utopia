// js/modules/emotionSemantic.js - 情绪识别的语义层（原型句向量 kNN）
//
// 定位：规则层解决「结构」（否定、施事、受体），语义层解决「覆盖」——
// 字典永远列不全说法，但「你今天怎么这么讨厌」这类没被词表收录的表达
// 与 criticism 的原型句在向量空间里是接近的。
//
// 复用策略：不新建任何模型或依赖，直接复用 memory.js 已加载的
// paraphrase-multilingual-MiniLM-L12-v2（仓库内已内置，约 122MB）。
// 若记忆引擎的语义模型未就绪，本层静默降级返回 null，不影响规则层工作。
//
// 边界（重要）：语义相似度对否定天然不可靠 ——
// 「我爱你」与「我不爱你」的余弦相似度极高。因此本层**不参与否定判定**，
// 否定与第三方介入一律由规则层裁定，融合层不得让本层推翻。

import { EVENT_TYPES } from './emotionLexicon.js';
import { getMemoryEmbedder, isMemoryVectorReady } from './memory.js';

/** 低于该相似度视为「与任何类别都不像」 */
const MIN_SIMILARITY = 0.4;

/** 原型句向量缓存：type -> number[][] */
let prototypeVectors = null;
/** 扁平索引：与 prototypeVectors 对应的 {type, text} 列表 */
let prototypeIndex = null;
let buildingPromise = null;
let lastError = null;

/**
 * 收集全部原型句，去重后展平。
 * @returns {Array<{type: string, text: string}>}
 */
function collectPrototypes() {
  const seen = new Set();
  const list = [];
  for (const [type, def] of Object.entries(EVENT_TYPES)) {
    for (const text of def.prototypes || []) {
      const key = `${type}::${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ type, text });
    }
  }
  return list;
}

/**
 * 把一批文本编码为归一化向量。
 * 传入数组而非单条字符串，保证返回结构稳定为 [n, dim]。
 * @param {Function} embedder
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedTexts(embedder, texts) {
  const output = await embedder(texts, { pooling: 'mean', normalize: true });
  const list = typeof output.tolist === 'function' ? output.tolist() : output;
  return Array.isArray(list[0]) ? list : [list];
}

/**
 * 计算原型句向量并缓存。
 * @returns {Promise<boolean>} 是否成功
 */
async function ensurePrototypes() {
  if (prototypeVectors) return true;
  if (buildingPromise) return buildingPromise;

  buildingPromise = (async () => {
    try {
      const embedder = getMemoryEmbedder();
      if (!embedder || !isMemoryVectorReady()) {
        return false;
      }

      const index = collectPrototypes();
      if (index.length === 0) return false;

      const vectors = await embedTexts(embedder, index.map(p => p.text));

      prototypeIndex = index;
      prototypeVectors = vectors;
      lastError = null;
      console.log(`[EmotionSemantic] 原型句向量已就绪，共 ${index.length} 条`);
      return true;
    } catch (err) {
      lastError = err;
      console.warn('[EmotionSemantic] 原型句向量构建失败:', err);
      prototypeVectors = null;
      prototypeIndex = null;
      return false;
    } finally {
      buildingPromise = null;
    }
  })();

  return buildingPromise;
}

/**
 * 点积。原型与查询向量都已归一化，因此点积即余弦相似度。
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function dot(a, b) {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * 语义层是否可用（模型已就绪且原型句可用）。
 * @returns {boolean}
 */
export function isEmotionSemanticAvailable() {
  return Boolean(getMemoryEmbedder()) && isMemoryVectorReady();
}

/**
 * 语义引擎是否已完成原型句预热。
 * @returns {boolean}
 */
export function isEmotionSemanticReady() {
  return prototypeVectors !== null;
}

/**
 * 预加载原型句向量。可在应用启动后台调用，避免首条消息卡顿。
 * @returns {Promise<boolean>}
 */
export async function warmupEmotionSemantic() {
  if (!isEmotionSemanticAvailable()) return false;
  return ensurePrototypes();
}

/**
 * 清空缓存。切换语义模型时必须调用，否则新旧向量维度不一致。
 * @returns {void}
 */
export function resetEmotionSemanticCache() {
  prototypeVectors = null;
  prototypeIndex = null;
  buildingPromise = null;
  lastError = null;
}

/**
 * 诊断信息，供调试面板展示。
 * @returns {Object}
 */
export function getEmotionSemanticStatus() {
  return {
    available: isEmotionSemanticAvailable(),
    ready: isEmotionSemanticReady(),
    prototypeCount: prototypeIndex ? prototypeIndex.length : 0,
    categoryCount: prototypeIndex
      ? new Set(prototypeIndex.map(p => p.type)).size
      : 0,
    error: lastError ? String(lastError.message || lastError) : null,
  };
}

/**
 * 语义分类。
 *
 * 对每个类别取「与该类别所有原型句中最高的那个相似度」作为该类别的得分。
 * 取最大值而非均值：一个类别只要有一种说法被说到就足够，均值会被
 * 风格差异大的其他原型拉低。
 *
 * @param {string} text
 * @param {{topK?: number, minSimilarity?: number}} [opts]
 * @returns {Promise<Array<{type: string, score: number, prototype: string}>|null>}
 *          模型不可用或构建失败时返回 null，调用方据此跳过本层
 */
export async function classifyBySemantics(text, opts = {}) {
  const { topK = 5, minSimilarity = MIN_SIMILARITY } = opts;
  if (typeof text !== 'string' || !text.trim()) return null;
  if (!isEmotionSemanticAvailable()) return null;

  const ok = await ensurePrototypes();
  if (!ok || !prototypeVectors || !prototypeIndex) return null;

  try {
    const embedder = getMemoryEmbedder();
    const [queryVec] = await embedTexts(embedder, [text.trim()]);
    if (!queryVec) return null;

    const bestByType = new Map();
    for (let i = 0; i < prototypeIndex.length; i++) {
      const { type, text: protoText } = prototypeIndex[i];
      const sim = dot(queryVec, prototypeVectors[i]);
      const prev = bestByType.get(type);
      if (!prev || sim > prev.score) {
        bestByType.set(type, { type, score: sim, prototype: protoText });
      }
    }

    return [...bestByType.values()]
      .filter(item => item.score >= minSimilarity)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  } catch (err) {
    lastError = err;
    console.warn('[EmotionSemantic] 语义分类失败，跳过本层:', err);
    return null;
  }
}
