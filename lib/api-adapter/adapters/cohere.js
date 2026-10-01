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
  // 响应方向归一：把 text 内的 choices 提升为顶层 choices，供 api.js 读取
  transformResponse: (standardResp, vendorResp) => {
    if (standardResp.text && Array.isArray(standardResp.text.choices)) {
      standardResp.choices = standardResp.text.choices;
    }
    delete standardResp.text;
    return standardResp;
  },
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
  streamMapping: (vendorChunk, sseEvent) => {
    const eventType = (sseEvent && sseEvent.event) || '';

    // Cohere v2 流式：命名事件 content-delta / message-end / tool-call-*。
    // 审计 P2-17：原实现只处理 v1 的 event_type=text-generation，v2 事件被丢弃。
    if (eventType === 'content-delta' || vendorChunk.type === 'content-delta') {
      const delta = vendorChunk.delta;
      const text = delta && typeof delta.message === 'object'
        ? (delta.message.content?.text ?? '')
        : (typeof delta === 'string' ? delta : '');
      if (text) {
        return { choices: [{ delta: { content: text } }] };
      }
      return null;
    }

    if (eventType === 'message-end' || vendorChunk.type === 'message-end') {
      // v2 结束事件：可携带 usage，转换为 usage 块（无内容 delta）
      if (vendorChunk.delta && vendorChunk.delta.usage) {
        return { usage: vendorChunk.delta.usage, choices: [] };
      }
      return null;
    }

    if (eventType === 'message-start' || vendorChunk.type === 'message-start') {
      // v2 开始事件：携带 message id 等元信息，无内容 delta
      return null;
    }

    // tool-call-* 命名事件：结构化工具调用，非文本内容，暂透传为原始块供上层处理
    if (eventType.startsWith('tool-call-') || (vendorChunk.type && String(vendorChunk.type).startsWith('tool-call-'))) {
      return { toolCall: vendorChunk, choices: [] };
    }

    // Cohere v1 流式：event_type === 'text-generation'
    if (vendorChunk.event_type === 'text-generation') {
      return {
        choices: [{ delta: { content: vendorChunk.text } }],
      };
    }
    return null;
  },
};