/**
 * @module ui/screens/settingsUI/sections/tokenBudget
 * @description Token 预算 section
 */

/**
 * 渲染 Token 预算 section
 * @param {Object} settings
 * @param {Object} ctx
 * @returns {string} HTML
 */
export function renderTokenBudgetSection(settings, ctx) {
  const tokenBudget = settings.tokenBudget || {};
  const tbEnabled = tokenBudget.enabled !== false;
  const tbContextMode = tokenBudget.contextWindowMode || 'auto';
  const tbManualWindow = ctx.clampNum(tokenBudget.manualContextWindow, 1024, 2000000, 8192);
  const tbReserve = ctx.clampNum(tokenBudget.reserveForGeneration, 128, 8192, 1024);
  const tbAllocation = tokenBudget.allocation || { system: 0.4, history: 0.4, memory: 0.1, summary: 0.1 };
  const tbAllocSystem = ctx.clampNum(tbAllocation.system, 0, 1, 0.4);
  const tbAllocHistory = ctx.clampNum(tbAllocation.history, 0, 1, 0.4);
  const tbAllocMemory = ctx.clampNum(tbAllocation.memory, 0, 1, 0.1);
  const tbAllocSummary = ctx.clampNum(tbAllocation.summary, 0, 1, 0.1);
  const tbStrategy = tokenBudget.strategy || 'drop_lowest';
  const tbWbBudgetRatio = ctx.clampNum(tokenBudget.worldBookBudgetRatio, 0, 0.5, 0.3);

  return `
    <!-- Token 预算管理 -->
    <div class="settings-section">
      <h3>📊 Token 预算管理</h3>
      <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.8rem;">
        在发送 API 请求前，对上下文做 token 预算裁剪。避免因上下文过长导致的截断或报错。
      </p>
      <div class="setting-row">
        <label>启用预算管理</label>
        ${ctx.toggleHtml('settingsTokenBudgetEnabled', tbEnabled)}
        <span class="help-text">关闭后不会对上下文做任何裁剪</span>
      </div>
      <div class="setting-row">
        <label>上下文窗口</label>
        <select id="settingsTokenBudgetContextMode">
          <option value="auto" ${tbContextMode === 'auto' ? 'selected' : ''}>自动（根据模型名推断）</option>
          <option value="manual" ${tbContextMode === 'manual' ? 'selected' : ''}>手动指定</option>
        </select>
        <span class="help-text">当前模型推断窗口：<span id="inferredContextWindow">${ctx.getModelContextWindow(settings.modelName)}</span> tokens</span>
      </div>
      <div class="setting-row" id="tokenBudgetManualRow" style="${tbContextMode === 'manual' ? '' : 'display:none;'}">
        <label>手动窗口大小</label>
        <input type="number" id="settingsTokenBudgetManualWindow" min="1024" max="2000000" step="1024" value="${tbManualWindow}">
        <span class="help-text">单位：tokens。常见值：8192 / 32768 / 128000 / 200000</span>
      </div>
      <div class="setting-row">
        <label>预留生成 Token</label>
        <input type="number" id="settingsTokenBudgetReserve" min="128" max="8192" step="128" value="${tbReserve}">
        <span class="help-text">为模型生成回复预留的 token 数（建议 1024 ~ 4096）</span>
      </div>
      <div class="setting-row">
        <label>分配比例</label>
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;flex:1;">
          <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.85rem;">
            系统 <input type="number" id="settingsTbAllocSystem" min="0" max="1" step="0.05" value="${tbAllocSystem}" style="width:60px;">
          </label>
          <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.85rem;">
            历史 <input type="number" id="settingsTbAllocHistory" min="0" max="1" step="0.05" value="${tbAllocHistory}" style="width:60px;">
          </label>
          <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.85rem;">
            记忆 <input type="number" id="settingsTbAllocMemory" min="0" max="1" step="0.05" value="${tbAllocMemory}" style="width:60px;">
          </label>
          <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.85rem;">
            摘要 <input type="number" id="settingsTbAllocSummary" min="0" max="1" step="0.05" value="${tbAllocSummary}" style="width:60px;">
          </label>
        </div>
        <span class="help-text">
          四项之和应接近 1.0。其中「记忆」「摘要」是<strong>独立配额</strong>，
          分别约束注入器里的「长期记忆」「对话摘要」两类 system 消息；超出配额的部分会被裁剪。
          调小记忆比例，可让历史对话获得更多空间。
        </span>
      </div>
      <div class="setting-row">
        <label>剪裁策略</label>
        <select id="settingsTokenBudgetStrategy">
          <option value="drop_lowest" ${tbStrategy === 'drop_lowest' ? 'selected' : ''}>丢弃最低优先级（推荐）</option>
          <option value="truncate_longest" ${tbStrategy === 'truncate_longest' ? 'selected' : ''}>截断最长条目</option>
          <option value="summary_oldest" ${tbStrategy === 'summary_oldest' ? 'selected' : ''}>用摘要替换最旧消息</option>
        </select>
        <span class="help-text">超预算时的处理方式</span>
      </div>
      <div class="setting-row">
        <label>世界书预算占比</label>
        <div style="display:flex;align-items:center;gap:0.5rem;flex:1;">
          <input type="range" id="settingsWbBudgetRatioSlider" min="0" max="0.5" step="0.05" value="${tbWbBudgetRatio}" style="flex:1;">
          <span id="settingsWbBudgetRatioLabel" style="min-width:50px;font-size:0.9rem;">${tbWbBudgetRatio.toFixed(2)}</span>
        </div>
        <span class="help-text">
          世界书规则的 token 预算 = 系统提示预算 × 该比例。值越低，世界书规则越容易被裁剪。
          推荐 0.3（默认），上限 0.5。
        </span>
      </div>
    </div>
  `;
}

/**
 * 绑定 Token 预算 section 的事件
 * @param {HTMLElement} modalContent
 * @param {Object} ctx
 */
export function bindTokenBudgetSection(modalContent, ctx) {
  // 上下文窗口模式切换
  const tbContextModeSelect = modalContent.querySelector('#settingsTokenBudgetContextMode');
  const tbManualRow = modalContent.querySelector('#tokenBudgetManualRow');
  if (tbContextModeSelect && tbManualRow) {
    tbContextModeSelect.addEventListener('change', () => {
      tbManualRow.style.display = tbContextModeSelect.value === 'manual' ? '' : 'none';
    });
  }

  // 世界书预算占比滑块
  const wbBudgetRatioSlider = modalContent.querySelector('#settingsWbBudgetRatioSlider');
  const wbBudgetRatioLabel = modalContent.querySelector('#settingsWbBudgetRatioLabel');
  if (wbBudgetRatioSlider && wbBudgetRatioLabel) {
    wbBudgetRatioSlider.addEventListener('input', () => {
      const val = ctx.clampNum(wbBudgetRatioSlider.value, 0, 0.5, 0.3);
      wbBudgetRatioLabel.textContent = val.toFixed(2);
    });
  }

  // 模型名变化时更新推断窗口 —— 此处挂到 tokenBudget section
  // 因为推断窗口标签 `#inferredContextWindow` 在本 section 内
  const modelInputEl = modalContent.querySelector('#settingsModelInput');
  const inferredSpan = modalContent.querySelector('#inferredContextWindow');
  if (modelInputEl && inferredSpan) {
    modelInputEl.addEventListener('input', () => {
      inferredSpan.textContent = ctx.getModelContextWindow(modelInputEl.value);
    });
  }
}