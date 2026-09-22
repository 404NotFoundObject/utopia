// js/modules/summary.js - 对话摘要管理
import { sendChatRequest } from '../core/api.js';

/**
 * 生成对话摘要
 * @param {string} conversationText - 对话文本（格式化后的对话历史）
 * @param {string} existingSummary - 已有的摘要（如果有）
 * @param {number} maxTokens - 摘要最大 token 数
 * @param {Object} [character] - 当前角色对象（强烈建议显式传入）
 * @returns {Promise<string>} 生成的摘要
 */
export async function generateSummary(conversationText, existingSummary = '', maxTokens = 200, character = null) {
  // ★ 修复 B1：兼容旧调用 —— 未传 character 时尝试从当前状态获取
  let effectiveChar = character;
  if (!effectiveChar) {
    try {
      const { getCurrentCharacter } = await import('./character.js');
      effectiveChar = getCurrentCharacter();
      if (effectiveChar) {
        console.warn(
          '[Summary] generateSummary 未显式传入 character，已回退到 getCurrentCharacter()。' +
          '为避免切换角色时的竞态，建议调用方显式传参。'
        );
      }
    } catch (e) {
      console.warn('[Summary] 回退 getCurrentCharacter 失败:', e);
    }
  }

  if (!effectiveChar || typeof effectiveChar !== 'object') {
    console.warn('[Summary] generateSummary: 无法确定角色，使用默认名"角色"');
    effectiveChar = { name: '角色' };
  }

  const characterName = effectiveChar.name || '角色';

  const prompt = `你是一个对话摘要助手。请为角色"${characterName}"与用户的对话历史生成一段简洁的摘要，保留关键信息（角色状态、用户偏好、重要情节、关系进展等）。${existingSummary ? '已有的摘要如下，请在此基础上更新：\n' + existingSummary : ''}
对话历史：
${conversationText}

请生成新的摘要，不超过 ${maxTokens} 个token，语言简洁，只包含关键事实。`;

  try {
    const response = await sendChatRequest({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: '你是一个对话摘要专家，只输出摘要文本，不要添加额外内容。',
      temperature: 0.3,
      maxTokens: maxTokens,
      stream: false,
    });
    return response.content.trim();
  } catch (e) {
    console.error('生成摘要失败:', e);
    return existingSummary || '对话摘要生成失败';
  }
}

/**
 * 检查是否需要生成摘要
 * @param {Array} messages - 会话消息列表
 * @param {number} frequency - 触发频率（消息条数）
 * @param {number} lastIndex - 上次摘要到的消息索引
 * @returns {boolean} 是否需要生成
 */
export function shouldGenerateSummary(messages, frequency, lastIndex) {
  const total = messages.length;
  const nextThreshold = lastIndex + frequency;
  return total >= nextThreshold;
}

/**
 * 获取需要摘要的消息范围
 * @param {Array} messages - 所有消息
 * @param {number} lastIndex - 上次摘要到的消息索引
 * @param {number} frequency - 频率
 * @returns {Array} 需要摘要的消息子集
 */
export function getMessagesToSummarize(messages, lastIndex, frequency) {
  const start = lastIndex;
  const end = Math.min(start + frequency, messages.length);
  return messages.slice(start, end);
}

/**
 * 格式化消息为文本（用于摘要）
 */
export function formatMessagesForSummary(messages) {
  return messages.map(m => `${m.role === 'user' ? '用户' : '角色'}: ${m.content}`).join('\n');
}