/**
 * @module api-adapter/utils
 * @description 通用工具函数，包括安全 JSON 解析、对象路径取值、映射转换、流检测等。
 */

/**
 * 安全解析 JSON 字符串，解析失败时返回 fallback 或包含原始字符串的特殊对象。
 *
 * @param {string} str - 待解析的 JSON 字符串。
 * @param {*} [fallback={}] - 解析失败时的默认返回值（若非字符串也直接返回）。
 * @returns {*} 解析后的对象，或错误时返回 `{ __raw_arguments: str, __parse_error: true }`。
 *
 * @example
 * safeJsonParse('{"a":1}');        // { a: 1 }
 * safeJsonParse('not json');       // { __raw_arguments: 'not json', __parse_error: true }
 */
function safeJsonParse(str, fallback = {}) {
  if (typeof str !== 'string') return fallback;
  try { return JSON.parse(str); } catch { return { __raw_arguments: str, __parse_error: true }; }
}

/**
 * 根据点号或括号分隔的路径字符串从对象中取值。
 *
 * @param {Object} source - 源对象。
 * @param {string} path - 路径字符串，如 `"a.b[0].c"`。
 * @returns {*} 路径对应的值，若路径不存在则返回 `undefined`。
 */
function getByPath(source, path) {
  if (!source || typeof path !== 'string') return undefined;
  const keys = path.split(/[\.\[\]]+/).filter(Boolean);
  let current = source;
  for (const key of keys) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * 根据路径数组从对象中逐级取值。
 *
 * @param {Object} source - 源对象。
 * @param {string[]} pathArr - 路径段数组，如 `['a', 'b', '0', 'c']`。
 * @returns {*} 路径对应的值，或 `undefined`。
 */
function getByPathArr(source, pathArr) {
  let current = source;
  for (const key of pathArr) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * 根据映射规则，将源对象字段转换为目标对象字段。
 * 支持字符串路径、路径数组、函数转换、对象配置等多种映射定义。
 *
 * @param {Object} source - 源数据对象。
 * @param {Object<string, string|string[]|Function|{key: string|string[], transform?: Function}>} mapping - 映射规则。
 *   - 值为字符串：通过 `getByPath` 取值。
 *   - 值为数组：通过 `getByPathArr` 取值。
 *   - 值为函数：调用 `fn(source, result)`，返回值作为字段值。
 *   - 值为对象 `{ key/path, transform }`：先按 key 取值，再调用 transform(raw, source, result)。
 * @param {Object} [options] - 可选配置。
 * @param {boolean} [options.strict=false] - 严格模式，字段缺失且 `onLog` 存在时触发警告。
 * @param {Function} [options.onLog] - 日志回调，警告时调用 `onLog('warn', msg, detail)`。
 * @returns {Object} 映射后的结果对象。
 */
function mapObject(source, mapping, { strict = false, onLog } = {}) {
  const result = {};
  for (const [targetKey, mapDef] of Object.entries(mapping)) {
    let value;
    let found = true;
    if (typeof mapDef === 'string') {
      value = getByPath(source, mapDef);
      if (value === undefined) found = false;
    } else if (Array.isArray(mapDef)) {
      value = getByPathArr(source, mapDef);
      if (value === undefined) found = false;
    } else if (typeof mapDef === 'function') {
      value = mapDef(source, result);
    } else if (typeof mapDef === 'object' && mapDef !== null) {
      const rawPath = mapDef.key || mapDef.path;
      const raw = typeof rawPath === 'string' ? getByPath(source, rawPath) : getByPathArr(source, rawPath);
      if (raw === undefined) found = false;
      value = mapDef.transform ? mapDef.transform(raw, source, result) : raw;
    }
    if (value !== undefined) {
      result[targetKey] = value;
    } else if (strict && !found && mapDef !== undefined && onLog) {
      onLog('warn', `字段映射缺失: ${targetKey}`, { mapping: mapDef });
    }
  }
  return result;
}

/**
 * 检测对象是否为 Web ReadableStream。
 * @param {*} obj - 待检测对象。
 * @returns {boolean} 是否具有 `getReader` 方法。
 */
function isReadableStream(obj) {
  return obj && typeof obj.getReader === 'function';
}

/**
 * 将 Web ReadableStream<Uint8Array> 转换为异步可迭代对象。
 *
 * @param {ReadableStream<Uint8Array>} stream - 可读流。
 * @param {AbortSignal} [signal] - 可选的取消信号，触发时取消流读取。
 * @yields {Uint8Array} 流中读取的字节块。
 */
async function* streamToIterator(stream, signal) {
  const reader = stream.getReader();
  const onAbort = () => reader.cancel();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      await reader.cancel();
    } catch (_) {}
    try {
      reader.releaseLock();
    } catch (_) {}
  }
}

/**
 * 将输入（ReadableStream 或 AsyncIterable<Uint8Array>）统一转换为 Uint8Array 异步可迭代对象，
 * 并支持 AbortSignal 取消。
 *
 * @param {ReadableStream|AsyncIterable<Uint8Array>} stream - 输入流或异步可迭代对象。
 * @param {AbortSignal} [signal] - 取消信号。
 * @yields {Uint8Array} 字节块。
 */
async function* toAsyncIterator(stream, signal) {
  if (isReadableStream(stream)) {
    yield* streamToIterator(stream, signal);
  } else {
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      yield chunk;
    }
  }
}

export {
  safeJsonParse,
  getByPath,
  getByPathArr,
  mapObject,
  isReadableStream,
  toAsyncIterator,
};