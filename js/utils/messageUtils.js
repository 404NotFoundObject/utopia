// js/utils/messageUtils.js - 消息处理工具函数

/**
 * 从消息元素中获取纯净的对话文本（不含时间戳）
 * @param {Element} el - 消息 DOM 元素
 * @param {string} bubbleSelector - 气泡的选择器，默认 '.bubble'
 * @returns {string} 纯净文本
 */
export function getCleanContentFromElement(el, bubbleSelector = '.bubble') {
    if (!el) return '';
    var bubble = el.querySelector(bubbleSelector);
    if (!bubble) return '';
    var clone = bubble.cloneNode(true);
    var timestamp = clone.querySelector('.timestamp');
    if (timestamp) timestamp.remove();
    var text = clone.textContent || clone.innerText || '';
    return text.trim();
}

/**
 * 提取对话文本（过滤心理活动和动作描写）
 * 支持: （...）(...) *...* _..._ 【...】 [...] 等
 * @param {string} text - 原始文本
 * @returns {string} 过滤后的对话文本
 */
export function extractDialogueText(text) {
    if (!text) return '';
    var cleaned = text;
    // 括号内容
    cleaned = cleaned.replace(/（[^）]*）/g, '');
    cleaned = cleaned.replace(/\([^)]*\)/g, '');
    // 星号/下划线包围
    cleaned = cleaned.replace(/\*[^*]*\*/g, '');
    cleaned = cleaned.replace(/_[^_]*_/g, '');
    // 方括号内容
    cleaned = cleaned.replace(/【[^】]*】/g, '');
    cleaned = cleaned.replace(/\[[^\]]*\]/g, '');
    // Markdown 链接
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // 清理多余空白
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
}

/**
 * 检查消息是否有可朗读的对话内容
 * @param {string} content - 消息内容
 * @returns {boolean} 是否有对话内容
 */
export function hasSpeakableContent(content) {
    if (!content || content.trim().length === 0) return false;
    var dialogue = extractDialogueText(content);
    return dialogue && dialogue.length > 0;
}