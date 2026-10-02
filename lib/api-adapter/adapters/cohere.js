/**
 * @module api-adapter/adapters/cohere
 * @description Cohere API 适配配置（v2）。
 * Cohere Chat v2 端点 /v2/chat，使用单一 messages 数组（role/content），
 * 流式为 SSE 命名事件（message-start / content-delta / content-end / message-end）。
 *
 */

export const cohereConfig = {
  id: 'cohere',
  baseUrl: 'https://api.cohere.ai/v2/chat',
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

    // v2：单一 messages 数组，所有角色（含 system）都进同一列表。
    // system → role: 'system'；历史与当前消息按 role 直映射（chatbot 已改名 assistant）。
    messages: {
      key: 'messages',
      transform: (stdMessages) => stdMessages
        .map(m => ({
          role: m.role === 'system' ? 'system'
            : m.role === 'assistant' ? 'assistant'
            : m.role === 'tool' ? 'tool'
            : 'user',
          content: typeof m.content === 'string' ? m.content : '',
        })),
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
  // 响应方向归一：v2 非流式响应文本在 message.content[0].text，
  // 提升为顶层 choices 供 api.js 读取。
  transformResponse: (standardResp, vendorResp) => {
    const content = vendorResp?.message?.content;
    const text = Array.isArray(content)
      ? content.map(c => c?.text ?? '').join('')
      : (typeof content === 'string' ? content : '');
    if (text) {
      standardResp.choices = [{ message: { role: 'assistant', content: text } }];
    } else if (standardResp.text) {
      // 兼容仍返回 text 字段的旧响应
      standardResp.choices = standardResp.text.choices;
    }
    delete standardResp.text;
    return standardResp;
  },
  responseMapping: {
    id: 'id',
    model: 'model',
    text: {
      key: 'message',
      transform: (message) => {
        const content = message?.content;
        const text = Array.isArray(content)
          ? content.map(c => c?.text ?? '').join('')
          : (typeof content === 'string' ? content : '');
        return { choices: [{ message: { role: 'assistant', content: text } }] };
      },
    },
    usage: {
      key: 'meta',
      transform: (meta) => meta?.billed_units ? {
        prompt_tokens: meta.billed_units.input_tokens,
        completion_tokens: meta.billed_units.output_tokens,
        total_tokens: meta.billed_units.input_tokens + meta.billed_units.output_tokens,
      } : (meta?.tokens ? {
        prompt_tokens: meta.tokens.input_tokens ?? 0,
        completion_tokens: meta.tokens.output_tokens ?? 0,
        total_tokens: (meta.tokens.input_tokens ?? 0) + (meta.tokens.output_tokens ?? 0),
      } : undefined),
    },
    extra: (vendor) => ({ original: vendor }),
  },
  streamMapping: (vendorChunk, sseEvent) => {
    const eventType = (sseEvent && sseEvent.event) || '';
    const chunkType = vendorChunk && vendorChunk.type;

    // Cohere v2 流式：命名事件 content-delta / message-end / tool-call-*。
    if (eventType === 'content-delta' || chunkType === 'content-delta') {
      const delta = vendorChunk.delta;
      const text = delta && typeof delta.message === 'object'
        ? (delta.message.content?.text ?? '')
        : (typeof delta === 'string' ? delta : '');
      if (text) {
        return { choices: [{ delta: { content: text } }] };
      }
      return null;
    }

    if (eventType === 'message-end' || chunkType === 'message-end') {
      // v2 结束事件：可携带 usage，转换为 usage 块（无内容 delta）
      if (vendorChunk.delta && vendorChunk.delta.usage) {
        return { usage: vendorChunk.delta.usage, choices: [] };
      }
      return null;
    }

    if (eventType === 'message-start' || chunkType === 'message-start') {
      // v2 开始事件：携带 message id 等元信息，无内容 delta
      return null;
    }

    // tool-call-* 命名事件：结构化工具调用，非文本内容，暂透传为原始块供上层处理
    if (eventType.startsWith('tool-call-') || (chunkType && String(chunkType).startsWith('tool-call-'))) {
      return { toolCall: vendorChunk, choices: [] };
    }

    // 兜底：v1 遗留的 text-generation（若用户仍指向 v1 端点）
    if (vendorChunk.event_type === 'text-generation') {
      return {
        choices: [{ delta: { content: vendorChunk.text } }],
      };
    }
    return null;
  },
};