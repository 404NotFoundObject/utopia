/**
 * @module ui/screens/settingsUI/shared
 * @description 设置面板公共工具与上下文工厂
 *
 * 用途：
 *   - 提供纯函数工具：safeNum / clampNum / toggleHtml / escapeHtml（再导出）
 *   - 提供 createSettingsCtx()，把运行时依赖集中注入给各 section
 *
 * 设计原则：
 *   - section 内不直接 import 运行时模块（getAppState / updateSettings 等），
 *     一律通过 ctx 获取，避免 section 之间隐式耦合
 *   - ctx 是每次调用 render / bind 时新建的，确保 getSettings() 拿到最新设置
 */

import { getAppState } from '../../../core/state.js';
import { escapeHtml } from '../../../core/utils.js';
import { getModelContextWindow } from '../../../modules/tokenBudget.js';
import { showToast } from '../../components/toast.js';

// ============================================================
// 纯函数工具
// ============================================================

/**
 * 安全数值转换：null/undefined 或非有限数返回 fallback
 */
export function safeNum(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 安全数值转换 + 区间裁剪
 */
export function clampNum(value, min, max, fallback) {
  const n = safeNum(value, fallback);
  return Math.min(max, Math.max(min, n));
}

/**
 * 生成 Toggle Switch 的 HTML
 * @param {string} id - input 元素的 id
 * @param {boolean} checked - 是否选中
 */
export function toggleHtml(id, checked) {
  return `<label class="toggle-switch">
    <input type="checkbox" id="${id}"${checked ? ' checked' : ''}>
    <span class="toggle-slider"></span>
  </label>`;
}

/**
 * 获取厂商列表（用于下拉框）
 * @returns {Array<{id: string, label: string}>}
 */
export function getProviderList() {
  return [
    { id: 'openai', label: 'OpenAI' },
    { id: 'anthropic', label: 'Anthropic' },
    { id: 'google', label: 'Google Gemini' },
    { id: 'cohere', label: 'Cohere' },
    { id: 'deepseek', label: 'DeepSeek' },
    { id: 'mistral', label: 'Mistral' },
    { id: 'groq', label: 'Groq' },
    { id: 'perplexity', label: 'Perplexity' },
    { id: 'xai', label: 'xAI (Grok)' },
  ];
}

// ============================================================
// 采样参数渲染（被 modelParams section 复用）
// ============================================================

/**
 * 根据能力声明和当前设置，渲染采样参数输入项
 * @param {Object} caps - 能力声明对象
 * @param {Object} settings - 当前设置
 * @returns {string} HTML
 */
export function renderSamplingParams(caps, settings) {
  let html = '';
  const paramOrder = [
    { key: 'frequency_penalty', label: '频率惩罚', field: 'frequencyPenalty', default: 0 },
    { key: 'presence_penalty', label: '存在惩罚', field: 'presencePenalty', default: 0 },
    { key: 'top_k', label: 'Top-K 采样', field: 'topK', default: 0 },
    { key: 'repetition_penalty', label: '重复惩罚', field: 'repetitionPenalty', default: 1.0 },
  ];

  for (const p of paramOrder) {
    const cap = caps[p.key];
    if (!cap) continue;
    const fallback = cap.default ?? p.default;
    const value = clampNum(settings[p.field], cap.min, cap.max, fallback);
    html += `
      <div class="setting-row">
        <label>${p.label}</label>
        <input type="number" id="settings_${p.field}" step="${cap.step}" min="${cap.min}" max="${cap.max}" value="${value}" />
        <span class="help-text">范围 ${cap.min} ~ ${cap.max}，步长 ${cap.step}</span>
      </div>
    `;
  }
  return html;
}

// ============================================================
// SettingsCtx 工厂
// ============================================================

/**
 * 创建 settings 上下文对象
 *
 * 每个 section 的 render / bind 都接收 ctx 参数，从中获取工具与运行时依赖。
 * ctx 每次调用都新建，`getSettings()` 会返回最新设置。
 *
 * @returns {Object} ctx
 */
export function createSettingsCtx() {
  return {
    // ---- 纯函数工具 ----
    safeNum,
    clampNum,
    toggleHtml,
    getProviderList,
    escapeHtml,
    renderSamplingParams,

    // ---- 领域工具（thin wrapper） ----
    getModelContextWindow,

    // ---- 运行时依赖 ----
    getSettings: () => getAppState().get('settings') || {},
    showToast,
  };
}