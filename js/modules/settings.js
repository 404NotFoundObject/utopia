// js/modules/settings.js - 设置数据管理（开源版：已移除备份/邮件相关字段）
import { getStores } from '../core/db.js';
import { getAppState } from '../core/state.js';
import { clearApiConnectionCache, resetApiAdapter } from '../core/api.js';
import { showToast } from '../ui/components/toast.js';
import globalEventBus from '../core/eventBus.js';

let _stores = null;
async function getS() {
  if (!_stores) _stores = await getStores();
  return _stores;
}

export async function loadSettings() {
  const stores = await getS();
  let settings = await stores.settings.get('app_settings');
  if (!settings) {
    settings = getDefaultSettings();
    await stores.settings.add(settings);
  } else {
    // ★ 迁移：补齐新增字段
    const defaults = getDefaultSettings();
    let needUpdate = false;

    if (!settings.tokenBudget) {
      settings.tokenBudget = defaults.tokenBudget;
      needUpdate = true;
    }
    if (!settings.llmArbiter) {
      settings.llmArbiter = defaults.llmArbiter;
      needUpdate = true;
    }
    if (!settings.conversationState) {
      settings.conversationState = defaults.conversationState;
      needUpdate = true;
    }

    if (settings.memoryScoreThreshold === undefined) {
      const legacyThreshold = settings.worldBookSemantic?.threshold;
      const migrated = (typeof legacyThreshold === 'number' && Number.isFinite(legacyThreshold))
        ? legacyThreshold
        : defaults.memoryScoreThreshold;
      settings.memoryScoreThreshold = migrated;
      needUpdate = true;
      console.log(
        `[Settings] 迁移记忆检索阈值: memoryScoreThreshold = ${migrated}` +
        `（来源：${legacyThreshold !== undefined ? 'worldBookSemantic.threshold' : '默认值'}）`
      );
    }

    if (needUpdate) {
      settings.updatedAt = Date.now();
      await stores.settings.update('app_settings', settings);
    }
  }
  const state = getAppState();
  state.set('settings', settings);
  return settings;
}

export async function updateSettings(updates) {
  const state = getAppState();
  const current = state.get('settings');
  if (!current) {
    await loadSettings();
    return updateSettings(updates);
  }
  const stores = await getS();
  const updated = { ...current, ...updates, updatedAt: Date.now() };
  await stores.settings.update('app_settings', updated);
  state.set('settings', updated);

  clearApiConnectionCache();
  resetApiAdapter();

  globalEventBus.emit('settings:updated', {
    oldSettings: current,
    newSettings: updated,
    timestamp: Date.now(),
  });

  showToast('设置已保存', 'success');
  return updated;
}

export function getDefaultSettings() {
  return {
    id: 'app_settings',
    apiProvider: 'openai',
    apiKey: '',
    apiBaseUrl: 'https://api.openai.com/v1',
    modelName: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 4096,
    topP: 1.0,
    capabilities: null,
    frequencyPenalty: 0,
    presencePenalty: 0,
    topK: 0,
    repetitionPenalty: 1.0,
    user: { name: '用户', avatar: '' },
    useLLMForEmotion: false,
    engineFlags: {
      emotion: true,
      bodyState: true,
      time: true,
    },
    retrievalMode: 'keyword',
    semanticModelId: '',
    semanticDtype: '',
    autoDownloadModels: false,

    memoryScoreThreshold: 0.55,
    summaryEnabled: true,
    summaryFrequency: 10,
    summaryMaxLength: 200,
    contextMode: 'smart',

    // 世界书语义触发配置
    worldBookSemantic: {
      enabled: true,
      threshold: 0.55,
      topK: 5,
      autoSyncVectors: true,
    },

    tokenBudget: {
      enabled: true,
      contextWindowMode: 'auto',        // 'auto' | 'manual'
      manualContextWindow: 8192,
      reserveForGeneration: 1024,
      allocation: {
        system: 0.4,
        history: 0.4,
        memory: 0.1,
        summary: 0.1,
      },
      strategy: 'drop_lowest',          // 'drop_lowest' | 'truncate_longest' | 'summary_oldest'
      worldBookBudgetRatio: 0.3,
    },

    // ★★★ 新增：LLM 裁决开关 ★★★
    llmArbiter: {
      enabled: true,                    // 是否允许调用 LLM 做场景裁决
    },

    // ★★★ 新增：会话状态与转场 ★★★
    conversationState: {
      enabled: true,                    // 总开关
      crossDayEnabled: true,            // 跨天感知
      transitionEnabled: true,          // 场景转场
    },

    serviceFlags: {
      backup: false,
      mail: false,
    },
    tts: {
      provider: 'web-speech',
      defaultVoice: '',
      defaultSpeed: 1.0,
      defaultPitch: 1.0,
      kokoroUrl: 'http://localhost:8880/v1/audio/speech',
      kokoroModel: 'kokoro-v0.19',
      kokoroApiKey: '',
      autoSpeak: true,
    },
    stt: {
      provider: 'web-speech',
      language: 'zh-CN',
      httpUrl: '',
      httpApiKey: '',
      httpModel: 'whisper-1',
      httpTimeout: 30000,
    },
    proactiveChat: {
      enabled: true,
      minIdleGameHours: 6,
      minIdleRealMinutes: 20,
      checkInterval: 60000,
      maxPerCycle: 2,
      cooldownGameHours: 24,
      chanceVoice: 0.3,
    },
    updatedAt: Date.now(),
  };
}