/**
 * js/core/vectorMath.js 单测。
 *
 * 审计 P3-5：余弦相似度此前在 conversationState / memory / worldBook 各有一份，
 * 现收敛为唯一实现。这里锁定其边界行为，防止后续改动破坏任一调用方的语义。
 */
import { describe, it, expect, vi } from 'vitest';
import { cosineSimilarity } from '../../../js/core/vectorMath.js';

describe('core/vectorMath#cosineSimilarity', () => {
  it('相同向量 → 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 12);
  });

  it('正交向量 → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 12);
  });

  it('反向向量 → -1', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 12);
  });

  it('同向但模长不同 → 1（只关心方向）', () => {
    expect(cosineSimilarity([1, 1], [100, 100])).toBeCloseTo(1, 12);
  });

  it('零向量 → 0（避免除零）', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
  });

  it('null / undefined 入参 → 0', () => {
    expect(cosineSimilarity(null, [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], undefined)).toBe(0);
  });

  it('维度不一致 → 0，且默认静默', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('维度不一致时回调 onMismatch，并带上两侧长度', () => {
    const onMismatch = vi.fn();
    expect(cosineSimilarity([1, 2, 3], [1, 2], onMismatch)).toBe(0);
    expect(onMismatch).toHaveBeenCalledTimes(1);
    expect(onMismatch).toHaveBeenCalledWith(3, 2);
  });

  it('维度一致时不触发 onMismatch', () => {
    const onMismatch = vi.fn();
    cosineSimilarity([1, 2], [2, 1], onMismatch);
    expect(onMismatch).not.toHaveBeenCalled();
  });

  it('空数组 → 0（模长为 0 的分支）', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});
