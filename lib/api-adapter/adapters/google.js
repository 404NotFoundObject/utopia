/**
 * @module api-adapter/adapters/google
 * @description Google Gemini API 适配配置。
 * Gemini 参数放在 generationConfig 中，消息格式为 role + parts。
 */

/**
 * 将标准消息转换为 Gemini 格式
 */
function toGeminiMessages(stdMessages) {
  return stdMessages
    .filter(m => m.role !== 'system')
    .map(msg => ({
      role: msg.role === 'assistant' ? 'model' : msg.role,
      parts: [{ text: typeof msg.content === 'string' ? msg.content : '' }],
    }));
}

export const googleConfig = {
  id: 'google',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
  defaultModel: 'gemini-1.5-flash',
  capabilities: {
    temperature: { min: 0, max: 2, step: 0.1 },
    top_p: { min: 0, max: 1, step: 0.05 },
    top_k: { min: 1, max: 40, step: 1 },
  },
  requestMapping: {
    model: 'model',

    systemInstruction: {
      key: 'messages',
      transform: (stdMessages) => {
        const text = stdMessages
          .filter(m => m.role === 'system')
          .map(m => typeof m.content === 'string' ? m.content : '')
          .filter(Boolean)
          .join('\n\n');
        if (!text) return undefined;
        return { parts: [{ text }] };
      },
    },

    contents: {
      key: 'messages',
      transform: (stdMessages) => toGeminiMessages(stdMessages),
    },

    generationConfig: (stdReq) => {
      const cfg = {};
      if (typeof stdReq.temperature === 'number') cfg.temperature = stdReq.temperature;
      if (typeof stdReq.top_p === 'number') cfg.topP = stdReq.top_p;
      if (typeof stdReq.top_k === 'number') cfg.topK = stdReq.top_k;
      if (typeof stdReq.max_tokens === 'number') cfg.maxOutputTokens = stdReq.max_tokens;
      return cfg;
    },

    stream: 'stream',
  },
  transformRequest: (vendorReq, standardReq) => {
    // Gemini 用 URL 路径决定 model，不在 body 里
    delete vendorReq.model;
    return vendorReq;
  },
  responseMapping: {
    candidates: {
      key: 'candidates',
      transform: (candidates) => candidates.map(c => ({
        index: 0,
        message: {
          role: 'assistant',
          content: c.content?.parts?.map(p => p.text).join('') || '',
        },
        finish_reason: c.finishReason,
      })),
    },
    usageMetadata: {
      key: 'usageMetadata',
      transform: (usage) => usage ? {
        prompt_tokens: usage.promptTokenCount,
        completion_tokens: usage.candidatesTokenCount,
        total_tokens: usage.totalTokenCount,
      } : undefined,
    },
    extra: (vendor) => ({ original: vendor }),
  },
  streamMapping: (vendorChunk) => {
    const candidates = vendorChunk.candidates;
    if (!candidates || candidates.length === 0) return null;
    const content = candidates[0].content?.parts?.[0]?.text;
    if (content) {
      return {
        choices: [{ index: 0, delta: { content } }],
      };
    }
    return null;
  },
};