/**
 * @module mentionUtils
 * @description @提及解析工具
 *
 * 排除字符总览：
 *   - 空白：\s
 *   - @ 本身：@
 *   - 中文标点：，。！？：；
 *   - 半角标点：,.:;!? + \n
 *
 * 用法：
 *   import { extractMentionNames } from './mentionUtils.js';
 *   const names = extractMentionNames('@小明 你好 @小红：在吗');
 *   // → ['小明', '小红']
 */

// 全局正则（带 g 标志），供 matchAll 使用
// 注意：不要直接对这个实例调用 .exec()，因为 g 标志会修改 lastIndex；
// 使用 extractMentionNames 内部通过 matchAll 克隆实例，安全无副作用。
export const MENTION_REGEX = /@([^\s@，,。！？：:；;!?\n]+)/g;

/**
 * 从文本中提取所有 @ 名字（去重前，保留原始顺序）
 *
 * @param {string} text - 待解析的文本
 * @returns {string[]} @ 后的名字数组（原样返回，未做去重/验证）
 *
 * @example
 * extractMentionNames('@小明 @小红')     // ['小明', '小红']
 * extractMentionNames('@小明：你好')      // ['小明']
 * extractMentionNames('@小明!真的吗')     // ['小明']
 * extractMentionNames('没有提及')          // []
 */
export function extractMentionNames(text) {
  if (!text || typeof text !== 'string') return [];
  // matchAll 要求正则带 g 标志；内部会克隆一份使用，不污染原实例的 lastIndex
  return Array.from(text.matchAll(MENTION_REGEX), m => m[1]);
}