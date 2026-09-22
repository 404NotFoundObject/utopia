/**
 * @module ui/screens/settingsUI/sections/modelParams
 * @description 模型参数 section（温度 / Top-P / 最大 Token + 采样参数）
 */

/**
 * 渲染模型参数 section
 * @param {Object} settings
 * @param {Object} ctx
 * @returns {string} HTML
 */
export function renderModelParamsSection(settings, ctx) {
  const caps = settings.capabilities || {};
  const paramsHtml = ctx.renderSamplingParams(caps, settings);

  const renderTemp = ctx.clampNum(settings.temperature, 0, 2, 0.7);
  const renderTopP = ctx.clampNum(settings.topP, 0, 1, 1.0);
  const renderMaxTokens = ctx.clampNum(settings.maxTokens, 1, 32768, 4096);

  return `
    <!-- 模型参数 -->
    <div class="settings-section">
      <h3>🎛️ 模型参数</h3>
      <div class="setting-row">
        <label>温度 (0-2)</label>
        <input type="number" id="settingsTemperature" step="0.1" min="0" max="2" value="${renderTemp}" />
      </div>
      <div class="setting-row">
        <label>Top-P (0-1)</label>
        <input type="number" id="settingsTopP" step="0.05" min="0" max="1" value="${renderTopP}" />
        <span class="help-text">核采样。1.0 表示不启用。部分推理模型（o1/o3、Claude 4）会自动忽略此参数</span>
      </div>
      <div class="setting-row">
        <label>最大输出Token</label>
        <input type="number" id="settingsMaxTokens" step="1" min="1" value="${renderMaxTokens}" />
      </div>
      ${paramsHtml}
    </div>
  `;
}

/**
 * 模型参数 section 无需额外事件绑定
 * （保存按钮统一从 DOM 抓值）
 */
export function bindModelParamsSection(modalContent, ctx) {
  // no-op
}