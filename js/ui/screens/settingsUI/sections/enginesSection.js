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
  // 审计 P3-6：梦境生成默认关闭，开启后每次睡醒消耗一次 AI 调用
  const dreamEnabled = settings.dreamGeneration?.enabled === true;

  const perception = settings.emotionPerception || {};
  const semanticMode = ['off', 'auto', 'always'].includes(perception.semanticMode)
    ? perception.semanticMode
    : 'auto';
  const llmArbiter = perception.useLLMArbiter === true;

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
      <div class="setting-row">
        <label>梦境生成</label>
        ${ctx.toggleHtml('settingsDreamGeneration', dreamEnabled)}
        <span class="help-text">
          角色睡醒时用 AI 生成一段梦境（每日每角色 1 次，会消耗 API 调用）。
          关闭时不做任何调用，<code>dreamContent</code> 保持为空。
        </span>
      </div>
    </div>

    <!-- 情绪识别 -->
    <div class="settings-section">
      <h3>情绪识别</h3>
      <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:0.8rem;">
        识别分三层：<b>规则层</b>（否定与施事判定，始终启用）→ <b>语义层</b> → <b>LLM 仲裁</b>。
        规则层能区分「我不喜欢你」与「我喜欢你」、「他喜欢你」与「我喜欢你」这类写法。
      </p>
      <div class="setting-row">
        <label>语义识别</label>
        <select id="settingsEmotionSemanticMode">
          <option value="off" ${semanticMode === 'off' ? 'selected' : ''}>关闭（只用规则层）</option>
          <option value="auto" ${semanticMode === 'auto' ? 'selected' : ''}>自动（规则层拿不准时才启用）</option>
          <option value="always" ${semanticMode === 'always' ? 'selected' : ''}>总是启用（最准，每条消息都做向量计算）</option>
        </select>
        <span class="help-text">语义层复用记忆引擎的本地向量模型，离线运行、不产生 API 请求</span>
      </div>
      <div class="setting-row">
        <label>LLM 仲裁</label>
        ${ctx.toggleHtml('settingsEmotionLLMArbiter', llmArbiter)}
        <span class="help-text">仅当前两层证据冲突时调用一次 AI 裁决，而不是每条消息都调用</span>
      </div>
      <div class="setting-row">
        <label>识别调试</label>
        <button class="btn btn-sm" id="emotionDebugBtn">打开调试面板</button>
        <span class="help-text">查看子句切分、否定与施事判定、各层得分与最终结论</span>
      </div>
    </div>
  `;
}

/**
 * 绑定情绪识别调试面板入口。
 * 动态导入：面板只在用户主动打开时才加载，不影响设置页常规路径。
 * @param {HTMLElement} modalContent
 * @param {Object} ctx
 */
export function bindEnginesSection(modalContent, ctx) {
  modalContent.querySelector('#emotionDebugBtn')?.addEventListener('click', () => {
    import('../../emotionDebugUI.js')
      .then(mod => mod.openEmotionDebug())
      .catch(err => console.error('[Settings] 打开情绪识别调试面板失败:', err));
  });
}