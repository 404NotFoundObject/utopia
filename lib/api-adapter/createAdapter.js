/**
 * @module api-adapter/createAdapter
 * @description 根据厂商配置生成标准请求/响应/流式映射的适配器实例。
 *
 * @note 流处理约束：
 *   - 适配器假定服务端返回标准 SSE 格式，若端点返回非 SSE 流（如纯文本流），解析会失败。
 *   - `adaptStream` 不会处理背压（backpressure），若厂商数据块速率远大于消费速率，内存可能持续增长。
 *   - 流内的 JSON 解析错误默认静默跳过，仅通过 `onError` 回调通知，上层可能未感知数据丢失。
 */

import { mapObject, toAsyncIterator } from './utils.js';
import { createSSEParser } from './sse-parser.js';

/**
 * 创建 API 适配器，将统一的标准请求转换为厂商请求，并将厂商响应/流事件还原为标准格式。
 *
 * @param {Object} config - 适配器配置，通常由各厂商模块导出。
 * @param {Object} config.requestMapping - 请求字段映射规则，传给 `mapObject`。
 * @param {Object} config.responseMapping - 响应字段映射规则，传给 `mapObject`。
 * @param {Object} [config.streamMapping] - 流块映射规则，可以是对象（传给 `mapObject`）或函数。
 * @param {Function} [config.transformRequest] - 可选的请求后处理函数，接收 (vendorReq, standardReq)，应返回最终厂商请求体。
 * @param {Function} [config.transformResponse] - 可选的响应后处理函数，接收 (standardResp, vendorResp)，应返回最终标准响应体。
 * @param {Object} [config.capabilities] - ★★★ 新增：适配器能力声明，描述支持的采样参数及其范围 ★★★
 * @param {Object} [options={}] - 行为选项。
 * @param {boolean} [options.strict=false] - 是否启用严格模式，字段缺失时通过 `onLog` 上报警告。
 * @param {Function} [options.onLog] - 日志回调，在 strict 模式下接收警告信息 `(level, message, details)`。
 * @param {Function} [options.onError] - 全局错误回调，流处理中的错误会先传递至此。
 * @returns {{
 *   adaptRequest: Function,
 *   adaptResponse: Function,
 *   adaptStreamChunk: Function,
 *   adaptStream: Function,
 *   config: Object,
 *   getCapabilities: Function
 * }} 适配器实例，提供四个核心方法、原始配置及能力查询方法。
 *
 * @example
 * const adapter = createAdapter(openaiConfig, { strict: true, onLog: console.warn });
 * const vendorRequest = adapter.adaptRequest(standardRequest);
 * const caps = adapter.getCapabilities(); // { temperature: {min:0, max:2, step:0.1}, ... }
 */
function createAdapter(config, options = {}) {
  const { requestMapping, responseMapping, streamMapping } = config;
  const { strict = false, onLog, onError } = options;

  /**
   * 将标准请求转换为厂商请求格式。
   * @param {Object} standardReq - 符合内部统一结构的请求对象。
   * @returns {Object} 厂商请求对象。
   */
  function adaptRequest(standardReq) {
    let vendorReq = mapObject(standardReq, requestMapping, { strict, onLog });
    if (config.transformRequest) {
      vendorReq = config.transformRequest(vendorReq, standardReq);
    }
    return vendorReq;
  }

  /**
   * 将厂商响应转换为标准响应格式。
   * @param {Object} vendorResp - 厂商 API 返回的响应对象。
   * @returns {Object} 标准响应对象。
   */
  function adaptResponse(vendorResp) {
    let standardResp = mapObject(vendorResp, responseMapping, { strict, onLog });
    if (config.transformResponse) {
      standardResp = config.transformResponse(standardResp, vendorResp);
    }
    return standardResp;
  }

  /**
   * 将流式块中的单个厂商事件转换为标准块。
   * @param {Object} vendorChunk - 厂商流中的一个数据块（已解析 JSON）。
   * @returns {Object|null} 标准流块，或 null 表示该块应被丢弃。
   * @throws {Error} 如果 streamMapping 未配置。
   */
  function adaptStreamChunk(vendorChunk) {
    if (!streamMapping) throw new Error('streamMapping not configured');
    if (typeof streamMapping === 'function') {
      return streamMapping(vendorChunk);
    }
    return mapObject(vendorChunk, streamMapping, { strict, onLog });
  }

  /**
   * 将厂商流（ReadableStream 或 AsyncIterable<Uint8Array>）转换为标准块的异步生成器。
   * 内部会解析 SSE 格式并按顺序 yield 标准块。
   *
   * @param {ReadableStream|AsyncIterable<Uint8Array>} stream - 厂商原始流。
   * @param {Object} [options] - 可选配置。
   * @param {AbortSignal} [options.signal] - 用于取消流的信号。
   * @param {Function} [options.onChunkError] - 单个块处理错误回调，优先级高于全局 `onError`。
   * @yields {Object} 标准流块。
   *
   * @note 该函数未实现背压控制，若生产端速率远高于消费端，可能导致内存占用持续增大。
   *       此外，流中的 JSON 解析或映射错误默认静默跳过，仅通过错误回调通知，上层可能未感知数据丢失。
   * @example
   * for await (const chunk of adapter.adaptStream(response.body)) {
   *   console.log(chunk);
   * }
   */
  async function* adaptStream(stream, { signal, onChunkError } = {}) {
    const sseParser = createSSEParser();
    const byteIterable = toAsyncIterator(stream, signal);
    const errorHandler = onChunkError || onError;

    for await (const sseEvent of sseParser(byteIterable)) {
      if (signal?.aborted) break;
      if (sseEvent.event === 'message' || !sseEvent.event) {
        try {
          const vendorChunk = JSON.parse(sseEvent.data);
          let chunk;
          try {
            chunk = adaptStreamChunk(vendorChunk);
          } catch (chunkError) {
            if (errorHandler) {
              errorHandler({ type: 'map_error', error: chunkError, vendorChunk });
            }
            continue;
          }
          if (chunk) yield chunk;
        } catch (parseError) {
          if (errorHandler) {
            errorHandler({ type: 'parse_error', error: parseError, rawData: sseEvent.data });
          }
        }
      }
    }
  }

  // ★★★ 新增：获取能力声明 ★★★
  function getCapabilities() {
    return config.capabilities || {};
  }

  return {
    adaptRequest,
    adaptResponse,
    adaptStreamChunk,
    adaptStream,
    config,
    getCapabilities,
  };
}

export { createAdapter };