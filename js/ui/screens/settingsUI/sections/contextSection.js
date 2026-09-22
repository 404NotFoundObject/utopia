/**
 * @module ui/screens/settingsUI/sections/context
 * @description 摘要与上下文模式 section
 *
 * 包含两个原 section：
 *   - 对话摘要（启用 / 频率 / 最大长度）
 *   - 上下文模式（smart / full / summary_only）
 */

/**
 * 渲染摘要与上下文模式 section
 * @param {Object} settings
 * @param {Object} ctx
 * @returns {string} HTML
 */
export function renderContextSection(settings, ctx) {
  const summaryEnabled = settings.summaryEnabled !== false;
  const summaryFrequency = ctx.clampNum(settings.summaryFrequency, 3, 50, 10);
  const summaryMaxLength = ctx.clampNum(settings.summaryMaxLength, 50, 500, 200);

  return `
    <!-- 对话摘要 -->
    <div class="settings-section">
      <h3>📝 对话摘要</h3>
      <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.8rem;">
        摘要功能可自动总结对话，帮助模型保持长期记忆和一致性。
      </p>
      <div class="setting-row">
        <label>启用摘要</label>
        ${ctx.toggleHtml('settingsSummaryEnabled', summaryEnabled)}
      </div>
      <div class="setting-row">
        <label>摘要频率（消息数）</label>
        <input type="number" id="settingsSummaryFrequency" value="${summaryFrequency}" min="3" max="50" step="1">
        <span class="help-text">每多少条消息生成一次摘要</span>
      </div>
      <div class="setting-row">
        <label>摘要最大长度（token）</label>
        <input type="number" id="settingsSummaryMaxLength" value="${summaryMaxLength}" min="50" max="500" step="10">
        <span class="help-text">控制摘要的详细程度</span>
      </div>
    </div>

    <!-- 上下文模式 -->
    <div class="settings-section">
      <h3>📊 上下文模式</h3>
      <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.8rem;">
        控制每次请求发送给 AI 的消息范围，影响记忆完整性和 token 消耗。
      </p>
      <div class="setting-row">
        <label>模式</label>
        <select id="settingsContextMode">
          <option value="smart" ${settings.contextMode === 'smart' ? 'selected' : ''}>智能混合（摘要 + 最近对话）</option>
          <option value="full" ${settings.contextMode === 'full' ? 'selected' : ''}>全量上下文（全部消息，适合大上下文模型）</option>
          <option value="summary_only" ${settings.contextMode === 'summary_only' ? 'selected' : ''}>仅摘要（极简模式，省 token）</option>
        </select>
        <span class="help-text">全量模式消耗较多 token，建议配合高上下文模型使用；智能混合为默认平衡模式。</span>
      </div>
    </div>
  `;
}

/**
 * 摘要与上下文模式 section 无需额外事件绑定
 */
export function bindContextSection(modalContent, ctx) {
  // no-op
}