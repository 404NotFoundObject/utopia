/**
 * @module api-adapter/adapters/perplexity
 * @description Perplexity API 适配配置（基于 OpenAI 兼容格式）。
 */
import { openaiConfig } from './openai.js';

export const perplexityConfig = {
  ...openaiConfig,
  id: 'perplexity',
  baseUrl: 'https://api.perplexity.ai/chat/completions',
  defaultModel: 'llama-3.1-sonar-small-128k-online',
  capabilities: {
    temperature: { min: 0, max: 2, step: 0.1 },
    top_p: { min: 0, max: 1, step: 0.05 },
    top_k: { min: 0, max: 100, step: 1 },
    frequency_penalty: { min: -2, max: 2, step: 0.1 },
    presence_penalty: { min: -2, max: 2, step: 0.1 },
  },
};