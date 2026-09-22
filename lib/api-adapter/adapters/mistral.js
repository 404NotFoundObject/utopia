/**
 * @module api-adapter/adapters/mistral
 * @description Mistral API 适配配置（基于 OpenAI 兼容格式）。
 */
import { openaiConfig } from './openai.js';

export const mistralConfig = {
  ...openaiConfig,
  id: 'mistral',
  baseUrl: 'https://api.mistral.ai/v1/chat/completions',
  defaultModel: 'mistral-large-latest',
  capabilities: {
    temperature: { min: 0, max: 2, step: 0.1 },
    top_p: { min: 0, max: 1, step: 0.05 },
    top_k: { min: 0, max: 200, step: 1 },
    frequency_penalty: { min: 0, max: 2, step: 0.1 },
    presence_penalty: { min: 0, max: 2, step: 0.1 },
    repetition_penalty: { min: 1, max: 2, step: 0.05 },
  },
};