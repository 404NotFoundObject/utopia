/**
 * @module ui/screens/settingsUI/sections/ttsSection
 * @description TTS 语音合成 section（提供商 / Kokoro 配置 / 默认音色 / 语速音调 / 自动朗读）
 *
 * 动态加载：
 *   - 音色列表：ttsService.getVoicesGroupedByLanguage
 *   - 测试音色：ttsService.testVoice
 *
 */

/**
 * 渲染 TTS section
 */
export function renderTtsSection(settings, ctx) {
  const tts = settings.tts || {};
  const ttsProvider = tts.provider || 'web-speech';
  const renderTtsSpeed = ctx.clampNum(tts.defaultSpeed, 0.1, 10, 1.0);
  const renderTtsPitch = ctx.clampNum(tts.defaultPitch, 0, 2, 1.0);
  const showKokoro = ttsProvider !== 'web-speech';

  return `
    <!-- TTS 配置 -->
    <div class="settings-section">
      <h3>🔊 TTS 语音合成</h3>
      <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.8rem;">
        为角色语音通话配置语音合成引擎。支持 Web Speech API (Edge TTS) 和 Kokoro。
      </p>
      <div class="setting-row">
        <label>TTS 提供商</label>
        <select id="settingsTtsProvider">
          <option value="web-speech" ${ttsProvider === 'web-speech' ? 'selected' : ''}>
            Web Speech API (Edge TTS，免费，开箱即用)
          </option>
          <option value="kokoro" ${ttsProvider === 'kokoro' ? 'selected' : ''}>
            Kokoro (本地/自托管，更强大)
          </option>
          <option value="custom" ${ttsProvider === 'custom' ? 'selected' : ''}>
            自定义 OpenAI 兼容 API
          </option>
        </select>
      </div>
      <div class="setting-row" id="ttsKokoroSettings" style="${showKokoro ? '' : 'display:none;'}">
        <label>Kokoro API URL</label>
        <input type="text" id="settingsTtsKokoroUrl" value="${ctx.escapeHtml(tts.kokoroUrl || 'http://localhost:8880/v1/audio/speech')}" placeholder="http://localhost:8880/v1/audio/speech">
      </div>
      <div class="setting-row" id="ttsKokoroModelRow" style="${showKokoro ? '' : 'display:none;'}">
        <label>模型名称</label>
        <input type="text" id="settingsTtsKokoroModel" value="${ctx.escapeHtml(tts.kokoroModel || 'kokoro-v0.19')}" placeholder="kokoro-v0.19">
      </div>
      <div class="setting-row" id="ttsKokoroKeyRow" style="${showKokoro ? '' : 'display:none;'}">
        <label>API Key (可选)</label>
        <input type="password" id="settingsTtsKokoroKey" value="${ctx.escapeHtml(tts.kokoroApiKey || '')}" placeholder="可选">
      </div>
      <div class="setting-row">
        <label>默认音色</label>
        <div class="tts-voice-controls" style="display:flex;gap:0.5rem;flex:1;align-items:center;flex-wrap:wrap;">
          <select id="settingsTtsDefaultVoice" style="flex:1;min-width:150px;">
            <option value="">系统默认</option>
          </select>
          <button class="btn btn-sm" id="settingsTtsRefreshVoicesBtn"><i class="fas fa-sync-alt"></i> 刷新</button>
          <button class="btn btn-sm" id="settingsTtsTestVoiceBtn"><i class="fas fa-play"></i> 测试</button>
        </div>
        <span class="help-text">选择默认音色，角色可单独配置</span>
      </div>
      <div class="setting-row">
        <label>默认语速</label>
        <input type="number" id="settingsTtsDefaultSpeed" step="0.1" min="0.1" max="10" value="${renderTtsSpeed}">
        <span class="help-text">0.1 ~ 10，1.0 为正常语速</span>
      </div>
      <div class="setting-row">
        <label>默认音调</label>
        <input type="number" id="settingsTtsDefaultPitch" step="0.05" min="0" max="2" value="${renderTtsPitch}">
        <span class="help-text">0 ~ 2，1.0 为正常音调</span>
      </div>
      <div class="setting-row">
        <label>通话中自动语音</label>
        ${ctx.toggleHtml('settingsTtsAutoSpeak', tts.autoSpeak !== false)}
        <span class="help-text">语音通话中自动朗读角色消息</span>
      </div>
    </div>
  `;
}

/**
 * 绑定 TTS section 的事件
 *
 * ★ 返回 Promise：在音色列表加载完成后 resolve
 *
 * @param {HTMLElement} modalContent
 * @param {Object} ctx
 * @returns {Promise<void>}
 */
export function bindTtsSection(modalContent, ctx) {
  const ttsProviderSelect = modalContent.querySelector('#settingsTtsProvider');
  const ttsKokoroSettings = modalContent.querySelector('#ttsKokoroSettings');
  const ttsKokoroModelRow = modalContent.querySelector('#ttsKokoroModelRow');
  const ttsKokoroKeyRow = modalContent.querySelector('#ttsKokoroKeyRow');
  const voiceSelect = modalContent.querySelector('#settingsTtsDefaultVoice');
  const refreshBtn = modalContent.querySelector('#settingsTtsRefreshVoicesBtn');
  const testBtnVoice = modalContent.querySelector('#settingsTtsTestVoiceBtn');

  /**
   * 从 __restoreSnapshot 中取某个字段的恢复值（读后即删）
   */
  function consumeRestoredValue(id) {
    const snapshot = modalContent.__restoreSnapshot;
    if (!snapshot || !snapshot[id]) return '';
    const value = snapshot[id].value;
    delete snapshot[id];
    return value || '';
  }

  // ============================================================
  // 内部函数：加载音色列表
  // ============================================================
  async function populateTtsVoices() {
    if (!voiceSelect) return;
    try {
      const { getVoicesGroupedByLanguage } = await import('../../../../services/ttsService.js');
      const groups = await getVoicesGroupedByLanguage();

      // ★ 目标音色优先级：
      //   1. 用户未保存的修改值（restore 场景）
      //   2. 当前 DOM 值（"刷新"按钮场景）
      //   3. settings.tts.defaultVoice（首次打开场景）
      const restoredVoice = consumeRestoredValue('settingsTtsDefaultVoice');
      const settings = ctx.getSettings();
      const targetVoice = restoredVoice
        || voiceSelect.value
        || settings?.tts?.defaultVoice
        || '';

      voiceSelect.innerHTML = '<option value="">系统默认</option>';

      for (const [lang, voices] of Object.entries(groups)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = lang.toUpperCase();

        for (const v of voices) {
          const option = document.createElement('option');
          option.value = v.name;
          const langShort = v.lang.split('-')[0].slice(0, 2);
          const genderEmoji = v.gender === 'female' ? '♀' : v.gender === 'male' ? '♂' : '⚥';
          let displayName = v.name;
          if (displayName.length > 20) displayName = displayName.slice(0, 18) + '…';
          option.textContent = `${displayName} (${langShort}) ${genderEmoji}`;
          if (v.name === targetVoice) option.selected = true;
          optgroup.appendChild(option);
        }
        voiceSelect.appendChild(optgroup);
      }

      // 兜底：某些浏览器 option.selected 设置后 value 未同步
      if (targetVoice) {
        voiceSelect.value = targetVoice;
      }
    } catch (e) {
      console.warn('[Settings/TTS] 加载音色分组失败:', e);
    }
  }

  // ============================================================
  // 事件绑定
  // ============================================================

  if (ttsProviderSelect) {
    ttsProviderSelect.addEventListener('change', () => {
      const showKokoro = ttsProviderSelect.value !== 'web-speech';
      if (ttsKokoroSettings) ttsKokoroSettings.style.display = showKokoro ? '' : 'none';
      if (ttsKokoroModelRow) ttsKokoroModelRow.style.display = showKokoro ? '' : 'none';
      if (ttsKokoroKeyRow) ttsKokoroKeyRow.style.display = showKokoro ? '' : 'none';
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      populateTtsVoices().then(() => {
        ctx.showToast('✅ 音色列表已刷新', 'success');
      });
    });
  }

  if (testBtnVoice && voiceSelect) {
    testBtnVoice.addEventListener('click', async () => {
      const voiceName = voiceSelect.value;
      if (!voiceName) {
        ctx.showToast('请先选择一个音色', 'warning');
        return;
      }
      try {
        const { testVoice } = await import('../../../../services/ttsService.js');
        await testVoice(voiceName, '你好，世界！这是一次语音合成测试。');
        ctx.showToast('🔊 正在播放测试语音...', 'info');
      } catch (e) {
        ctx.showToast('❌ 测试失败: ' + e.message, 'error');
      }
    });
  }

  // ============================================================
  // 返回异步初始化 Promise
  // ============================================================
  const readyPromise = (async () => {
    await new Promise(r => setTimeout(r, 100));
    await populateTtsVoices();
  })();

  return readyPromise;
}