// js/core/runtimeParams.js
// 运行时临时参数管理。只维护内存状态，不依赖任何业务模块。

const tempParams = {
  temperature: null,
  topP: null,
  maxTokens: null,
  frequencyPenalty: null,
  presencePenalty: null,
  topK: null,
  repetitionPenalty: null,
};

export function getEffectiveParams(settings) {
  const s = settings || {};
  return {
    temperature: tempParams.temperature ?? s.temperature,
    topP: tempParams.topP ?? s.topP,
    maxTokens: tempParams.maxTokens ?? s.maxTokens,
    frequencyPenalty: tempParams.frequencyPenalty ?? s.frequencyPenalty,
    presencePenalty: tempParams.presencePenalty ?? s.presencePenalty,
    topK: tempParams.topK ?? s.topK,
    repetitionPenalty: tempParams.repetitionPenalty ?? s.repetitionPenalty,
  };
}

export function getTempParams() {
  return { ...tempParams };
}

export function setTempParam(key, value) {
  if (!(key in tempParams)) {
    throw new Error(`[RuntimeParams] 未知参数: ${key}`);
  }
  tempParams[key] = value;
}

export function resetTempParams() {
  for (const key of Object.keys(tempParams)) {
    tempParams[key] = null;
  }
}