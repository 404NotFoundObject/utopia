/**
 * @module api-adapter
 * @description 统一 API 适配器入口，聚合所有厂商配置。
 */

console.log('Utopia工具 API 适配器 加载中...');

import { createAdapter } from './createAdapter.js';
import { openaiConfig } from './adapters/openai.js';
import { anthropicConfig } from './adapters/anthropic.js';
import { googleConfig } from './adapters/google.js';
import { cohereConfig } from './adapters/cohere.js';
import { deepseekConfig } from './adapters/deepseek.js';
import { mistralConfig } from './adapters/mistral.js';
import { groqConfig } from './adapters/groq.js';
import { perplexityConfig } from './adapters/perplexity.js';
import { xaiConfig } from './adapters/xai.js';
import { aggregateChunks, createContinueRequest } from './stream-helpers.js';

console.log('Utopia工具 API 适配器 已加载');

// ★★★ 适配器配置映射表（包含 baseUrl 和 defaultModel） ★★★
export const adapterConfigs = {
  openai: openaiConfig,
  anthropic: anthropicConfig,
  google: googleConfig,
  cohere: cohereConfig,
  deepseek: deepseekConfig,
  mistral: mistralConfig,
  groq: groqConfig,
  perplexity: perplexityConfig,
  xai: xaiConfig,
};

export {
  createAdapter,
  openaiConfig,
  anthropicConfig,
  googleConfig,
  cohereConfig,
  deepseekConfig,
  mistralConfig,
  groqConfig,
  perplexityConfig,
  xaiConfig,
  aggregateChunks,
  createContinueRequest,
};