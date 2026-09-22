/**
 * @module api-adapter/adapters/deepseek
 * @description DeepSeek API 适配配置（基于 OpenAI 兼容格式）。
 */
import { openaiConfig } from './openai.js';

// DeepSeek 与 OpenAI 完全兼容，能力声明与 OpenAI 一致
export const deepseekConfig = {
  ...openaiConfig,
  id: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1/chat/completions',
  defaultModel: 'deepseek-chat',
  // 能力声明与 OpenAI 一致，但可微调范围
  capabilities: {
    temperature: { min: 0, max: 2, step: 0.1 },
    top_p: { min: 0, max: 1, step: 0.05 },
    frequency_penalty: { min: -2, max: 2, step: 0.1 },
    presence_penalty: { min: -2, max: 2, step: 0.1 },
  },
};