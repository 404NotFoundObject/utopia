/**
 * @module ui/screens/settingsUI/sections/conversationState
 * @description 会话状态与转场 section（含 LLM 裁决开关）
 */

/**
 * 渲染会话状态与转场 section
 * @param {Object} settings
 * @param {Object} ctx
 * @returns {string} HTML
 */
export function renderConversationStateSection(settings, ctx) {
  const convStateSettings = settings.conversationState || {};
  const csEnabled = convStateSettings.enabled !== false;
  const csCrossDay = convStateSettings.crossDayEnabled !== false;
  const csTransition = convStateSettings.transitionEnabled !== false;

  const llmArbiter = settings.llmArbiter || {};
  const llmArbiterEnabled = llmArbiter.enabled !== false;

  return `
    <!-- 会话状态与转场 -->
    <div class="settings-section">
      <h3>🗓️ 会话状态与转场</h3>
      <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.8rem;">
        智能识别对话场景（吃饭/看电影/工作等），跨天感知时间跨度，以及场景转场提示。
      </p>
      <div class="setting-row">
        <label>启用会话状态机</label>
        ${ctx.toggleHtml('settingsCsEnabled', csEnabled)}
        <span class="help-text">总开关，关闭后不再识别场景与状态</span>
      </div>
      <div class="setting-row">
        <label>跨天感知</label>
        ${ctx.toggleHtml('settingsCsCrossDay', csCrossDay)}
        <span class="help-text">识别"昨天/几天前"的时间跨度，与冷落感知互补</span>
      </div>
      <div class="setting-row">
        <label>场景转场</label>
        ${ctx.toggleHtml('settingsCsTransition', csTransition)}
        <span class="help-text">识别场景过期（如"吃饭 10 小时后说吃饱了"），生成合理转场</span>
      </div>
      <div class="setting-row">
        <label>LLM 裁决</label>
        ${ctx.toggleHtml('settingsLlmArbiter', llmArbiterEnabled)}
        <span class="help-text">当规则无法判定时，调用 LLM 做场景裁决（消耗少量 token）</span>
      </div>
    </div>
  `;
}

/**
 * 会话状态 section 无需额外事件绑定
 */
export function bindConversationStateSection(modalContent, ctx) {
  // no-op
}