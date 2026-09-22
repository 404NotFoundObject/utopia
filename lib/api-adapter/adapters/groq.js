/**
 * @module api-adapter/adapters/groq
 * @description Groq API 适配配置（基于 OpenAI 兼容格式）。
 */
import { openaiConfig } from './openai.js';

export const groqConfig = {
  ...openaiConfig,
  id: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
  defaultModel: 'llama3-70b-8192',
  capabilities: {
    temperature: { min: 0, max: 2, step: 0.1 },
    top_p: { min: 0, max: 1, step: 0.05 },
    frequency_penalty: { min: -2, max: 2, step: 0.1 },
    presence_penalty: { min: -2, max: 2, step: 0.1 },
  },
};