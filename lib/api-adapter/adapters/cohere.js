/**
 * @module api-adapter/adapters/cohere
 * @description Cohere API 适配配置。
 * Cohere 使用 chat 端点，参数与 OpenAI 略有差异。
 *
 */

export const cohereConfig = {
  id: 'cohere',
  baseUrl: 'https://api.cohere.ai/v1/chat',
  defaultModel: 'command-r-plus',
  capabilities: {
    temperature: { min: 0, max: 5, step: 0.1 },
    top_p: { min: 0, max: 1, step: 0.05 },
    top_k: { min: 0, max: 500, step: 1 },
    frequency_penalty: { min: 0, max: 1, step: 0.1 },
    presence_penalty: { min: 0, max: 1, step: 0.1 },
    repetition_penalty: { min: 1, max: 2, step: 0.05 },
  },
  requestMapping: {
    model: 'model',

    preamble: {
      key: 'messages',
      transform: (stdMessages) => {
        const text = stdMessages
          .filter(m => m.role === 'system')
          .map(m => typeof m.content === 'string' ? m.content : '')
          .filter(Boolean)
          .join('\n\n');
        return text || undefined;
      },
    },

    chat_history: {
      key: 'messages',
      transform: (stdMessages) => stdMessages
        .filter(m => m.role !== 'system')
        .slice(0, -1)
        .map(m => ({
          role: m.role === 'user' ? 'USER' : 'CHATBOT',
          message: typeof m.content === 'string' ? m.content : '',
        })),
    },

    message: {
      key: 'messages',
      transform: (stdMessages) => {
        const nonSystem = stdMessages.filter(m => m.role !== 'system');
        const last = nonSystem[nonSystem.length - 1];
        return (last && typeof last.content === 'string') ? last.content : '';
      },
    },

    max_tokens: 'max_tokens',
    temperature: 'temperature',
    top_p: 'top_p',
    top_k: 'top_k',
    frequency_penalty: 'frequency_penalty',
    presence_penalty: 'presence_penalty',
    repetition_penalty: 'repetition_penalty',
    stream: 'stream',
    stop: 'stop_sequences',
  },
  transformRequest: (vendorReq) => vendorReq,
  responseMapping: {
    id: 'id',
    model: 'model',
    text: {
      key: 'text',
      transform: (text) => ({
        choices: [{ message: { role: 'assistant', content: text } }],
      }),
    },
    usage: {
      key: 'meta',
      transform: (meta) => meta?.billed_units ? {
        prompt_tokens: meta.billed_units.input_tokens,
        completion_tokens: meta.billed_units.output_tokens,
        total_tokens: meta.billed_units.input_tokens + meta.billed_units.output_tokens,
      } : undefined,
    },
    extra: (vendor) => ({ original: vendor }),
  },
  streamMapping: (vendorChunk) => {
    if (vendorChunk.event_type === 'text-generation') {
      return {
        choices: [{ delta: { content: vendorChunk.text } }],
      };
    }
    return null;
  },
};