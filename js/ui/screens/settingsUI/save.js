/**
 * @module ui/screens/settingsUI/save
 * @description 设置保存逻辑（从 DOM 统一抓值 + 校验 + updateSettings + 时间系统）
 *
 */

import { fetchCapabilities } from '../../../core/api.js';
import { applyTheme } from '../../layout/theme.js';
import { setTimeSpeed, setTimePaused } from '../../../modules/time.js';
import { updateSettings } from '../../../modules/settings.js';
import { clampNum } from './shared.js';

export function bindSaveButton(modalContent, ctx) {
  const saveBtn = modalContent.querySelector('#saveSettingsBtn');
  if (!saveBtn) return;

  saveBtn.addEventListener('click', () => {
    handleSave(modalContent, ctx);
  });
}

async function handleSave(modalContent, ctx) {
  // ============================================================
  // 0. 检测每个 section 是否渲染
  // ============================================================
  const has = (sel) => modalContent.querySelector(sel) !== null;

  const sections = {
    user:                has('#settingsUserName'),
    theme:               has('#settingsThemeSelect'),
    api:                 has('#settingsProvider'),
    modelParams:         has('#settingsTemperature'),
    tokenBudget:         has('#settingsTokenBudgetEnabled'),
    conversationState:   has('#settingsCsEnabled'),
    time:                has('#settingsTimeSpeed'),
    engines:             has('#settingsEngineEmotion'),
    memory:              has('#settingsRetrievalMode'),
    worldBookSemantic:   has('#settingsWbSemanticEnabled'),
    summary:             has('#settingsSummaryEnabled'),
    context:             has('#settingsContextMode'),
    tts:                 has('#settingsTtsProvider'),
    stt:                 has('#settingsSttProvider'),
    proactive:           has('#settingsProactiveEnabled'),
  };

  // ============================================================
  // 1. 从 DOM 抓取所有字段值
  // ============================================================
  const q = (sel) => modalContent.querySelector(sel);

  // ---- 用户信息 ----
  const userName = q('#settingsUserName')?.value.trim() || '';
  const avatarPreview = q('#settingsAvatarPreview');
  const avatarSrc = (avatarPreview && avatarPreview.src && !avatarPreview.src.startsWith('data:image/svg+xml'))
    ? avatarPreview.src
    : '';

  // ---- 主题 ----
  const themeSelect = q('#settingsThemeSelect');
  const selectedTheme = themeSelect ? themeSelect.value : 'light';

  // ---- API ----
  const provider = q('#settingsProvider')?.value || 'openai';
  const apiKey = q('#settingsApiKey')?.value.trim() || '';
  const baseUrl = q('#settingsBaseUrl')?.value.trim() || '';
  const modelInput = q('#settingsModelInput');
  const model = modelInput ? modelInput.value.trim() : '';

  // ---- 模型参数 ----
  const temp = clampNum(q('#settingsTemperature')?.value, 0, 2, 0.7);
  const topP = clampNum(q('#settingsTopP')?.value, 0, 1, 1.0);
  const maxTokens = clampNum(q('#settingsMaxTokens')?.value, 1, 32768, 4096);

  const frequencyPenalty = clampNum(q('#settings_frequencyPenalty')?.value, -2, 2, 0);
  const presencePenalty = clampNum(q('#settings_presencePenalty')?.value, -2, 2, 0);
  const topK = clampNum(q('#settings_topK')?.value, 0, 200, 0);
  const repetitionPenalty = clampNum(q('#settings_repetitionPenalty')?.value, 1, 2, 1.0);

  // ---- 引擎 ----
  const useLLMEmotion = q('#settingsUseLLMEmotion')?.checked ?? false;
  const engineEmotion = q('#settingsEngineEmotion')?.checked ?? true;
  const engineBody = q('#settingsEngineBody')?.checked ?? true;
  const engineTime = q('#settingsEngineTime')?.checked ?? true;

  // ---- 时间系统 ----
  const speedSelect = q('#settingsTimeSpeed');
  const pausedCheck = q('#settingsTimePaused');

  // ---- 长期记忆 ----
  const retrievalMode = q('#settingsRetrievalMode')?.value || 'keyword';
  const semanticModelSelect = q('#settingsSemanticModel');
  const semanticModelId = semanticModelSelect ? semanticModelSelect.value : '';
  const dtypeSelect = q('#settingsSemanticDtype');
  const semanticDtype = dtypeSelect ? dtypeSelect.value : '';
  const autoDownloadModels = q('#settingsAutoDownload')?.checked ?? false;
  const memoryScoreThresholdVal = clampNum(q('#settingsMemoryScoreThreshold')?.value, 0, 1, 0.55);

  // ---- 世界书语义 ----
  const wbSemanticEnabledVal = q('#settingsWbSemanticEnabled')?.checked ?? true;
  const wbSemanticThresholdVal = clampNum(q('#settingsWbSemanticThreshold')?.value, 0, 1, 0.55);
  const wbSemanticTopKVal = clampNum(q('#settingsWbSemanticTopK')?.value, 1, 20, 5);
  const wbSemanticAutoSyncVal = q('#settingsWbSemanticAutoSync')?.checked ?? true;

  // ---- 摘要 ----
  const summaryEnabled = q('#settingsSummaryEnabled')?.checked ?? true;
  const summaryFrequency = clampNum(q('#settingsSummaryFrequency')?.value, 3, 50, 10);
  const summaryMaxLength = clampNum(q('#settingsSummaryMaxLength')?.value, 50, 500, 200);

  // ---- 上下文模式 ----
  const contextMode = q('#settingsContextMode')?.value || 'smart';

  // ---- Token 预算 ----
  const tbEnabledVal = q('#settingsTokenBudgetEnabled')?.checked ?? true;
  const tbContextModeVal = q('#settingsTokenBudgetContextMode')?.value || 'auto';
  const tbManualWindowVal = clampNum(q('#settingsTokenBudgetManualWindow')?.value, 1024, 2000000, 8192);
  const tbReserveVal = clampNum(q('#settingsTokenBudgetReserve')?.value, 128, 8192, 1024);
  const tbAllocSystemVal = clampNum(q('#settingsTbAllocSystem')?.value, 0, 1, 0.4);
  const tbAllocHistoryVal = clampNum(q('#settingsTbAllocHistory')?.value, 0, 1, 0.4);
  const tbAllocMemoryVal = clampNum(q('#settingsTbAllocMemory')?.value, 0, 1, 0.1);
  const tbAllocSummaryVal = clampNum(q('#settingsTbAllocSummary')?.value, 0, 1, 0.1);
  const tbStrategyVal = q('#settingsTokenBudgetStrategy')?.value || 'drop_lowest';
  const tbWbBudgetRatioVal = clampNum(q('#settingsWbBudgetRatioSlider')?.value, 0, 0.5, 0.3);

  // ---- LLM 裁决 / 会话状态 ----
  const llmArbiterEnabledVal = q('#settingsLlmArbiter')?.checked ?? true;
  const csEnabledVal = q('#settingsCsEnabled')?.checked ?? true;
  const csCrossDayVal = q('#settingsCsCrossDay')?.checked ?? true;
  const csTransitionVal = q('#settingsCsTransition')?.checked ?? true;

  // ---- TTS ----
  const ttsProviderSelect = q('#settingsTtsProvider');
  const ttsProvider = ttsProviderSelect?.value || 'web-speech';
  const ttsKokoroUrl = q('#settingsTtsKokoroUrl')?.value || '';
  const ttsKokoroModel = q('#settingsTtsKokoroModel')?.value || '';
  const ttsKokoroKey = q('#settingsTtsKokoroKey')?.value || '';
  const voiceSelect = q('#settingsTtsDefaultVoice');
  const ttsDefaultVoice = voiceSelect?.value || '';
  const ttsDefaultSpeed = clampNum(q('#settingsTtsDefaultSpeed')?.value, 0.1, 10, 1.0);
  const ttsDefaultPitch = clampNum(q('#settingsTtsDefaultPitch')?.value, 0, 2, 1.0);
  const ttsAutoSpeak = q('#settingsTtsAutoSpeak')?.checked ?? true;

  // ---- STT ----
  const sttProviderVal = q('#settingsSttProvider')?.value || 'web-speech';
  const sttLanguage = q('#settingsSttLanguage')?.value || 'zh-CN';
  const sttHttpUrl = q('#settingsSttHttpUrl')?.value.trim() || '';
  const sttHttpApiKey = q('#settingsSttHttpApiKey')?.value.trim() || '';
  const sttHttpModel = q('#settingsSttHttpModel')?.value.trim() || 'whisper-1';

  // ---- 主动对话 ----
  const proactiveEnabledVal = q('#settingsProactiveEnabled')?.checked ?? true;
  const proactiveMinIdle = clampNum(q('#settingsProactiveMinIdle')?.value, 1, 72, 6);
  const proactiveMaxPerCycle = clampNum(q('#settingsProactiveMaxPerCycle')?.value, 1, 5, 2);
  const proactiveCooldown = clampNum(q('#settingsProactiveCooldown')?.value, 1, 168, 24);
  const proactiveChanceVoice = clampNum(q('#settingsProactiveChanceVoice')?.value, 0, 100, 30) / 100;

  // ============================================================
  // 2. 校验：引擎关闭确认
  // ============================================================
  const closedEngines = [];
  if (!engineEmotion) closedEngines.push('情感引擎');
  if (!engineBody) closedEngines.push('身体状态引擎');
  if (!engineTime) closedEngines.push('时间系统');

  if (sections.engines && closedEngines.length > 0) {
    const msg = `您关闭了以下引擎：${closedEngines.join('、')}。\n关闭后可能会导致角色互动失去真实感，例如：\n- 情感引擎关闭：角色将没有情绪变化\n- 身体状态引擎关闭：角色不会疲劳或生病\n- 时间系统关闭：游戏时间将停止流动\n\n确定要继续吗？`;
    if (!confirm(msg)) return;
  }

  // ============================================================
  // 3. 校验：Token 分配比例
  // ============================================================
  const allocSum = tbAllocSystemVal + tbAllocHistoryVal + tbAllocMemoryVal + tbAllocSummaryVal;
  if (sections.tokenBudget && Math.abs(allocSum - 1.0) > 0.1) {
    if (!confirm(`Token 预算的分配比例之和为 ${allocSum.toFixed(2)}，与 1.0 偏差较大。确定继续吗？`)) return;
  }

  // ============================================================
  // 4. 组装 payload（只包含已渲染 section 的字段）
  // ============================================================
  const payload = {};

  if (sections.user) {
    payload.user = { name: userName, avatar: avatarSrc };
  }

  if (sections.api) {
    payload.apiProvider = provider;
    payload.apiKey = apiKey;
    payload.apiBaseUrl = baseUrl || undefined;
    payload.modelName = model;
  }

  if (sections.modelParams) {
    payload.temperature = temp;
    payload.topP = topP;
    payload.maxTokens = maxTokens;
    payload.frequencyPenalty = frequencyPenalty;
    payload.presencePenalty = presencePenalty;
    payload.topK = topK;
    payload.repetitionPenalty = repetitionPenalty;
  }

  if (sections.engines) {
    payload.useLLMForEmotion = useLLMEmotion;
    payload.engineFlags = {
      emotion: engineEmotion,
      bodyState: engineBody,
      time: engineTime,
    };
  }

  if (sections.memory) {
    payload.retrievalMode = retrievalMode;
    payload.semanticModelId = semanticModelId;
    payload.semanticDtype = semanticDtype;
    payload.autoDownloadModels = autoDownloadModels;
    payload.memoryScoreThreshold = memoryScoreThresholdVal;
  }

  if (sections.worldBookSemantic) {
    payload.worldBookSemantic = {
      enabled: wbSemanticEnabledVal,
      threshold: wbSemanticThresholdVal,
      topK: wbSemanticTopKVal,
      autoSyncVectors: wbSemanticAutoSyncVal,
    };
  }

  if (sections.summary) {
    payload.summaryEnabled = summaryEnabled;
    payload.summaryFrequency = summaryFrequency;
    payload.summaryMaxLength = summaryMaxLength;
  }
  if (sections.context) {
    payload.contextMode = contextMode;
  }

  if (sections.tokenBudget) {
    payload.tokenBudget = {
      enabled: tbEnabledVal,
      contextWindowMode: tbContextModeVal,
      manualContextWindow: tbManualWindowVal,
      reserveForGeneration: tbReserveVal,
      allocation: {
        system: tbAllocSystemVal,
        history: tbAllocHistoryVal,
        memory: tbAllocMemoryVal,
        summary: tbAllocSummaryVal,
      },
      strategy: tbStrategyVal,
      worldBookBudgetRatio: tbWbBudgetRatioVal,
    };
  }

  if (sections.conversationState) {
    payload.llmArbiter = {
      enabled: llmArbiterEnabledVal,
    };
    payload.conversationState = {
      enabled: csEnabledVal,
      crossDayEnabled: csCrossDayVal,
      transitionEnabled: csTransitionVal,
    };
  }

  if (sections.tts) {
    payload.tts = {
      provider: ttsProvider,
      defaultVoice: ttsDefaultVoice,
      defaultSpeed: ttsDefaultSpeed,
      defaultPitch: ttsDefaultPitch,
      kokoroUrl: ttsKokoroUrl,
      kokoroModel: ttsKokoroModel,
      kokoroApiKey: ttsKokoroKey,
      autoSpeak: ttsAutoSpeak,
    };
  }

  if (sections.stt) {
    payload.stt = {
      provider: sttProviderVal,
      language: sttLanguage,
      httpUrl: sttHttpUrl,
      httpApiKey: sttHttpApiKey,
      httpModel: sttHttpModel,
      httpTimeout: 30000,
    };
  }

  if (sections.proactive) {
    payload.proactiveChat = {
      enabled: proactiveEnabledVal,
      minIdleGameHours: proactiveMinIdle,
      minIdleRealMinutes: 20,
      checkInterval: 60000,
      maxPerCycle: proactiveMaxPerCycle,
      cooldownGameHours: proactiveCooldown,
      chanceVoice: proactiveChanceVoice,
    };
  }

  // ============================================================
  // 5. 执行保存
  // ============================================================
  try {
    if (sections.api) {
      try {
        payload.capabilities = await fetchCapabilities(provider);
      } catch (e) {
        console.warn('[Settings/Save] fetchCapabilities 失败，清空 capabilities:', e);
        payload.capabilities = null;
      }
    }

    if (sections.theme) {
      applyTheme(selectedTheme);
    }

    await updateSettings(payload);

    if (sections.time) {
      if (speedSelect) {
        const speed = parseInt(speedSelect.value);
        await setTimeSpeed(speed);
      }
      if (pausedCheck) {
        await setTimePaused(pausedCheck.checked);
      }
    }

    document.getElementById('modalOverlay').classList.add('hidden');
    ctx.showToast('设置已保存', 'success');
  } catch (err) {
    ctx.showToast('保存失败: ' + err.message, 'error');
  }
}