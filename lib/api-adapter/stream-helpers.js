/**
 * @module api-adapter/stream-helpers
 * @description 流式响应辅助工具，用于聚合流块和生成续写请求。
 */

import { safeJsonParse } from './utils.js';

/**
 * 将一组标准流块聚合为完整的 assistant 消息对象。
 * 支持文本内容拼接、工具调用拼接，最终 content 字段可能为字符串或混合内容数组。
 *
 * @param {Object[]} chunks - 标准流块数组，每个块需符合 `choices[0].delta` 结构。
 * @returns {{ role: string, content: string|Array<{type: string, text?: string, tool_use?: Object}> }} 聚合后的消息。
 *
 * @example
 * const message = aggregateChunks(streamedChunks);
 * // message.role 为 'assistant'
 * // message.content 为文本或包含 tool_use 的混合数组
 */
function aggregateChunks(chunks) {
  const message = { role: 'assistant', content: '' };
  const toolCallsMap = new Map();

  for (const chunk of chunks) {
    const choices = chunk.choices;
    if (!choices || choices.length === 0) continue;
    const delta = choices[0].delta;
    if (!delta) continue;
    if (delta.role) message.role = delta.role;
    if (delta.content) message.content += delta.content;
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        if (!toolCallsMap.has(idx)) {
          toolCallsMap.set(idx, {
            id: tc.id,
            type: 'function',
            function: { name: '', arguments: '' },
          });
        }
        const existing = toolCallsMap.get(idx);
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
      }
    }
  }

  if (toolCallsMap.size > 0) {
    const blocks = [];
    if (message.content) {
      blocks.push({ type: 'text', text: message.content });
    }
    for (const tc of toolCallsMap.values()) {
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: safeJsonParse(tc.function.arguments || '{}', {}),
      });
    }
    message.content = blocks;
  }
  return message;
}

/**
 * 基于原始请求和已接收的流块，构造一个用于继续对话的新请求。
 * 通常用于工具调用后需要继续生成文本的场景。
 *
 * @param {Object} originalRequest - 原始标准请求对象，必须包含 `messages` 数组。
 * @param {Object[]} receivedChunks - 已接收的流块数组，将被聚合为一条 assistant 消息追加到请求中。
 * @returns {Object} 新的请求对象，包含原始请求的所有字段，`messages` 数组末尾增加了一条 assistant 消息，且 `stream: true` 被强制设置。
 * @throws {Error} 如果 `originalRequest.messages` 不存在或 `receivedChunks` 为空。
 *
 * @example
 * const newReq = createContinueRequest(originalReq, receivedChunks);
 * // 用 newReq 重新发起请求继续生成
 */
function createContinueRequest(originalRequest, receivedChunks) {
  if (!originalRequest || !Array.isArray(originalRequest.messages)) {
    throw new Error('[StreamHelper] originalRequest 必须包含 messages 数组');
  }
  if (!receivedChunks || receivedChunks.length === 0) {
    throw new Error('[StreamHelper] receivedChunks 不能为空');
  }
  const assistantMessage = aggregateChunks(receivedChunks);
  return {
    ...originalRequest,
    messages: [...originalRequest.messages, assistantMessage],
    stream: true,
  };
}

export { aggregateChunks, createContinueRequest };