/**
 * @module console
 * @description Utopia 控制台消息 - 命令执行结果展示，不持久化
 */

import { escapeHtml } from '../../core/utils.js';

/**
 * 在对话列表中追加一条控制台消息
 * @param {string} text - 消息内容（支持 \n 换行）
 * @param {string} type - 'info' | 'success' | 'error' | 'warning'
 */
export function appendConsoleMessage(text, type = 'info') {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  // 移除已有的空状态提示（如果有）
  const emptyMsg = container.querySelector('.empty-msg');
  if (emptyMsg) emptyMsg.remove();

  const div = document.createElement('div');
  div.className = `message console console-${type}`;
  div.dataset.console = 'true';

  const iconMap = {
    info: 'ℹ️',
    success: '✅',
    error: '❌',
    warning: '⚠️',
  };

  // ★ XSS 修复：每一行做转义，iconMap 是硬编码 emoji 无需处理
  const safeText = text === null || text === undefined ? '' : String(text);
  const lines = safeText.split('\n');
  const contentHtml = lines
    .map(line => `<div class="console-line">${escapeHtml(line)}</div>`)
    .join('');

  div.innerHTML = `
    <div class="console-icon">${iconMap[type] || '🖥️'}</div>
    <div class="console-bubble">
      <div class="console-header">Utopia 控制台</div>
      <div class="console-content">${contentHtml}</div>
    </div>
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

/**
 * 清空所有控制台消息（刷新时自动清除）
 */
export function clearConsoleMessages() {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const items = container.querySelectorAll('.message.console');
  for (const el of items) el.remove();
}

// 页面刷新前自动清空
window.addEventListener('beforeunload', clearConsoleMessages);