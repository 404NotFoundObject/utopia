/**
 * @module ui/screens/settingsUI/sections/proactive
 * @description 主动对话 section（启用 / 空闲阈值 / 触发数 / 冷却 / 语音概率 / 立即检测）
 *
 * 涉及动态加载：
 *   - 立即检测：proactiveChat.runProactiveCheck
 */

/**
 * 渲染主动对话 section
 * @param {Object} settings
 * @param {Object} ctx
 * @returns {string} HTML
 */
export function renderProactiveSection(settings, ctx) {
  const proactive = settings.proactiveChat || {};
  const proactiveEnabled = proactive.enabled !== false;
  const proactiveMinIdle = ctx.clampNum(proactive.minIdleGameHours, 1, 72, 6);
  const proactiveMaxPerCycle = ctx.clampNum(proactive.maxPerCycle, 1, 5, 2);
  const proactiveCooldown = ctx.clampNum(proactive.cooldownGameHours, 1, 168, 24);
  const voiceChance = Math.round(ctx.clampNum(proactive.chanceVoice, 0, 1, 0.3) * 100);

  return `
    <!-- 主动对话配置 -->
    <div class="settings-section">
      <h3>💬 主动对话</h3>
      <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.8rem;">
        角色会主动找您聊天或发起语音通话，增强陪伴感。
      </p>
      <div class="setting-row">
        <label>启用主动对话</label>
        ${ctx.toggleHtml('settingsProactiveEnabled', proactiveEnabled)}
        <span class="help-text">关闭后角色不会主动联系您</span>
      </div>
      <div class="setting-row">
        <label>空闲阈值（游戏小时）</label>
        <input type="number" id="settingsProactiveMinIdle" value="${proactiveMinIdle}" min="1" max="72">
        <span class="help-text">角色至少多久未互动才会主动联系</span>
      </div>
      <div class="setting-row">
        <label>单次最多触发数</label>
        <input type="number" id="settingsProactiveMaxPerCycle" value="${proactiveMaxPerCycle}" min="1" max="5">
        <span class="help-text">每轮扫描最多触发几个角色</span>
      </div>
      <div class="setting-row">
        <label>角色冷却（游戏小时）</label>
        <input type="number" id="settingsProactiveCooldown" value="${proactiveCooldown}" min="1" max="168">
        <span class="help-text">同一角色主动后再次触发的冷却时间</span>
      </div>
      <div class="setting-row">
        <label>语音触发概率</label>
        <div style="display:flex;align-items:center;gap:0.5rem;flex:1;">
          <input type="range" id="settingsProactiveChanceVoice" min="0" max="100" value="${voiceChance}" style="flex:1;">
          <span id="settingsProactiveChanceVoiceLabel" style="min-width:40px;font-size:0.9rem;">${voiceChance}%</span>
        </div>
        <span class="help-text">触发语音通话的概率（0% = 仅发消息，100% = 总是语音）</span>
      </div>
      <div class="setting-row" style="gap:0.5rem;">
        <button class="btn btn-sm" id="settingsProactiveTestBtn" style="background:var(--color-secondary);color:#fff;">
          <i class="fas fa-play"></i> 立即检测
        </button>
        <span class="help-text">手动触发一次主动对话扫描（测试用）</span>
      </div>
    </div>
  `;
}

/**
 * 绑定主动对话 section 的事件
 * @param {HTMLElement} modalContent
 * @param {Object} ctx
 */
export function bindProactiveSection(modalContent, ctx) {
  // 语音概率滑块
  const chanceSlider = modalContent.querySelector('#settingsProactiveChanceVoice');
  const chanceLabel = modalContent.querySelector('#settingsProactiveChanceVoiceLabel');
  if (chanceSlider && chanceLabel) {
    chanceSlider.addEventListener('input', () => {
      chanceLabel.textContent = chanceSlider.value + '%';
    });
  }

  // 立即检测
  const testBtn = modalContent.querySelector('#settingsProactiveTestBtn');
  if (testBtn) {
    testBtn.addEventListener('click', () => {
      import('../../../../modules/proactiveChat.js').then(({ runProactiveCheck }) => {
        runProactiveCheck().then(() => {
          ctx.showToast('✅ 主动对话检测已执行', 'success');
        }).catch(err => {
          ctx.showToast('❌ 检测失败: ' + err.message, 'error');
        });
      });
    });
  }
}