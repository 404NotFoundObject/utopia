/**
 * @module ui/screens/settingsUI/sections/api
 * @description API 配置 section（厂商 / Key / Base URL / 模型 + 获取模型列表）
 */

import { fetchModels } from '../../../../core/api.js';
import { adapterConfigs } from '/lib/api-adapter/index.js';

/**
 * 渲染 API 配置 section
 * @param {Object} settings
 * @param {Object} ctx
 * @returns {string} HTML
 */
export function renderApiSection(settings, ctx) {
  const providers = ctx.getProviderList();
  const currentProvider = settings.apiProvider || 'openai';
  const config = adapterConfigs[currentProvider] || adapterConfigs.openai;
  const baseUrlPlaceholder = config?.baseUrl || 'https://api.openai.com/v1/chat/completions';
  const modelPlaceholder = config?.defaultModel || 'gpt-4o-mini';

  return `
    <!-- API 配置 -->
    <div class="settings-section">
      <h3>🔌 API 配置</h3>
      <div class="setting-row">
        <label>厂商</label>
        <select id="settingsProvider">
          ${providers.map(p => `
            <option value="${p.id}" ${settings.apiProvider === p.id ? 'selected' : ''}>${p.label}</option>
          `).join('')}
        </select>
      </div>
      <div class="setting-row">
        <label>API Key</label>
        <input type="password" id="settingsApiKey" value="${ctx.escapeHtml(settings.apiKey || '')}" />
      </div>
      <div class="setting-row">
        <label>API Base URL</label>
        <input type="text" id="settingsBaseUrl" value="${ctx.escapeHtml(settings.apiBaseUrl || '')}" placeholder="${ctx.escapeHtml(baseUrlPlaceholder)}" />
        <span class="help-text">留空自动使用厂商默认地址</span>
      </div>
      <div class="setting-row">
        <label>模型名称</label>
        <div style="display:flex;gap:var(--spacing-sm);flex:1;align-items:center;">
          <select id="settingsModelSelect" style="flex:1;display:none;">
            <option value="">手动输入</option>
          </select>
          <input type="text" id="settingsModelInput" value="${ctx.escapeHtml(settings.modelName || '')}" placeholder="${ctx.escapeHtml(modelPlaceholder)}" style="flex:1;" />
        </div>
      </div>
      <div class="setting-row">
        <button class="btn btn-sm" id="fetchModelsBtn"><i class="fas fa-sync-alt"></i> 获取模型列表</button>
        <span class="help-text">点击获取当前 API 厂商支持的模型列表，成功后自动切换为下拉选择</span>
      </div>
    </div>
  `;
}

/**
 * 绑定 API 配置 section 的事件
 * @param {HTMLElement} modalContent
 * @param {Object} ctx
 */
export function bindApiSection(modalContent, ctx) {
  const fetchBtn = modalContent.querySelector('#fetchModelsBtn');
  const apiModelSelect = modalContent.querySelector('#settingsModelSelect');
  const modelInput = modalContent.querySelector('#settingsModelInput');

  if (fetchBtn) {
    fetchBtn.addEventListener('click', async () => {
      try {
        fetchBtn.disabled = true;
        fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 加载中...';
        const models = await fetchModels();
        if (models && models.length > 0) {
          apiModelSelect.innerHTML = '<option value="">手动输入</option>';
          models.forEach(model => {
            const opt = document.createElement('option');
            opt.value = model;
            opt.textContent = model;
            apiModelSelect.appendChild(opt);
          });
          modelInput.style.display = 'none';
          apiModelSelect.style.display = 'block';
          const currentModel = modelInput.value.trim();
          if (currentModel) {
            const matched = Array.from(apiModelSelect.options).some(opt => opt.value === currentModel);
            apiModelSelect.value = matched ? currentModel : '';
          }
          ctx.showToast(`获取到 ${models.length} 个模型，已切换为下拉选择`, 'success');
        } else {
          ctx.showToast('未获取到模型列表，请检查 API 配置', 'warning');
        }
      } catch (err) {
        ctx.showToast('获取模型列表失败: ' + err.message, 'error');
        console.error(err);
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = '<i class="fas fa-sync-alt"></i> 获取模型列表';
      }
    });
  }

  if (apiModelSelect && modelInput) {
    apiModelSelect.addEventListener('change', () => {
      const val = apiModelSelect.value;
      if (val === '') {
        apiModelSelect.style.display = 'none';
        modelInput.style.display = 'block';
        modelInput.value = '';
        modelInput.focus();
      } else {
        modelInput.value = val;
      }
    });
  }
}