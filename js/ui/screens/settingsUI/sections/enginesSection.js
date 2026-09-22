/**
 * @module ui/screens/settingsUI/sections/engines
 * @description 引擎控制 section（情感 / 身体 / 时间 + 情感高级选项）
 */

/**
 * 渲染引擎控制 section
 * @param {Object} settings
 * @param {Object} ctx
 * @returns {string} HTML
 */
export function renderEnginesSection(settings, ctx) {
  const engineFlags = settings.engineFlags || {};
  const engineEmotion = engineFlags.emotion !== false;
  const engineBody = engineFlags.bodyState !== false;
  const engineTime = engineFlags.time !== false;

  return `
    <!-- 引擎控制 -->
    <div class="settings-section">
      <h3>🧠 三大引擎控制</h3>
      <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.8rem;">
        引擎控制角色的情感、身体状态和时间感知。关闭后相关功能将停止，可能导致角色互动不真实。
      </p>
      <div class="setting-row">
        <label>情感引擎</label>
        ${ctx.toggleHtml('settingsEngineEmotion', engineEmotion)}
        <span class="help-text">控制角色的情绪变化和情感反应</span>
      </div>
      <div class="setting-row">
        <label>身体状态引擎</label>
        ${ctx.toggleHtml('settingsEngineBody', engineBody)}
        <span class="help-text">控制角色的精力、睡意、健康等身体状态</span>
      </div>
      <div class="setting-row">
        <label>时间系统</label>
        ${ctx.toggleHtml('settingsEngineTime', engineTime)}
        <span class="help-text">控制游戏时间的流逝和离线计算</span>
      </div>
    </div>

    <!-- 情感引擎高级选项 -->
    <div class="settings-section">
      <h3>情感引擎高级选项</h3>
      <div class="setting-row">
        <label>启用 LLM 辅助情感分类</label>
        ${ctx.toggleHtml('settingsUseLLMEmotion', settings.useLLMForEmotion)}
        <span class="help-text">开启后，当词库匹配不明确时，将调用 AI 分析用户意图（消耗少量 token）</span>
      </div>
    </div>
  `;
}

/**
 * 引擎控制 section 无需额外事件绑定
 * （引擎开关的警告确认逻辑在 save.js 中）
 */
export function bindEnginesSection(modalContent, ctx) {
  // no-op
}