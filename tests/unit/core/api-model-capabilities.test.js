/**
 * js/core/api.js · getModelCapabilities 单元测试。
 *
 * 覆盖审计报告 P2-14 的修复：
 *  - 原硬编码正则只认 o[134] 与 claude-4，漏掉新推理模型 / 带版本号变体 → 发 sampling 参数 → 400
 *  - 现在覆盖 o 系列、deepseek reasoner/r1、qwen/qwq、glm reasoning、gpt-5、claude 3.7+/4 等
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../js/core/db.js', () => ({
  getStores: vi.fn(async () => ({ settings: { get: async () => ({}) } })),
}));

vi.mock('../../../js/core/runtimeParams.js', () => ({
  getEffectiveParams: vi.fn(() => ({})),
}));

import { getModelCapabilities, buildGoogleStreamUrl } from '../../../js/core/api.js';

describe('core/api · getModelCapabilities（审计 P2-14）', () => {
  it('普通模型保留全部采样参数', () => {
    const caps = getModelCapabilities('gpt-4o');
    expect(caps.temperature).toBe(true);
    expect(caps.top_p).toBe(true);
    expect(caps.top_k).toBe(true);
    expect(caps.frequency_penalty).toBe(true);
  });

  it('OpenAI o 系列推理模型禁用采样参数', () => {
    for (const m of ['o1', 'o3', 'o4', 'o4-mini']) {
      const caps = getModelCapabilities(m);
      expect(caps.temperature, m).toBe(false);
      expect(caps.top_p, m).toBe(false);
      expect(caps.top_k, m).toBe(false);
    }
  });

  it('带版本号/日期后缀的 o 系列变体也被识别（审计 P2-14 核心）', () => {
    const caps = getModelCapabilities('o4-mini-2026-10-01');
    expect(caps.temperature).toBe(false);
    expect(caps.top_p).toBe(false);
  });

  it('DeepSeek reasoner / r1 禁用采样参数', () => {
    for (const m of ['deepseek-reasoner', 'deepseek-r1', 'deepseek_reasoner']) {
      const caps = getModelCapabilities(m);
      expect(caps.temperature, m).toBe(false);
    }
  });

  it('Qwen qwq / GLM reasoning 禁用采样参数', () => {
    expect(getModelCapabilities('qwen-qwq').temperature).toBe(false);
    expect(getModelCapabilities('qwq-32b').temperature).toBe(false);
    expect(getModelCapabilities('glm-4-reasoning').temperature).toBe(false);
  });

  it('qwen-max 等非推理模型不误判（保持采样参数）', () => {
    // 回归：原正则 qwen[0-9.]*[-_.]?(?:qwq|max|thinking) 会误伤 qwen-max /
    // qwen2.5-max（它们接受 temperature），导致采样参数被静默剥离、文风改变。
    for (const m of ['qwen-max', 'qwen2.5-max', 'qwen-plus', 'qwen-turbo']) {
      expect(getModelCapabilities(m).temperature, m).toBe(true);
    }
  });

  it('claude 3.7 / 4 系列禁用采样参数', () => {
    expect(getModelCapabilities('claude-4-sonnet').temperature).toBe(false);
    expect(getModelCapabilities('claude-3-7-sonnet').temperature).toBe(false);
  });

  it('gpt-5 禁用采样参数', () => {
    expect(getModelCapabilities('gpt-5').temperature).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(getModelCapabilities('DeepSeek-R1').temperature).toBe(false);
  });
});

describe('core/api · buildGoogleStreamUrl（审计 B-2）', () => {
  it('标准 generateContent URL 替换为 streamGenerateContent 并补 alt=sse', () => {
    const out = buildGoogleStreamUrl('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent');
    expect(out).toContain(':streamGenerateContent');
    expect(out).toContain('alt=sse');
  });

  it('自定义 baseUrl 已含 :streamGenerateContent 仍补 alt=sse（回归核心）', () => {
    const out = buildGoogleStreamUrl('https://custom.example.com/v1/models/x:streamGenerateContent');
    expect(out).toContain('alt=sse');
    expect(out).toContain(':streamGenerateContent');
  });

  it('已带 alt= 参数时不再重复追加', () => {
    const out = buildGoogleStreamUrl('https://example.com/x:generateContent?alt=json');
    expect(out).toBe('https://example.com/x:streamGenerateContent?alt=json');
    expect((out.match(/alt=/g) || []).length).toBe(1);
  });
});
