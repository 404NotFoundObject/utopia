/**
 * @module api-adapter/sse-parser
 * @description 一个轻量级的 SSE (Server-Sent Events) 解析器，可将字节流转换为结构化事件。
 *
 */

const MAX_BUFFER_SIZE = 1024 * 1024;   // 1MB
// 按 CRLF / CR / LF 三种换行符切分。CRLF 下 'data: x\r\n\r\n' 若只按 '\n' 切，
// 分隔行会变成 '\r' 而非 ''，导致空行判断永不成立、事件被错误拼进下一个块。
const LINE_SPLIT = /\r\n|\r|\n/;

/**
 * 创建一个 SSE 解析器，返回一个异步生成器，逐条产出解析后的事件。
 *
 * @returns {(byteStream: AsyncIterable<Uint8Array>) => AsyncGenerator<{event: string, data: string, id?: string, retry?: number}>}
 */
function createSSEParser() {
  return async function* (byteStream) {
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = { data: '' };

    const processLine = (line) => {
      // 行尾 CR 已在切分阶段剥离，这里不再处理
      // 忽略注释行
      if (line.startsWith(':')) return;
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) return; // 无效行，忽略
      const field = line.substring(0, colonIndex);
      let value = line.substring(colonIndex + 1);
      if (value.startsWith(' ')) value = value.substring(1);

      switch (field) {
        case 'data':
          currentEvent.data += (currentEvent.data ? '\n' : '') + value;
          break;
        case 'event':
          currentEvent.event = value;
          break;
        case 'id':
          currentEvent.id = value;
          break;
        case 'retry':
          currentEvent.retry = parseInt(value, 10);
          break;
      }
    };

    for await (const chunk of byteStream) {
      const text = decoder.decode(chunk, { stream: true });
      buffer += text;

      if (buffer.length > MAX_BUFFER_SIZE) {
        console.warn('[SSEParser] buffer 超限，主动 flush 已累积数据');
        // 超限：无完整事件边界可依赖，把整个 buffer 按行处理并主动 flush
        const lines = buffer.split(LINE_SPLIT);
        buffer = '';
        for (const line of lines) {
          if (line === '') {
            if (currentEvent.data) {
              if (currentEvent.data.trim() === '[DONE]') return;
              yield {
                event: currentEvent.event || 'message',
                data: currentEvent.data,
                id: currentEvent.id,
                retry: currentEvent.retry,
              };
              currentEvent = { data: '' };
            }
          } else {
            processLine(line);
          }
        }
        // 残留未 yield 的 data 主动 flush（超限场景下无法等待空行）
        if (currentEvent.data) {
          if (currentEvent.data.trim() === '[DONE]') return;
          yield {
            event: currentEvent.event || 'message',
            data: currentEvent.data,
            id: currentEvent.id,
            retry: currentEvent.retry,
          };
          currentEvent = { data: '' };
        }
        continue;
      }

      // 按 CRLF / CR / LF 三种换行符切分。
      // 关键：CRLF 下 'data: x\r\n\r\n' 若只按 '\n' 切，分隔行是 '\r' 而非 ''，
      // 导致空行判断永不成立、事件被拼进下一个块。这里统一切分后 '\r\n' 与 '\r'
      // 均被消除，空行就是真正的 ''，事件边界正确分发。
      const lines = buffer.split(LINE_SPLIT);
      // 最后一段可能是未完整的一行（含半个 \r\n 或半个 UTF-8 序列），留待下个 chunk
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line === '') {
          // 空行触发事件分发
          if (currentEvent.data) {
            if (currentEvent.data.trim() === '[DONE]') return;
            yield {
              event: currentEvent.event || 'message',
              data: currentEvent.data,
              id: currentEvent.id,
              retry: currentEvent.retry,
            };
            currentEvent = { data: '' };
          }
        } else {
          processLine(line);
        }
      }
    }

    // 处理流结束后的剩余 buffer
    if (buffer) processLine(buffer);
    if (currentEvent.data && currentEvent.data.trim() !== '[DONE]') {
      yield {
        event: currentEvent.event || 'message',
        data: currentEvent.data,
        id: currentEvent.id,
        retry: currentEvent.retry,
      };
    }
  };
}

export { createSSEParser };