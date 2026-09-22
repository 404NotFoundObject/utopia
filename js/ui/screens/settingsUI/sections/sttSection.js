/**
 * @module ui/screens/settingsUI/sections/stt
 * @description STT 语音识别 section（提供商 / 语言 / HTTP Whisper 配置 / 连通性测试）
 */

/**
 * 渲染 STT section
 * @param {Object} settings
 * @param {Object} ctx
 * @returns {string} HTML
 */
export function renderSttSection(settings, ctx) {
  const stt = settings.stt || {};
  const sttProvider = stt.provider || 'web-speech';
  const showHttp = sttProvider === 'whisper-http';

  return `
    <!-- STT 配置 -->
    <div class="settings-section">
      <h3>🎤 STT 语音识别</h3>
      <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.8rem;">
        将语音转为文字。Web Speech API 免费但仅支持 Chromium 浏览器；HTTP Whisper 支持所有浏览器，中文准确率更高。
      </p>
      <div class="setting-row">
        <label>STT 提供商</label>
        <select id="settingsSttProvider">
          <option value="web-speech" ${sttProvider === 'web-speech' ? 'selected' : ''}>
            Web Speech API (浏览器内置，仅 Chromium)
          </option>
          <option value="whisper-http" ${sttProvider === 'whisper-http' ? 'selected' : ''}>
            HTTP Whisper (远程 API，全平台)
          </option>
        </select>
      </div>
      <div class="setting-row">
        <label>识别语言</label>
        <select id="settingsSttLanguage">
          <option value="zh-CN" ${(stt.language || 'zh-CN') === 'zh-CN' ? 'selected' : ''}>中文（简体）</option>
          <option value="zh-TW" ${stt.language === 'zh-TW' ? 'selected' : ''}>中文（繁体）</option>
          <option value="en-US" ${stt.language === 'en-US' ? 'selected' : ''}>English (US)</option>
          <option value="ja-JP" ${stt.language === 'ja-JP' ? 'selected' : ''}>日本語</option>
          <option value="ko-KR" ${stt.language === 'ko-KR' ? 'selected' : ''}>한국어</option>
        </select>
      </div>

      <div id="sttHttpSection" style="${showHttp ? '' : 'display:none;'}">
        <div class="setting-row">
          <label>Whisper API URL</label>
          <input type="text" id="settingsSttHttpUrl"
                 value="${ctx.escapeHtml(stt.httpUrl || '')}"
                 placeholder="http://localhost:8000/v1/audio/transcriptions">
          <span class="help-text">支持 OpenAI Whisper API 兼容接口（faster-whisper 等）</span>
        </div>
        <div class="setting-row">
          <label>API Key（可选）</label>
          <input type="password" id="settingsSttHttpApiKey"
                 value="${ctx.escapeHtml(stt.httpApiKey || '')}"
                 placeholder="留空表示本地服务无需鉴权">
        </div>
        <div class="setting-row">
          <label>模型名称</label>
          <input type="text" id="settingsSttHttpModel"
                 value="${ctx.escapeHtml(stt.httpModel || 'whisper-1')}"
                 placeholder="whisper-1">
          <span class="help-text">大多数服务端忽略此字段，实际以启动服务时指定的模型为准</span>
        </div>
        <div class="setting-row" style="gap:0.5rem;">
          <button class="btn btn-sm" id="settingsSttTestBtn" type="button">
            <i class="fas fa-plug"></i> 测试连通性
          </button>
          <span id="sttTestStatus" style="font-size:0.8rem;color:var(--color-text-muted);">未测试</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * 绑定 STT section 的事件
 * @param {HTMLElement} modalContent
 * @param {Object} ctx
 */
export function bindSttSection(modalContent, ctx) {
  const sttProviderSelect = modalContent.querySelector('#settingsSttProvider');
  const sttHttpSection = modalContent.querySelector('#sttHttpSection');
  const sttTestBtn = modalContent.querySelector('#settingsSttTestBtn');
  const sttTestStatus = modalContent.querySelector('#sttTestStatus');

  // 提供商切换
  if (sttProviderSelect && sttHttpSection) {
    sttProviderSelect.addEventListener('change', () => {
      const isHttp = sttProviderSelect.value === 'whisper-http';
      sttHttpSection.style.display = isHttp ? '' : 'none';
    });
  }

  // 连通性测试
  if (sttTestBtn) {
    sttTestBtn.addEventListener('click', async () => {
      sttTestBtn.disabled = true;
      const originalText = sttTestBtn.innerHTML;
      sttTestBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 测试中...';
      sttTestStatus.textContent = '测试中...';
      sttTestStatus.style.color = 'var(--color-text-muted)';

      try {
        const url = modalContent.querySelector('#settingsSttHttpUrl')?.value.trim() || '';
        const apiKey = modalContent.querySelector('#settingsSttHttpApiKey')?.value.trim() || '';
        const model = modalContent.querySelector('#settingsSttHttpModel')?.value.trim() || 'whisper-1';
        const language = modalContent.querySelector('#settingsSttLanguage')?.value || 'zh-CN';

        if (!url) {
          sttTestStatus.textContent = '❌ 请先填写 API URL';
          sttTestStatus.style.color = 'var(--color-danger)';
          return;
        }

        // 先更新设置，让 sttService 能读到最新配置
        const currentSettings = ctx.getSettings();
        const { updateSettings } = await import('../../../../modules/settings.js');
        await updateSettings({
          stt: {
            ...(currentSettings.stt || {}),
            provider: 'whisper-http',
            language,
            httpUrl: url,
            httpApiKey: apiKey,
            httpModel: model,
            httpTimeout: 30000,
          },
        });

        const { testHttpSttConnection } = await import('../../../../services/sttService.js');
        const result = await testHttpSttConnection();

        if (result.ok) {
          sttTestStatus.textContent = '✅ 连接成功';
          sttTestStatus.style.color = 'var(--color-success)';
        } else {
          sttTestStatus.textContent = `❌ ${result.error || '失败'}`;
          sttTestStatus.style.color = 'var(--color-danger)';
        }
      } catch (err) {
        sttTestStatus.textContent = `❌ ${err.message}`;
        sttTestStatus.style.color = 'var(--color-danger)';
      } finally {
        sttTestBtn.disabled = false;
        sttTestBtn.innerHTML = originalText;
      }
    });
  }
}