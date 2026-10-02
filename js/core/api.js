// js/core/api.js - API 适配器集成版（应用临时参数 + 模型能力检测）
import { createAdapter, adapterConfigs } from '/lib/api-adapter/index.js';
import { getStores } from './db.js';
import { getEffectiveParams } from './runtimeParams.js';

async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  // 注意：此超时只保护「建立连接 + 收到响应头」阶段（首字节超时）。
  // 一旦 await fetch() resolve（响应头到达），下方 finally 立即清除 timer，
  // 因此流式 body 的读取完全不受此超时影响——长回复不会被中途 abort。
  // （审计 P2-15：慢模型/长上下文的首字节可能超过 60s，流式路径用更长的首字节超时兜底。）
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const externalSignal = options.signal;
  let abortHandler = null;

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      abortHandler = () => controller.abort();
      externalSignal.addEventListener('abort', abortHandler, { once: true });
    }
  }

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    // 响应头已到达：立即清除首字节超时，确保流式读取期间不再受 timer 影响
    clearTimeout(timer);
    return response;
  } catch (err) {
    if (err.name === 'AbortError') {
      if (externalSignal && externalSignal.aborted) {
        const abortErr = new Error('请求已被取消');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (abortHandler && externalSignal) {
      externalSignal.removeEventListener('abort', abortHandler);
    }
  }
}

// ---------- 连通性缓存 ----------
let connectionCache = {
  result: null,
  timestamp: 0,
};

let adapterInstance = null;
let currentProvider = null;
let currentCapabilities = null;

// ============================================================
// 数值安全化工具
// ============================================================
function toFiniteNumber(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ============================================================
// 模型能力检测
// ============================================================
export function getModelCapabilities(modelName) {
  const lower = (modelName || '').toLowerCase();

  // 审计 C-2：带供应商前缀的 id（如 openai/o3-mini、anthropic/claude-4）匹配不上推理模型模式——
  // 模式的边界字符类是 [-_.]，不含 '/'，前缀与模型名之间的 '/' 断裂了匹配。
  // 先剥掉最后一段 '/' 之前的前缀，让判定只看模型名本身。
  const slashIdx = lower.lastIndexOf('/');
  const base = slashIdx >= 0 ? lower.slice(slashIdx + 1) : lower;

  const caps = {
    temperature: true,
    top_p: true,
    frequency_penalty: true,
    presence_penalty: true,
    top_k: true,
    repetition_penalty: true,
  };

  // 推理模型：不支持采样参数（temperature/top_p/penalties/top_k）。
  // 覆盖 OpenAI o 系列、DeepSeek reasoner/r1、Qwen thinking、GLM reasoning、
  // 以及带版本号/日期后缀的变体（如 o4-mini-2026-xx、deepseek-reasoner-v3.1）。
  // 审计 P2-14：原硬编码正则只认 o[134] 与 claude-4，漏掉新推理模型 → 发 sampling 参数 → 400。
  const reasoningPatterns = [
    /^o[0-9]+(?:[a-z]*)?(?:[-_.][0-9a-z.-]*)*$/i,            // o1/o3/o4/o4-mini/o4-mini-2026-xx-xx
    /(?:^|[-_.])(?:o1|o3|o4)(?:[-_.]|$)/i,                    // 任意位置带 o1/o3/o4 标识
    /deepseek[-_.]?(?:reasoner|r1)/i,                          // deepseek-reasoner / deepseek-r1 / deepseek_r1
    /(?:reasoner|reasoning|thinking|think)/i,                  // 通用推理标识
    /(?:^|[-_.])qwq(?:[-_.]|[0-9]|$)/i,                        // qwq 系列（含无 qwen 前缀的 qwq / qwq-32b）
    /qwen[0-9.]*[-_.]?(?:qwq|thinking)/i,                      // qwen-qwq / qwen*-thinking
    /glm[-_.]?[0-9.]*[-_.]?(?:reasoning|thinking)/i,           // glm reasoning/thinking
    /claude[-_.]?(?:3[-_.]?7|4)/i,                             // claude 3.7+ / claude 4 系列
    /gpt[-_.]?5/i,                                             // gpt-5（推理模型）
  ];

  // base 命中剥离前缀后的模型名；lower 兜底完整字符串（保留既有匹配能力）
  if (reasoningPatterns.some(re => re.test(base) || re.test(lower))) {
    caps.temperature = false;
    caps.top_p = false;
    caps.frequency_penalty = false;
    caps.presence_penalty = false;
    caps.top_k = false;
    // 审计 C-3：日志原写「penalties」，未说明是否含 repetition_penalty，而后者
    // 实际并未被禁用（它是厂商特定参数，由适配器的 requestMapping 决定是否发送）。
    // 改为逐项列举，让日志与实际禁用的字段完全一致。
    console.log(
      `[API] 检测到推理模型 "${modelName}"，禁用采样参数` +
      `（temperature/top_p/frequency_penalty/presence_penalty/top_k）`
    );
  }

  return caps;
}

// ---------- 获取设置 ----------
async function getSettings() {
  const stores = await getStores();
  const settings = await stores.settings.get('app_settings');
  return settings || {};
}

// ---------- 获取适配器配置 ----------
function getAdapterConfig(provider) {
  const config = adapterConfigs[provider] || adapterConfigs.openai;
  if (!config) {
    console.warn(`[API] 未知厂商 ${provider}，回退到 OpenAI`);
    return adapterConfigs.openai;
  }
  return config;
}

// ---------- 获取适配器能力 ----------
export async function fetchCapabilities(provider = null) {
  const settings = await getSettings();
  const targetProvider = provider || settings.apiProvider || 'openai';
  const config = getAdapterConfig(targetProvider);
  const tempAdapter = createAdapter(config, {
    strict: false,
    onLog: () => {},
    onError: () => {},
  });
  return tempAdapter.getCapabilities();
}

// ---------- 获取适配器 ----------
async function getAdapter() {
  const settings = await getSettings();
  const provider = settings.apiProvider || 'openai';
  if (adapterInstance && currentProvider === provider) {
    return adapterInstance;
  }

  const config = getAdapterConfig(provider);
  adapterInstance = createAdapter(config, {
    strict: false,
    onLog: (level, msg, data) => {
      if (level === 'warn') console.warn('[API]', msg, data);
      else if (level === 'error') console.error('[API]', msg, data);
      else console.debug('[API]', msg, data);
    },
    onError: ({ type, error, rawData }) => {
      console.warn('[API] 适配器错误:', { type, error, rawData });
    },
  });
  currentProvider = provider;
  currentCapabilities = adapterInstance.getCapabilities();
  return adapterInstance;
}

// ---------- 获取当前适配器能力（用于调试） ----------
export function getCurrentCapabilities() {
  return currentCapabilities || {};
}

// ---------- 重置适配器 ----------
export function resetApiAdapter() {
  adapterInstance = null;
  currentProvider = null;
  currentCapabilities = null;
}

// ---------- 构建标准请求 ----------
/**
 * 构建标准消息数组
 *
 * preserveSystemInMessages:
 *   - false（默认）：过滤 messages 内的 system 消息，systemPrompt 作为首条 system 注入
 *   - true：保留 messages 数组内的 system 消息按原位置排列
 *           （用于让注入器的 position: 'relative' / 'nested' 生效）
 *
 * 注意：即便设为 true，Anthropic / Google / Cohere 的适配器仍会把所有 system
 *       消息合并到顶层字段（厂商 API 结构限制），位置保留只对 OpenAI 兼容系列生效。
 */
function buildStandardMessages(messages, systemPrompt, preserveSystemInMessages = false) {
  const filtered = (messages || []).filter(m => {
    if (!m) return false;
    if (preserveSystemInMessages) return true;
    return m.role !== 'system';
  });
  const stdMessages = [];
  if (systemPrompt) {
    stdMessages.push({ role: 'system', content: systemPrompt });
  }
  stdMessages.push(...filtered);
  return stdMessages;
}

// ---------- 提取文本内容 ----------
function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(block => block.type === 'text')
      .map(block => block.text || '')
      .join('');
  }
  return '';
}

// ============================================================
// 统一请求入口
// ============================================================

/**
 * 构造 Google Gemini 流式请求 URL。
 *
 * 审计 B-2：旧实现把 alt=sse 嵌在 `if (replaced !== finalUrl)` 内，导致
 * 自定义 baseUrl 已含 :streamGenerateContent、或已带 alt= 时跳过 alt=sse，
 * Gemini 会返回 JSON 数组（无 data: 行）→ 零事件 → 空回复。
 * 现在两步都无条件执行：先替换方法名（若存在），再补 alt=sse（若尚未存在）。
 *
 * @param {string} url 原始 URL
 * @returns {string} 流式 URL
 */
export function buildGoogleStreamUrl(url) {
  let out = url.replace(':generateContent', ':streamGenerateContent');
  if (!out.includes('alt=')) {
    out += (out.includes('?') ? '&' : '?') + 'alt=sse';
  }
  return out;
}

export async function sendChatRequest(params) {
  const {
    messages,
    systemPrompt,
    model,
    temperature,
    maxTokens,
    stream = false,
    onChunk,
    preserveSystemInMessages = false,
    signal,
  } = params;

  const settings = await getSettings();
  const provider = settings.apiProvider || 'openai';
  const apiKey = settings.apiKey;

  const config = getAdapterConfig(provider);
  const baseUrl = settings.apiBaseUrl || config.baseUrl;
  const defaultModel = config.defaultModel || 'gpt-4o-mini';
  const modelName = model || settings.modelName || defaultModel;

  let finalUrl = baseUrl;
  if (baseUrl.includes('{model}')) {
    finalUrl = baseUrl.replace('{model}', modelName);
  }

  if (!apiKey || !apiKey.trim()) {
    throw new Error('API Key 未配置');
  }

  const effective = getEffectiveParams(settings);
  const caps = getModelCapabilities(modelName);

  const paramTemp = toFiniteNumber(temperature);
  const paramMaxTokens = toFiniteNumber(maxTokens);

  const standardReq = {
    messages: buildStandardMessages(messages, systemPrompt, preserveSystemInMessages),
    model: modelName,
    max_tokens: paramMaxTokens ?? toFiniteNumber(effective.maxTokens) ?? 4096,
    stream,
  };

  if (caps.temperature) {
    const finalTemp = paramTemp ?? toFiniteNumber(effective.temperature);
    if (finalTemp !== null) {
      standardReq.temperature = finalTemp;
    }
  }

  if (caps.top_p) {
    const finalTopP = toFiniteNumber(effective.topP);
    if (finalTopP !== null) {
      standardReq.top_p = finalTopP;
    }
  }

  if (caps.frequency_penalty) {
    const v = toFiniteNumber(effective.frequencyPenalty);
    if (v !== null) standardReq.frequency_penalty = v;
  }

  if (caps.presence_penalty) {
    const v = toFiniteNumber(effective.presencePenalty);
    if (v !== null) standardReq.presence_penalty = v;
  }

  if (caps.top_k) {
    const v = toFiniteNumber(effective.topK);
    if (v !== null) standardReq.top_k = v;
  }

  if (caps.repetition_penalty) {
    const v = toFiniteNumber(effective.repetitionPenalty);
    if (v !== null) standardReq.repetition_penalty = v;
  }

  console.debug('[API] 最终采样参数:', {
    model: modelName,
    temperature: standardReq.temperature,
    top_p: standardReq.top_p,
    max_tokens: standardReq.max_tokens,
    frequency_penalty: standardReq.frequency_penalty,
    presence_penalty: standardReq.presence_penalty,
    top_k: standardReq.top_k,
    repetition_penalty: standardReq.repetition_penalty,
    caps,
    preserveSystemInMessages,
  });

  const adapter = await getAdapter();
  const vendorReq = adapter.adaptRequest(standardReq);

  const headers = {
    'Content-Type': 'application/json',
  };

  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (provider === 'google') {
    if (stream) {
      finalUrl = buildGoogleStreamUrl(finalUrl);
    }
    if (finalUrl.includes('?')) {
      finalUrl += `&key=${apiKey}`;
    } else {
      finalUrl += `?key=${apiKey}`;
    }
  } else if (provider === 'cohere') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetchWithTimeout(finalUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(vendorReq),
    signal,
  }, stream ? 120000 : 60000);

  if (!response.ok) {
    const text = await response.text();
    let errorMsg = `API 请求失败 (${response.status}): ${text}`;
    try {
      const json = JSON.parse(text);
      if (json.error) {
        errorMsg = json.error.message || json.error || errorMsg;
      }
    } catch (_) {}
    throw new Error(errorMsg);
  }

  if (stream) {
    const streamGenerator = adapter.adaptStream(response.body, { signal });
    if (onChunk) {
      let fullContent = '';
      for await (const chunk of streamGenerator) {
        if (signal?.aborted) {
          const abortErr = new Error('请求已被取消');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          const text = delta.content;
          fullContent += text;
          onChunk(text);
        }
      }

      if (signal?.aborted) {
        const abortErr = new Error('请求已被取消');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      return { content: fullContent };
    }
    return streamGenerator;
  } else {
    const data = await response.json();
    const standardResp = adapter.adaptResponse(data);
    const rawContent = standardResp.choices?.[0]?.message?.content;
    const content = extractTextContent(rawContent);
    return { content };
  }
}

// ---------- 获取模型列表 ----------
export async function fetchModels() {
  const settings = await getSettings();
  const provider = settings.apiProvider || 'openai';
  const apiKey = settings.apiKey;
  const config = getAdapterConfig(provider);

  let baseUrl = settings.apiBaseUrl || config.baseUrl || '';
  baseUrl = baseUrl.replace(/\/chat\/completions$/, '').replace(/\/messages$/, '');
  if (provider === 'google') {
    baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  if (!apiKey || !apiKey.trim()) {
    throw new Error('API Key 未配置');
  }

  let url, headers;
  if (provider === 'anthropic') {
    url = baseUrl + '/models';
    headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  } else if (provider === 'google') {
    url = `${baseUrl}?key=${apiKey}`;
    headers = {};
  } else {
    url = baseUrl + '/models';
    headers = {
      'Authorization': `Bearer ${apiKey}`,
    };
  }

  const response = await fetchWithTimeout(url, { headers }, 30000);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`获取模型列表失败: ${response.status} ${text}`);
  }

  const data = await response.json();
  if (data && data.data && Array.isArray(data.data)) {
    return data.data.map(m => m.id).filter(id => typeof id === 'string');
  }
  if (data && data.models && Array.isArray(data.models)) {
    return data.models.map(m => m.name).filter(id => typeof id === 'string');
  }
  return [];
}

// ---------- API 连通性测试 ----------
export async function testApiConnection(force = false) {
  const now = Date.now();
  if (!force && connectionCache.result !== null && (now - connectionCache.timestamp) < 5 * 60 * 1000) {
    return connectionCache.result;
  }

  const settings = await getSettings();
  if (!settings.apiKey || !settings.apiKey.trim()) {
    connectionCache.result = false;
    connectionCache.timestamp = now;
    return false;
  }

  try {
    await fetchModels();
    connectionCache.result = true;
    connectionCache.timestamp = now;
    return true;
  } catch (error) {
    console.warn('API 连通性测试失败:', error.message);
    try {
      await sendChatRequest({
        messages: [{ role: 'user', content: 'Hi' }],
        systemPrompt: 'Reply with "OK" only.',
        temperature: 0.1,
        maxTokens: 10,
        stream: false,
      });
      connectionCache.result = true;
      connectionCache.timestamp = now;
      return true;
    } catch (e2) {
      connectionCache.result = false;
      connectionCache.timestamp = now;
      return false;
    }
  }
}

export function clearApiConnectionCache() {
  connectionCache.result = null;
  connectionCache.timestamp = 0;
}