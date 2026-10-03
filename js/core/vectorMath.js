// js/core/vectorMath.js - 向量数学工具
//
// 审计 P3-5：余弦相似度曾在 conversationState.js / memory.js / worldBook.js
// 各有一份逐行相同的实现，任一处修复浮点/维度问题都要改三遍。此模块为唯一实现。

/**
 * 计算两个等长数值数组的余弦相似度。
 *
 * 边界行为（与历史三份实现保持一致）：
 *   - 任一参数为空或长度不一致 → 返回 0
 *   - 任一向量模长为 0 → 返回 0
 *
 * @param {number[]} a - 向量 A。
 * @param {number[]} b - 向量 B。
 * @param {(lenA: number, lenB: number) => void} [onMismatch] - 维度不一致时的回调，
 *   供调用方按自己的日志前缀告警（默认静默）。
 * @returns {number} 相似度，范围 [-1, 1]；无效输入返回 0。
 */
export function cosineSimilarity(a, b, onMismatch) {
  if (!a || !b) return 0;
  if (a.length !== b.length) {
    if (typeof onMismatch === 'function') onMismatch(a.length, b.length);
    return 0;
  }
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
