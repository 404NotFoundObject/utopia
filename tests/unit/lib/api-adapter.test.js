/**
 * lib/api-adapter 单元测试：SSE CRLF 解析、响应方向归一、safeJsonParse。
 *
 * 覆盖审计报告 P0-2 / P0-6 / P2-11 的修复：
 *  - sse-parser 剥离行尾 CR，避免 data 值残留 \r 导致 JSON.parse 失败
 *  - google/cohere 适配器 transformResponse 把 candidates/text 归一为顶层 choices
 *  - safeJsonParse 字符串解析失败时返回 fallback（而非 __parse_error 对象）
 */
import { describe, it, expect } from 'vitest';
import { createSSEParser } from '../../../lib/api-adapter/sse-parser.js';
import { createAdapter } from '../../../lib/api-adapter/createAdapter.js';
import { googleConfig } from '../../../lib/api-adapter/adapters/google.js';
import { cohereConfig } from '../../../lib/api-adapter/adapters/cohere.js';
import { safeJsonParse } from '../../../lib/api-adapter/utils.js';

/** 把字符串编码为 Uint8Array 异步可迭代流 */
async function* bytesOf(str) {
  yield new TextEncoder().encode(str);
}

async function collect(byteStream) {
  const parser = createSSEParser();
  const events = [];
  for await (const ev of parser(byteStream)) events.push(ev);
  return events;
}

describe('lib/api-adapter/sse-parser', () => {
  it('LF 换行正常解析 data', async () => {
    const events = await collect(bytesOf('data: {"a":1}\n\n'));
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].data)).toEqual({ a: 1 });
  });

  it('CRLF 换行不残留 \\r，data 可被 JSON.parse', async () => {
    const events = await collect(bytesOf('data: {"a":1}\r\n\r\n'));
    expect(events).toHaveLength(1);
    // 关键：旧实现会残留 \r，导致 JSON.parse 抛错
    expect(() => JSON.parse(events[0].data)).not.toThrow();
    expect(JSON.parse(events[0].data)).toEqual({ a: 1 });
  });

  it('多行 data 以换行拼接，且各行均剥 CR', async () => {
    const events = await collect(bytesOf('data: line1\r\ndata: line2\r\n\r\n'));
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('line1\nline2');
  });

  it('event 字段也剥 CR', async () => {
    const events = await collect(bytesOf('event: foo\r\ndata: x\r\n\r\n'));
    expect(events[0].event).toBe('foo');
  });

  it('[DONE] 终止流', async () => {
    const events = await collect(bytesOf('data: {"a":1}\n\ndata: [DONE]\n\n'));
    expect(events).toHaveLength(1);
  });
});

describe('lib/api-adapter/adapters · 非流式响应归一', () => {
  it('google 响应 candidates 归一为顶层 choices', () => {
    const adapter = createAdapter(googleConfig);
    const vendorResp = {
      candidates: [{ content: { parts: [{ text: '你好' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
    };
    const std = adapter.adaptResponse(vendorResp);
    expect(Array.isArray(std.choices)).toBe(true);
    expect(std.choices[0].message.content).toBe('你好');
    expect(std.candidates).toBeUndefined();
  });

  it('cohere 响应 text.choices 提升为顶层 choices', () => {
    const adapter = createAdapter(cohereConfig);
    const vendorResp = { text: '你好', meta: null };
    const std = adapter.adaptResponse(vendorResp);
    expect(Array.isArray(std.choices)).toBe(true);
    expect(std.choices[0].message.content).toBe('你好');
    expect(std.text).toBeUndefined();
  });

  it('google 请求体剔除 stream 字段', () => {
    const adapter = createAdapter(googleConfig);
    const req = adapter.adaptRequest({ model: 'x', messages: [], stream: true });
    expect(req.stream).toBeUndefined();
    expect(req.model).toBeUndefined();
  });

  it('cohere v1 流式 text-generation 映射为 delta', () => {
    const adapter = createAdapter(cohereConfig);
    const chunk = adapter.adaptStreamChunk({ event_type: 'text-generation', text: '你好' });
    expect(chunk.choices[0].delta.content).toBe('你好');
  });

  it('cohere v2 命名事件 content-delta 映射为 delta（审计 P2-17）', () => {
    const adapter = createAdapter(cohereConfig);
    const chunk = adapter.adaptStreamChunk(
      { type: 'content-delta', delta: { message: { content: { text: '你好' } } } },
      { event: 'content-delta' }
    );
    expect(chunk.choices[0].delta.content).toBe('你好');
  });

  it('cohere v2 message-end 携带 usage 且无内容 delta', () => {
    const adapter = createAdapter(cohereConfig);
    const chunk = adapter.adaptStreamChunk(
      { type: 'message-end', delta: { usage: { input_tokens: 10, output_tokens: 5 } } },
      { event: 'message-end' }
    );
    expect(chunk.usage).toBeDefined();
    expect(chunk.choices).toEqual([]);
  });

  it('cohere v2 tool-call 命名事件透传为 toolCall 块', () => {
    const adapter = createAdapter(cohereConfig);
    const chunk = adapter.adaptStreamChunk(
      { type: 'tool-call-start', id: 'tc1' },
      { event: 'tool-call-start' }
    );
    expect(chunk.toolCall).toBeDefined();
    expect(chunk.choices).toEqual([]);
  });
});

describe('lib/api-adapter/utils · safeJsonParse', () => {
  it('合法 JSON 正常解析', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it('非法字符串返回 fallback（而非 __parse_error 对象）', () => {
    const result = safeJsonParse('not json', {});
    expect(result).toEqual({});
    expect(result.__parse_error).toBeUndefined();
  });

  it('非法字符串返回自定义 fallback', () => {
    expect(safeJsonParse('not json', null)).toBeNull();
  });

  it('非字符串输入直接返回 fallback', () => {
    expect(safeJsonParse(123, 'x')).toBe('x');
    expect(safeJsonParse(undefined, 'x')).toBe('x');
  });
});
