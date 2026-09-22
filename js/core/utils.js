// 工具函数

export function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * 转义 HTML 特殊字符，用于将任意文本安全地插入 innerHTML 或 HTML 属性。
 *
 * 覆盖字符：
 *   &  → &amp;
 *   <  → &lt;
 *   >  → &gt;
 *   "  → &quot;
 *   '  → &#39;
 *
 * 空值处理：null / undefined 返回空字符串，避免渲染出 "null"/"undefined"。
 * 无 DOM 依赖：使用纯字符串替换，可在 Worker / Node 环境安全使用。
 *
 * @param {*} text - 任意值（会被 String() 转换）
 * @returns {string} 转义后的安全字符串
 */
export function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const str = String(text);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function truncateText(text, len = 20) {
  return text.length > len ? text.slice(0, len) + '...' : text;
}