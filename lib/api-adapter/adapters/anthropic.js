/**
 * @module api-adapter/adapters/anthropic
 * @description Anthropic Claude API 适配配置及辅助转换函数。
 *
 */

function toAnthropicContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content.map(block => {
    switch (block.type) {
      case 'text': return { type: 'text', text: block.text };
      case 'image':
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: block.source?.media_type || 'image/png',
            data: block.source?.data || '',
          },
        };
      case 'tool_use':
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      case 'tool_result':
        return { type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content || block.text };
      case 'thinking':
        return { type: 'thinking', thinking: block.thinking };
      default:
        return null;
    }
  }).filter(Boolean);
}

function fromAnthropicContent(content) {
  if (!Array.isArray(content)) return [];
  return content.map(block => {
    switch (block.type) {
      case 'text': return { type: 'text', text: block.text };
      case 'image':
        return { type: 'image', source: { media_type: block.source?.media_type, data: block.source?.data } };
      case 'tool_use':
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      case 'tool_result':
        return { type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content };
      case 'thinking':
        return { type: 'thinking', thinking: block.thinking };
      default:
        return null;
    }
  }).filter(Boolean);
}

function toAnthropicTools(stdTools) {
  return stdTools?.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

function toAnthropicToolChoice(tc) {
  if (!tc) return undefined;
  if (tc.type === 'specific') return { type: 'tool', name: tc.name };
  return { type: tc.type };
}

function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b && b.type === 'text')
      .map(b => b.text || '')
      .join('\n\n');
  }
  return '';
}

function streamEventMapper(vendorEvent) {
  const { type, ...rest } = vendorEvent;
  switch (type) {
    case 'message_start':
      return {
        id: rest.message?.id,
        model: rest.message?.model,
        created: Date.now(),
        choices: [{ index: 0, delta: { role: 'assistant' } }],
      };
    case 'content_block_start': {
      const block = rest.content_block;
      if (block?.type === 'text') {
        return {
          id: null, model: null, created: Date.now(),
          choices: [{ index: rest.index, delta: { content: block.text || '' } }],
        };
      } else if (block?.type === 'tool_use') {
        return {
          id: null, model: null, created: Date.now(),
          choices: [{
            index: rest.index,
            delta: {
              tool_calls: [{
                index: rest.index,
                id: block.id,
                function: { name: block.name || '', arguments: '' },
              }],
            },
          }],
        };
      }
      return null;
    }
    case 'content_block_delta': {
      const delta = rest.delta;
      if (delta?.type === 'text_delta') {
        return {
          id: null, model: null, created: Date.now(),
          choices: [{ index: rest.index, delta: { content: delta.text } }],
        };
      } else if (delta?.type === 'input_json_delta') {
        return {
          id: null, model: null, created: Date.now(),
          choices: [{
            index: rest.index,
            delta: {
              tool_calls: [{
                index: rest.index,
                function: { arguments: delta.partial_json },
              }],
            },
          }],
        };
      }
      return null;
    }
    case 'message_delta': {
      return {
        id: null, model: null, created: Date.now(),
        choices: [{ index: 0, finish_reason: rest.delta?.stop_reason }],
        usage: rest.usage ? {
          prompt_tokens: rest.usage.input_tokens,
          completion_tokens: rest.usage.output_tokens,
          total_tokens: rest.usage.input_tokens + rest.usage.output_tokens,
        } : undefined,
      };
    }
    case 'content_block_stop':
    case 'message_stop':
      return null;
    default:
      return null;
  }
}

export const anthropicConfig = {
  id: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1/messages',
  defaultModel: 'claude-3-5-sonnet-20241022',
  capabilities: {
    temperature: { min: 0, max: 1, step: 0.1 },
    top_p: { min: 0, max: 1, step: 0.05 },
    top_k: { min: 0, max: 500, step: 1 },
  },
  requestMapping: {
    model: 'model',

    system: {
      key: 'messages',
      transform: (stdMessages) => stdMessages
        .filter(m => m.role === 'system')
        .map(m => extractTextFromContent(m.content))
        .filter(Boolean)
        .join('\n\n'),
    },

    messages: {
      key: 'messages',
      transform: (stdMessages) => stdMessages
        .filter(m => m.role !== 'system')
        .map(msg => ({
          role: msg.role,
          content: toAnthropicContent(msg.content),
        })),
    },

    max_tokens: 'max_tokens',
    temperature: 'temperature',
    top_p: 'top_p',
    top_k: 'top_k',
    stop: 'stop_sequences',
    stream: 'stream',
    tools: { key: 'tools', transform: toAnthropicTools },
    tool_choice: { key: 'tool_choice', transform: toAnthropicToolChoice },
  },
  transformRequest: (vendorReq, standardReq) => {
    if (vendorReq.system === undefined) vendorReq.system = '';
    const model = standardReq.model || '';
    if (model.includes('claude-4') || model.startsWith('claude-4')) {
      delete vendorReq.temperature;
      delete vendorReq.top_p;
      delete vendorReq.top_k;
    }
    return vendorReq;
  },
  responseMapping: {
    id: 'id',
    model: 'model',
    created: 'created',
    choices: [{
      key: 'content',
      transform: (content, vendor) => ({
        index: 0,
        message: { role: 'assistant', content: fromAnthropicContent(content) },
        finish_reason: vendor.stop_reason,
      }),
    }],
    usage: {
      key: 'usage',
      transform: (usage) => usage ? {
        prompt_tokens: usage.input_tokens,
        completion_tokens: usage.output_tokens,
        total_tokens: usage.input_tokens + usage.output_tokens,
      } : undefined,
    },
    extra: (vendor) => ({ original: vendor }),
  },
  streamMapping: streamEventMapper,
};

export { toAnthropicContent, fromAnthropicContent };