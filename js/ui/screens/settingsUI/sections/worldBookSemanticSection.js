/**
 * @module ui/screens/settingsUI/sections/worldBookSemantic
 * @description 世界书语义触发 section（启用 / 阈值 / topK / 自动同步 / 手动同步向量）
 */

/**
 * 渲染世界书语义触发 section
 * @param {Object} settings
 * @param {Object} ctx
 * @returns {string} HTML
 */
export function renderWorldBookSemanticSection(settings, ctx) {
  const wbSemantic = settings.worldBookSemantic || {};
  const wbSemanticEnabled = wbSemantic.enabled !== false;
  const wbSemanticThreshold = ctx.clampNum(wbSemantic.threshold, 0, 1, 0.55);
  const wbSemanticTopK = ctx.clampNum(wbSemantic.topK, 1, 20, 5);
  const wbSemanticAutoSync = wbSemantic.autoSyncVectors !== false;

  return `
    <!-- 世界书语义触发 -->
    <div class="settings-section">
      <h3>📖 世界书语义触发</h3>
      <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.8rem;">
        允许世界书规则使用「语义触发」——根据用户消息的语义相似度匹配，而不只是关键词。
        依赖上面的语义模型，需要先配置好。
      </p>
      <div class="setting-row">
        <label>启用语义触发</label>
        ${ctx.toggleHtml('settingsWbSemanticEnabled', wbSemanticEnabled)}
        <span class="help-text">关闭后，所有 semantic 类型的规则都不会触发</span>
      </div>
      <div class="setting-row">
        <label>全局相似度阈值</label>
        <div style="display:flex;align-items:center;gap:0.5rem;flex:1;">
          <input type="range" id="settingsWbSemanticThreshold" min="0" max="1" step="0.05" value="${wbSemanticThreshold}" style="flex:1;">
          <span id="settingsWbSemanticThresholdLabel" style="min-width:50px;font-size:0.9rem;">${wbSemanticThreshold.toFixed(2)}</span>
        </div>
        <span class="help-text">
          0.4 = 宽松（召回多），0.55 = 平衡（推荐），0.7 = 严格（召回少但精准）
        </span>
      </div>
      <div class="setting-row">
        <label>单次最多命中</label>
        <input type="number" id="settingsWbSemanticTopK" value="${wbSemanticTopK}" min="1" max="20">
        <span class="help-text">每轮对话最多触发多少条语义规则（避免一次注入过多）</span>
      </div>
      <div class="setting-row">
        <label>启动时自动同步向量</label>
        ${ctx.toggleHtml('settingsWbSemanticAutoSync', wbSemanticAutoSync)}
        <span class="help-text">应用启动时为所有语义规则生成/更新向量，切换模型时也会自动重建</span>
      </div>
      <div class="setting-row" style="gap:0.5rem;">
        <button class="btn btn-sm" id="settingsWbSyncVectorsBtn" type="button">
          <i class="fas fa-sync-alt"></i> 立即同步向量
        </button>
        <span id="wbSyncStatus" style="font-size:0.8rem;color:var(--color-text-muted);">未同步</span>
      </div>
    </div>
  `;
}

/**
 * 绑定世界书语义 section 的事件
 * @param {HTMLElement} modalContent
 * @param {Object} ctx
 */
export function bindWorldBookSemanticSection(modalContent, ctx) {
  // 阈值滑块
  const wbSemanticThresholdSlider = modalContent.querySelector('#settingsWbSemanticThreshold');
  const wbSemanticThresholdLabel = modalContent.querySelector('#settingsWbSemanticThresholdLabel');
  if (wbSemanticThresholdSlider && wbSemanticThresholdLabel) {
    wbSemanticThresholdSlider.addEventListener('input', () => {
      const val = ctx.clampNum(wbSemanticThresholdSlider.value, 0, 1, 0.55);
      wbSemanticThresholdLabel.textContent = val.toFixed(2);
    });
  }

  // 同步向量按钮
  const wbSyncVectorsBtn = modalContent.querySelector('#settingsWbSyncVectorsBtn');
  const wbSyncStatus = modalContent.querySelector('#wbSyncStatus');
  if (wbSyncVectorsBtn) {
    wbSyncVectorsBtn.addEventListener('click', async () => {
      wbSyncVectorsBtn.disabled = true;
      const originalText = wbSyncVectorsBtn.innerHTML;
      wbSyncVectorsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 同步中...';
      wbSyncStatus.textContent = '同步中...';
      wbSyncStatus.style.color = 'var(--color-text-muted)';

      try {
        const { syncWorldBookVectors } = await import('../../../../modules/worldBook.js');
        const result = await syncWorldBookVectors();
        if (result.updated === 0 && result.skipped === 0) {
          if (result.editedDuringSync > 0) {
            wbSyncStatus.textContent = `✅ 编辑跳过 ${result.editedDuringSync}`;
            wbSyncStatus.style.color = 'var(--color-success)';
          } else {
            wbSyncStatus.textContent = '⚠️ 无语义规则或引擎未就绪';
            wbSyncStatus.style.color = 'var(--color-warning)';
          }
        } else {
          const editPart = result.editedDuringSync > 0 ? `，编辑跳过 ${result.editedDuringSync}` : '';
          wbSyncStatus.textContent = `✅ 更新 ${result.updated}，跳过 ${result.skipped}${editPart}`;
          wbSyncStatus.style.color = 'var(--color-success)';
        }
      } catch (err) {
        wbSyncStatus.textContent = `❌ ${err.message}`;
        wbSyncStatus.style.color = 'var(--color-danger)';
      } finally {
        wbSyncVectorsBtn.disabled = false;
        wbSyncVectorsBtn.innerHTML = originalText;
      }
    });
  }
}