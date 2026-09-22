/**
 * @module api-adapter/sse-parser
 * @description 一个轻量级的 SSE (Server-Sent Events) 解析器，可将字节流转换为结构化事件。
 *
 */

const MAX_BUFFER_SIZE = 1024 * 1024;   // 1MB

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

    const flushCurrentEvent = function* () {
      if (currentEvent.data && currentEvent.data.trim() !== '[DONE]') {
        yield {
          event: currentEvent.event || 'message',
          data: currentEvent.data,
          id: currentEvent.id,
          retry: currentEvent.retry,
        };
        currentEvent = { data: '' };
      }
    };

    for await (const chunk of byteStream) {
      const text = decoder.decode(chunk, { stream: true });
      buffer += text;

      if (buffer.length > MAX_BUFFER_SIZE) {
        console.warn('[SSEParser] buffer 超限，主动 flush 已累积数据');
        // 尝试按最后一个 \n 切割（保留未完整的尾部）
        const lastNewline = buffer.lastIndexOf('\n');
        let toProcess;
        if (lastNewline === -1) {
          // 没有换行符：把整个 buffer 当作一行处理，然后清空
          toProcess = buffer;
          buffer = '';
        } else {
          toProcess = buffer.substring(0, lastNewline + 1);
          buffer = buffer.substring(lastNewline + 1);
        }

        const lines = toProcess.split('\n');
        if (toProcess.endsWith('\n')) lines.pop();
        for (const line of lines) {
          if (line === '' && currentEvent.data) {
            if (currentEvent.data.trim() === '[DONE]') return;
            yield {
              event: currentEvent.event || 'message',
              data: currentEvent.data,
              id: currentEvent.id,
              retry: currentEvent.retry,
            };
            currentEvent = { data: '' };
          } else {
            processLine(line);
          }
        }

        // 若还残留未 yield 的 data，主动 yield
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

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line === '' && currentEvent.data) {
          // 空行触发事件分发
          if (currentEvent.data.trim() === '[DONE]') return;
          yield {
            event: currentEvent.event || 'message',
            data: currentEvent.data,
            id: currentEvent.id,
            retry: currentEvent.retry,
          };
          currentEvent = { data: '' };
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