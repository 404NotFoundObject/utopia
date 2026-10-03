/**
 * @module lib/pathUtils
 * @description 路径取值工具（唯一实现）。
 *
 * 审计 P3-5：此前 `lib/api-adapter/utils.js` 的 `getByPath` 与
 * `lib/context-injector-core.js` 的私有 `safeGetByPath` 是两份语义重复的实现
 * （都支持 `a.b[0].c`），修复任意一处路径解析问题都要改两遍。此模块为唯一实现。
 */

/**
 * 根据点号或方括号分隔的路径字符串从对象中取值。
 *
 * 支持形式：`"a.b.c"`、`"a[0].b"`、`"a.b[0].c"`。
 * 中间任一环节为 null/undefined 时返回 undefined（不抛错）。
 *
 * @param {Object} source - 源对象。
 * @param {string} path - 路径字符串。
 * @returns {*} 路径对应的值，若路径不存在则返回 `undefined`。
 *
 * @example
 * getByPath({ a: { b: [{ c: 1 }] } }, 'a.b[0].c'); // 1
 * getByPath({}, 'a.b');                            // undefined
 */
export function getByPath(source, path) {
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
export function getByPathArr(source, pathArr) {
  let current = source;
  for (const key of pathArr) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}
