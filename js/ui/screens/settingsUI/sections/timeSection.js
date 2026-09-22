/**
 * @module ui/screens/settingsUI/sections/time
 * @description 时间系统 section（时间流速 + 暂停开关）
 *
 * 保存行为说明：
 *   `setTimeSpeed` / `setTimePaused` 由 save.js 统一调用，
 *   本 section 只负责渲染 + 输入监听（无）。
 */

import { getTimeSpeed, isTimePaused } from '../../../../modules/time.js';

/**
 * 渲染时间系统 section
 * @param {Object} settings
 * @param {Object} ctx
 * @returns {string} HTML
 */
export function renderTimeSection(settings, ctx) {
  const currentSpeed = getTimeSpeed();
  const paused = isTimePaused();
  const timeSpeed = ctx.clampNum(currentSpeed, 1, 48, 1);

  return `
    <!-- 时间系统 -->
    <div class="settings-section">
      <h3>⏰ 时间系统</h3>
      <div class="setting-row">
        <label>时间流速</label>
        <select id="settingsTimeSpeed">
          <option value="1" ${timeSpeed === 1 ? 'selected' : ''}>1:1 (现实)</option>
          <option value="2" ${timeSpeed === 2 ? 'selected' : ''}>1:2 (2倍速)</option>
          <option value="4" ${timeSpeed === 4 ? 'selected' : ''}>1:4 (4倍速)</option>
          <option value="8" ${timeSpeed === 8 ? 'selected' : ''}>1:8 (8倍速)</option>
          <option value="24" ${timeSpeed === 24 ? 'selected' : ''}>1:24 (1天=1小时)</option>
          <option value="48" ${timeSpeed === 48 ? 'selected' : ''}>1:48 (1天=30分钟)</option>
        </select>
      </div>
      <div class="setting-row">
        <label>时间暂停</label>
        ${ctx.toggleHtml('settingsTimePaused', paused)}
        <span class="help-text">开启后游戏时间将停止流动</span>
      </div>
    </div>
  `;
}

/**
 * 时间系统 section 无需额外事件绑定
 */
export function bindTimeSection(modalContent, ctx) {
  // no-op
}