/**
 * @module api-adapter/adapters/xai
 * @description xAI (Grok) API 适配配置（基于 OpenAI 兼容格式）。
 */
import { openaiConfig } from './openai.js';

export const xaiConfig = {
  ...openaiConfig,
  id: 'xai',
  baseUrl: 'https://api.x.ai/v1/chat/completions',
  defaultModel: 'grok-1.5',
  capabilities: {
    temperature: { min: 0, max: 2, step: 0.1 },
    top_p: { min: 0, max: 1, step: 0.05 },
    top_k: { min: 0, max: 200, step: 1 },
    frequency_penalty: { min: -2, max: 2, step: 0.1 },
    presence_penalty: { min: -2, max: 2, step: 0.1 },
  },
};