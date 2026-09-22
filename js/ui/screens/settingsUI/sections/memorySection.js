/**
 * @module ui/screens/settingsUI/sections/memorySection
 * @description 长期记忆 section（检索模式 / 语义模型 / dtype / 自动下载 / 记忆阈值）
 *
 * 涉及动态加载：
 *   - 支持模型列表：memory.getSupportedModels
 *   - 本地模型检查：memory.checkLocalModel
 *   - 模型下载：memory.downloadModel
 *   - dtype 探测：memory.detectAvailableDtypes
 *   - dtype 缓存清理：memory.clearDtypeCache
 *
 */

/**
 * 渲染长期记忆 section
 */
export function renderMemorySection(settings, ctx) {
  const memoryScoreThreshold = ctx.clampNum(settings.memoryScoreThreshold, 0, 1, 0.55);

  return `
    <!-- 长期记忆 -->
    <div class="settings-section">
      <h3>🧠 长期记忆</h3>
      <div class="setting-row">
        <label>检索模式</label>
        <select id="settingsRetrievalMode">
          <option value="keyword" ${settings.retrievalMode === 'keyword' ? 'selected' : ''}>全文检索（关键词）</option>
          <option value="semantic" ${settings.retrievalMode === 'semantic' ? 'selected' : ''}>语义检索（向量）</option>
          <option value="hybrid" ${settings.retrievalMode === 'hybrid' ? 'selected' : ''}>混合检索</option>
        </select>
      </div>
      <div class="setting-row">
        <label>语义模型</label>
        <div style="display:flex;gap:var(--spacing-sm);flex-wrap:wrap;align-items:center;">
          <select id="settingsSemanticModel" style="flex:1;min-width:200px;">
            <option value="">无（使用全文检索）</option>
          </select>
          <button class="btn btn-sm" id="checkModelBtn">检查模型</button>
          <button class="btn btn-sm" id="downloadModelBtn">下载模型</button>
          <span id="modelStatus" style="font-size:0.8rem;color:var(--color-text-muted);">未检测</span>
        </div>
        <span class="help-text">选择语义模型，需先下载到本地</span>
      </div>
      <div class="setting-row">
        <label>精度（dtype）</label>
        <div style="display:flex;gap:var(--spacing-sm);flex-wrap:wrap;align-items:center;">
          <select id="settingsSemanticDtype" style="flex:1;min-width:200px;" disabled>
            <option value="">请先选择模型</option>
          </select>
          <button class="btn btn-sm" id="refreshDtypeBtn">
            <i class="fas fa-sync-alt"></i> 刷新
          </button>
          <span id="dtypeStatus" style="font-size:0.8rem;color:var(--color-text-muted);">未检测</span>
        </div>
        <span class="help-text">
          fp32 精度最高但体积大，q8 体积最小速度最快。不同模型可用的精度取决于本地文件。
        </span>
      </div>
      <div class="setting-row">
        <label>自动下载模型</label>
        ${ctx.toggleHtml('settingsAutoDownload', settings.autoDownloadModels)}
        <span class="help-text">若本地无模型，启动时自动下载（需联网）</span>
      </div>
      <div class="setting-row">
        <label>记忆检索阈值</label>
        <div style="display:flex;align-items:center;gap:0.5rem;flex:1;">
          <input type="range" id="settingsMemoryScoreThreshold" min="0" max="1" step="0.05" value="${memoryScoreThreshold}" style="flex:1;">
          <span id="settingsMemoryScoreThresholdLabel" style="min-width:50px;font-size:0.9rem;">${memoryScoreThreshold.toFixed(2)}</span>
        </div>
        <span class="help-text">
          记忆检索的相似度门槛。0.4 = 宽松（召回多），0.55 = 平衡（推荐），0.7 = 严格（精准）。
          仅影响长期记忆召回，与世界书语义触发独立。
        </span>
      </div>
    </div>
  `;
}

/**
 * 绑定长期记忆 section 的事件
 *
 * ★ 返回 Promise：在所有异步初始化完成后 resolve
 *
 * @param {HTMLElement} modalContent
 * @param {Object} ctx
 * @returns {Promise<void>}
 */
export function bindMemorySection(modalContent, ctx) {
  const modelSelect = modalContent.querySelector('#settingsSemanticModel');
  const modelStatus = modalContent.querySelector('#modelStatus');
  const checkBtn = modalContent.querySelector('#checkModelBtn');
  const downloadBtn = modalContent.querySelector('#downloadModelBtn');
  const dtypeSelect = modalContent.querySelector('#settingsSemanticDtype');
  const dtypeStatus = modalContent.querySelector('#dtypeStatus');
  const refreshDtypeBtn = modalContent.querySelector('#refreshDtypeBtn');

  /**
   * 从 __restoreSnapshot 中取某个字段的恢复值（读后即删）
   * @param {string} id - 元素 id
   * @returns {string} 恢复值，或 ''
   */
  function consumeRestoredValue(id) {
    const snapshot = modalContent.__restoreSnapshot;
    if (!snapshot || !snapshot[id]) return '';
    const value = snapshot[id].value;
    delete snapshot[id];
    return value || '';
  }

  // ============================================================
  // 内部函数：加载语义模型列表
  // ============================================================
  async function populateModels() {
    try {
      const { getSupportedModels } = await import('../../../../modules/memory.js');
      const models = await getSupportedModels();
      modelSelect.innerHTML = '<option value="">无（使用全文检索）</option>';
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        modelSelect.appendChild(opt);
      }

      // ★ 回归修复：优先用用户未保存的修改值
      const restoredModel = consumeRestoredValue('settingsSemanticModel');
      const targetModel = restoredModel || ctx.getSettings()?.semanticModelId || '';
      if (targetModel) {
        modelSelect.value = targetModel;
      }
    } catch (e) {
      console.warn('[Settings/Memory] 加载语义模型列表失败:', e);
    }
  }

  // ============================================================
  // 内部函数：探测 dtype 选项
  // ============================================================
  async function refreshDtypeOptions() {
    if (!dtypeSelect) return;

    // 保存当前 DOM 值（用于重填后恢复）
    const previousDomValue = dtypeSelect.value;

    const modelId = modelSelect ? modelSelect.value : '';
    if (!modelId) {
      dtypeSelect.innerHTML = '<option value="">请先选择模型</option>';
      dtypeSelect.disabled = true;
      if (dtypeStatus) {
        dtypeStatus.textContent = '请先选择模型';
        dtypeStatus.style.color = 'var(--color-text-muted)';
      }
      return;
    }

    dtypeSelect.disabled = false;
    dtypeSelect.innerHTML = '<option value="">检测中...</option>';
    if (dtypeStatus) {
      dtypeStatus.textContent = '检测中...';
      dtypeStatus.style.color = 'var(--color-text-muted)';
    }

    try {
      const { detectAvailableDtypes, getDtypeLabel } = await import('../../../../modules/memory.js');
      const available = await detectAvailableDtypes(modelId);

      if (available.length === 0) {
        dtypeSelect.innerHTML = '<option value="">使用模型默认</option>';
        if (dtypeStatus) {
          dtypeStatus.textContent = '本地无可用模型文件';
          dtypeStatus.style.color = 'var(--color-danger)';
        }
        return;
      }

      dtypeSelect.innerHTML = '<option value="">使用模型默认</option>';
      for (const dtype of available) {
        const opt = document.createElement('option');
        opt.value = dtype;
        opt.textContent = getDtypeLabel(dtype);
        dtypeSelect.appendChild(opt);
      }

      const restoredDtype = consumeRestoredValue('settingsSemanticDtype');
      const preferred = restoredDtype || previousDomValue || ctx.getSettings()?.semanticDtype || '';

      if (preferred && available.includes(preferred)) {
        dtypeSelect.value = preferred;
      }

      if (dtypeStatus) {
        dtypeStatus.textContent = `本地可用: ${available.length} 种`;
        dtypeStatus.style.color = 'var(--color-text-muted)';
      }
    } catch (e) {
      console.error('[Settings/Memory] 探测 dtype 失败:', e);
      dtypeSelect.innerHTML = '<option value="">使用模型默认</option>';
      if (dtypeStatus) {
        dtypeStatus.textContent = '检测失败';
        dtypeStatus.style.color = 'var(--color-danger)';
      }
    }
  }

  // ============================================================
  // 事件绑定
  // ============================================================

  if (checkBtn) {
    checkBtn.addEventListener('click', async () => {
      const modelId = modelSelect.value;
      if (!modelId) { modelStatus.textContent = '未选择模型'; return; }
      const { checkLocalModel } = await import('../../../../modules/memory.js');
      const exists = await checkLocalModel(modelId);
      modelStatus.textContent = exists ? '✅ 本地已存在' : '❌ 本地不存在';
      modelStatus.style.color = exists ? 'var(--color-success)' : 'var(--color-danger)';
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      const modelId = modelSelect.value;
      if (!modelId) { ctx.showToast('请先选择模型', 'warning'); return; }
      const { downloadModel } = await import('../../../../modules/memory.js');
      try {
        downloadBtn.disabled = true;
        downloadBtn.textContent = '下载中...';
        await downloadModel(modelId);
        modelStatus.textContent = '✅ 下载完成';
        modelStatus.style.color = 'var(--color-success)';
        ctx.showToast('模型下载成功', 'success');
      } catch (e) {
        modelStatus.textContent = '❌ 下载失败';
        modelStatus.style.color = 'var(--color-danger)';
        ctx.showToast('下载失败: ' + e.message, 'error');
      } finally {
        downloadBtn.disabled = false;
        downloadBtn.textContent = '下载模型';
      }
    });
  }

  if (refreshDtypeBtn) {
    refreshDtypeBtn.addEventListener('click', async () => {
      try {
        const { clearDtypeCache } = await import('../../../../modules/memory.js');
        clearDtypeCache();
      } catch (_) {}
      await refreshDtypeOptions();
    });
  }

  if (modelSelect) {
    modelSelect.addEventListener('change', refreshDtypeOptions);
  }

  const memScoreSlider = modalContent.querySelector('#settingsMemoryScoreThreshold');
  const memScoreLabel = modalContent.querySelector('#settingsMemoryScoreThresholdLabel');
  if (memScoreSlider && memScoreLabel) {
    memScoreSlider.addEventListener('input', () => {
      const val = ctx.clampNum(memScoreSlider.value, 0, 1, 0.55);
      memScoreLabel.textContent = val.toFixed(2);
    });
  }

  // ============================================================
  // 返回异步初始化 Promise
  // ============================================================
  const readyPromise = (async () => {
    await populateModels();
    await new Promise(r => setTimeout(r, 100));
    try {
      if (modelSelect && modelSelect.value) {
        await refreshDtypeOptions();
      } else if (dtypeStatus) {
        dtypeStatus.textContent = '请先选择模型';
      }
    } catch (e) {
      console.warn('[Settings/Memory] 初始 dtype 探测失败:', e);
    }
  })();

  return readyPromise;
}