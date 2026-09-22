/**
 * @module api-adapter/adapters/openai
 * @description OpenAI (及兼容) API 适配配置及辅助转换函数。
 */

import { safeJsonParse } from '../utils.js';

/**
 * 将标准内容转换为 OpenAI 请求所需的 content 格式。
 * 纯文本直接返回字符串；多模态时返回数组；图片转为 `image_url` 格式。
 *
 * @param {string|Array<{type: string, [key: string]: any}>} content - 标准内容。
 * @returns {string|Array<{type: string, text?: string, image_url?: Object}>}
 */
function toOpenAIContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const blocks = content.map(block => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text || '' };
      case 'image':
        return {
          type: 'image_url',
          image_url: {
            url: block.source?.url || `data:${block.source?.media_type};base64,${block.source?.data}`,
          },
        };
      default:
        return null;
    }
  }).filter(Boolean);
  if (blocks.length === 1 && blocks[0].type === 'text') {
    return blocks[0].text;
  }
  return blocks;
}

/**
 * 将 OpenAI 响应的 content 和 tool_calls 合并为标准内容块数组。
 *
 * @param {string|Array} content - OpenAI 消息的 content。
 * @param {Array<{id: string, function: {name: string, arguments: string}}>} [toolCalls] - 工具调用数组。
 * @returns {Array<{type: string, text?: string, image?: Object, tool_use?: Object}>}
 */
function fromOpenAIContent(content, toolCalls) {
  const blocks = [];
  if (typeof content === 'string') {
    blocks.push({ type: 'text', text: content });
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === 'text') {
        blocks.push({ type: 'text', text: part.text });
      } else if (part.type === 'image_url') {
        blocks.push({
          type: 'image',
          source: { url: part.image_url?.url },
        });
      }
    }
  }
  if (toolCalls) {
    for (const tc of toolCalls) {
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: safeJsonParse(tc.function.arguments || '{}', {}),
      });
    }
  }
  return blocks;
}

/**
 * OpenAI 适配器配置对象
 */
export const openaiConfig = {
  id: 'openai',
  baseUrl: 'https://api.openai.com/v1/chat/completions',
  defaultModel: 'gpt-4o-mini',
  capabilities: {
    temperature: { min: 0, max: 2, step: 0.1 },
    top_p: { min: 0, max: 1, step: 0.05 },
    frequency_penalty: { min: -2, max: 2, step: 0.1 },
    presence_penalty: { min: -2, max: 2, step: 0.1 },
  },
  requestMapping: {
    model: 'model',
    messages: {
      key: 'messages',
      transform: (stdMessages) => stdMessages.map(msg => ({
        role: msg.role,
        content: toOpenAIContent(msg.content),
        name: msg.name,
        tool_call_id: msg.tool_call_id,
      })),
    },
    max_tokens: 'max_tokens',
    temperature: 'temperature',
    top_p: 'top_p',
    frequency_penalty: 'frequency_penalty',
    presence_penalty: 'presence_penalty',
    stop: 'stop',
    stream: 'stream',
    tools: {
      key: 'tools',
      transform: (stdTools) => stdTools?.map(tool => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      })),
    },
    tool_choice: {
      key: 'tool_choice',
      transform: (tc) => {
        if (!tc) return undefined;
        if (tc.type === 'specific') return { type: 'function', function: { name: tc.name } };
        return tc.type;
      },
    },
    response_format: 'response_format',
    seed: 'seed',
    logprobs: 'logprobs',
  },
  responseMapping: {
    id: 'id',
    model: 'model',
    created: 'created',
    choices: {
      key: 'choices',
      transform: (choices) => choices.map(choice => ({
        index: choice.index,
        message: {
          role: choice.message.role,
          content: fromOpenAIContent(choice.message.content, choice.message.tool_calls),
        },
        finish_reason: choice.finish_reason,
        logprobs: choice.logprobs,
      })),
    },
    usage: 'usage',
    system_fingerprint: 'system_fingerprint',
    extra: (vendor) => ({ original: vendor }),
  },
  streamMapping: {
    id: 'id',
    model: 'model',
    created: 'created',
    choices: {
      key: 'choices',
      transform: (choices) => choices?.map(choice => ({
        index: choice.index,
        delta: {
          role: choice.delta?.role,
          content: choice.delta?.content,
          tool_calls: choice.delta?.tool_calls?.map(tc => ({
            index: tc.index,
            id: tc.id,
            function: {
              name: tc.function?.name,
              arguments: tc.function?.arguments,
            },
          })),
        },
        finish_reason: choice.finish_reason,
      })),
    },
    usage: 'usage',
  },
};

export { toOpenAIContent, fromOpenAIContent };