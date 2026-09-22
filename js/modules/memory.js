// js/modules/memory.js - 长期记忆管理（Transformers.js v3 + dtype 可选 + 世界书语义支持）
import { getStores } from '../core/db.js';
import { generateUUID } from '../core/utils.js';
import { getAppState } from '../core/state.js';
import { showToast } from '../ui/components/toast.js';

// ============================================================
// 全文检索
// ============================================================
let miniSearch = null;
let isMiniSearchReady = false;
let miniSearchInitPromise = null;

// ============================================================
// 语义检索
// ============================================================
let embedder = null;
let isVectorReady = false;
let vectorData = [];
let vectorCacheLoaded = false;
let vectorCacheLoadingPromise = null;
let semanticModelName = '';
let _engineInitLock = Promise.resolve();

// ============================================================
// 状态
// ============================================================
let retrievalMode = 'keyword';
let backgroundInitDone = false;
let initPromise = null;

// ============================================================
// 模型缓存
// ============================================================
const MODEL_CACHE_KEY = 'utopia_model_cache';
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;

function getModelCacheStatus(modelId) {
  try {
    const cache = JSON.parse(localStorage.getItem(MODEL_CACHE_KEY) || '{}');
    const entry = cache[modelId];
    if (entry && Date.now() - entry.timestamp < MODEL_CACHE_TTL_MS) {
      return entry;
    }
    return null;
  } catch { return null; }
}

function setModelCacheStatus(modelId, exists) {
  try {
    const cache = JSON.parse(localStorage.getItem(MODEL_CACHE_KEY) || '{}');
    cache[modelId] = { exists, timestamp: Date.now() };
    localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function clearModelCacheStatus(modelId) {
  try {
    const cache = JSON.parse(localStorage.getItem(MODEL_CACHE_KEY) || '{}');
    delete cache[modelId];
    localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

// ============================================================
// dtype 探测缓存（MINOR-3）
// ============================================================
// detectAvailableDtypes 会对每个 dtype 发一次 HEAD 请求。
// 在本地模型场景下，每次 HEAD 都是 FS 调用；8 个 dtype 就是 8 次。
// 本缓存按 modelId 分组，TTL 1 小时（与模型存在性缓存一致）。
// 空数组也会被缓存，避免对不存在的模型反复发请求。
// ============================================================
const _dtypeCache = new Map(); // modelId -> { dtypes: string[], timestamp: number }
const DTYPE_CACHE_TTL_MS = 60 * 60 * 1000;

function getCachedDtypes(modelId) {
  const entry = _dtypeCache.get(modelId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp >= DTYPE_CACHE_TTL_MS) {
    _dtypeCache.delete(modelId);
    return null;
  }
  return entry.dtypes;
}

function setCachedDtypes(modelId, dtypes) {
  _dtypeCache.set(modelId, {
    dtypes: Array.isArray(dtypes) ? dtypes.slice() : [],
    timestamp: Date.now(),
  });
}

/**
 * 清除 dtype 探测缓存
 * @param {string} [modelId] - 指定模型 ID；不传则清空所有
 */
export function clearDtypeCache(modelId) {
  if (modelId) {
    _dtypeCache.delete(modelId);
    console.log(`[Memory] 已清除 dtype 缓存: ${modelId}`);
  } else {
    _dtypeCache.clear();
    console.log('[Memory] 已清空所有 dtype 缓存');
  }
}

// ============================================================
// 超时工具
// ============================================================
function withTimeout(promise, ms, label = '操作') {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

// ============================================================
// 空值工具
// ============================================================
function isValidText(text) {
  return text !== null && text !== undefined && typeof text === 'string' && text.trim() !== '';
}

// ============================================================
// 记忆检索阈值
// ============================================================
const DEFAULT_MEMORY_SCORE_THRESHOLD = 0.55;

function getMemoryScoreThreshold() {
  try {
    const settings = getAppState().get('settings') || {};
    const t = settings.memoryScoreThreshold;
    const n = typeof t === 'number' ? t : parseFloat(t);
    return Number.isFinite(n) ? n : DEFAULT_MEMORY_SCORE_THRESHOLD;
  } catch (_) {
    return DEFAULT_MEMORY_SCORE_THRESHOLD;
  }
}

// ============================================================
// dtype 元数据
// ============================================================
const DTYPE_FILE_MAP = {
  'fp32':  'model.onnx',
  'fp16':  'model_fp16.onnx',
  'q8':    'model_quantized.onnx',
  'int8':  'model_int8.onnx',
  'uint8': 'model_uint8.onnx',
  'q4':    'model_q4.onnx',
  'q4f16': 'model_q4f16.onnx',
  'bnb4':  'model_bnb4.onnx',
};

const DTYPE_LABELS = {
  'fp32':  'fp32（完整精度）',
  'fp16':  'fp16（半精度）',
  'q8':    'q8（8位量化，推荐）',
  'int8':  'int8（8位量化）',
  'uint8': 'uint8（无符号8位量化）',
  'q4':    'q4（4位量化，体积最小）',
  'q4f16': 'q4f16（4位+fp16混合）',
  'bnb4':  'bnb4（bitsandbytes 4位）',
};

const DTYPE_PRIORITY = ['fp32', 'fp16', 'q8', 'int8', 'uint8', 'q4', 'q4f16', 'bnb4'];

export function getDtypeLabel(dtype) {
  return DTYPE_LABELS[dtype] || dtype;
}

export function getAllDtypes() {
  return DTYPE_PRIORITY.slice();
}

// ============================================================
// 支持模型列表
// ============================================================
const SUPPORTED_MODELS = [
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    name: 'all-MiniLM-L6-v2 (英文, 80MB)',
    type: 'english',
    dtype: 'q8',
  },
  {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    name: 'paraphrase-multilingual-MiniLM-L12-v2 (多语言, 235MB)',
    type: 'multilingual',
    dtype: 'q8',
  },
];

export async function getSupportedModels() {
  return SUPPORTED_MODELS;
}

function getDefaultDtype(modelId) {
  const entry = SUPPORTED_MODELS.find(m => m.id === modelId);
  return entry ? entry.dtype : 'q8';
}

export function getEffectiveDtype(modelId) {
  const settings = getAppState().get('settings') || {};
  const userDtype = settings.semanticDtype;
  if (userDtype && DTYPE_FILE_MAP[userDtype]) {
    return userDtype;
  }
  return getDefaultDtype(modelId);
}

// ============================================================
// 检测本地可用 dtype
// ============================================================
export async function detectAvailableDtypes(modelId) {
  // 1. 命中内存缓存
  const cached = getCachedDtypes(modelId);
  if (cached !== null) {
    console.log(`[Memory] ${modelId} dtype 列表命中缓存:`, cached);
    return cached;
  }

  const modelName = modelId.split('/')[1] || modelId;
  const basePath = `/lib/models/${modelName}/onnx`;

  const tasks = DTYPE_PRIORITY.map(async (dtype) => {
    const fileName = DTYPE_FILE_MAP[dtype];
    try {
      const res = await fetch(`${basePath}/${fileName}`, { method: 'HEAD' });
      return res.ok ? dtype : null;
    } catch {
      return null;
    }
  });

  const results = await Promise.all(tasks);
  const available = results.filter(d => d !== null);
  console.log(`[Memory] ${modelName} 本地可用 dtype:`, available);

  // 2. 写入缓存（空数组也缓存，避免对不存在的模型反复发 HEAD）
  setCachedDtypes(modelId, available);

  return available;
}

// ============================================================
// 检测本地模型（带缓存）
// ============================================================
export async function checkLocalModel(modelId) {
  const cached = getModelCacheStatus(modelId);
  if (cached && cached.exists === true) return true;

  const available = await detectAvailableDtypes(modelId);
  const exists = available.length > 0;
  setModelCacheStatus(modelId, exists);
  if (exists) {
    console.log(`[Memory] 本地模型存在: ${modelId}`);
  } else {
    console.warn(`[Memory] 本地模型不存在: ${modelId}`);
  }
  return exists;
}

// ============================================================
// 下载模型
// ============================================================
export async function downloadModel(modelId, onProgress) {
  const { env } = await import('/lib/transformers.min.js');
  const originalAllowRemote = env.allowRemoteModels;
  const originalAllowLocal = env.allowLocalModels;
  env.allowRemoteModels = true;
  env.allowLocalModels = false;
  try {
    const { pipeline } = await import('/lib/transformers.min.js');
    const dtype = getEffectiveDtype(modelId);
    console.log(`[Memory] 从远程下载模型: ${modelId} (dtype=${dtype})`);
    const temp = await withTimeout(
      pipeline('feature-extraction', modelId, {
        pooling: 'mean',
        normalize: true,
        dtype,
        device: 'wasm',
      }),
      10 * 60 * 1000,
      '模型下载'
    );
    env.allowRemoteModels = originalAllowRemote;
    env.allowLocalModels = originalAllowLocal;
    setModelCacheStatus(modelId, true);
    // 下载后 dtype 列表可能变化（例如从 0 到全量），主动清缓存
    clearDtypeCache(modelId);
    return true;
  } catch (e) {
    console.error('[Memory] 模型下载失败:', e);
    env.allowRemoteModels = originalAllowRemote;
    env.allowLocalModels = originalAllowLocal;
    throw e;
  }
}

// ============================================================
// 初始化语义引擎（链式锁串行化）
// ============================================================
export async function initSemanticEngine(modelId) {
  if (isVectorReady && semanticModelName === modelId) return;

  const prevLock = _engineInitLock;
  let releaseLock;
  _engineInitLock = new Promise(r => { releaseLock = r; });

  try {
    await prevLock;

    if (isVectorReady && semanticModelName === modelId) return;

    const isSwitchingModel = semanticModelName && semanticModelName !== modelId;
    if (isSwitchingModel) {
      console.log(`[Memory] 切换语义模型: ${semanticModelName} → ${modelId}，清空向量缓存`);
      vectorData = [];
      vectorCacheLoaded = false;
      vectorCacheLoadingPromise = null;
      isVectorReady = false;
      embedder = null;
    }

    try {
      const { pipeline, env } = await import('/lib/transformers.min.js');

      env.localModelPath = '/lib/models/';
      env.allowRemoteModels = false;
      env.allowLocalModels = true;

      try {
        if (env.backends?.onnx?.wasm) {
          env.backends.onnx.wasm.wasmPaths = '/lib/ort/';
        }
      } catch (_) {}

      const modelName = modelId.split('/')[1] || modelId;
      const dtype = getEffectiveDtype(modelId);

      console.log(`[Memory] 加载模型: ${modelName} (dtype=${dtype}, device=wasm)`);

      embedder = await withTimeout(
        pipeline('feature-extraction', modelName, {
          pooling: 'mean',
          normalize: true,
          dtype,
          device: 'wasm',
        }),
        60 * 1000,
        `模型加载 (${modelId})`
      );

      semanticModelName = modelId;
      await loadVectorsFromDB();
      isVectorReady = true;
      console.log(`[Memory] 语义引擎初始化成功，模型: ${modelId} (dtype=${dtype})`);
      setModelCacheStatus(modelId, true);
    } catch (e) {
      console.warn('[Memory] 语义引擎初始化失败:', e);
      isVectorReady = false;
      embedder = null;
      semanticModelName = '';
      clearModelCacheStatus(modelId);
      vectorData = [];
      vectorCacheLoaded = false;
      throw e;
    }
  } finally {
    releaseLock();
  }
}

// ============================================================
// 加载向量数据
// ============================================================
async function loadVectorsFromDB() {
  if (vectorCacheLoaded) return;
  if (vectorCacheLoadingPromise) return vectorCacheLoadingPromise;

  vectorCacheLoadingPromise = (async () => {
    const stores = await getStores();
    const allMemories = await stores.memories.getAll();
    const currentModel = semanticModelName;

    if (embedder && allMemories.length > 0) {
      let needUpdate = false;
      let regenerated = 0;
      let skipped = 0;
      let invalid = 0;

      for (const mem of allMemories) {
        if (!isValidText(mem.userMessage)) {
          invalid++;
          if (mem.vector || mem.vectorModel) {
            try {
              await stores.memories.update(mem.id, {
                ...mem,
                vector: null,
                vectorModel: null,
              });
            } catch (_) {}
          }
          continue;
        }

        const needRegenerate = !mem.vector || mem.vectorModel !== currentModel;

        if (needRegenerate) {
          try {
            const vec = await embedder(mem.userMessage, { pooling: 'mean', normalize: true });
            mem.vector = Array.from(vec.data);
            mem.vectorModel = currentModel;
            await stores.memories.update(mem.id, mem);
            needUpdate = true;
            regenerated++;
          } catch (e) {
            console.warn('[Memory] 生成向量失败:', mem.id, e);
            skipped++;
            continue;
          }
        }

        if (mem.vector) {
          vectorData.push({
            id: mem.id,
            vector: mem.vector,
            vectorModel: mem.vectorModel || currentModel,
            doc: mem,
          });
        }
      }

      if (needUpdate) {
        console.log(`[Memory] 已重建 ${regenerated} 条记忆向量（模型切换或缺失），跳过 ${skipped} 条`);
      }
      if (invalid > 0) {
        console.warn(`[Memory] 跳过 ${invalid} 条 userMessage 为空的无效记忆（已清理其向量）`);
      }
      console.log(`[Memory] 已加载 ${vectorData.length} 条记忆向量 (model=${currentModel})`);
    } else if (allMemories.length === 0) {
      console.log('[Memory] 无记忆数据，向量索引为空');
    } else {
      console.log('[Memory] embedder 未就绪，跳过向量加载');
    }

    vectorCacheLoaded = true;
  })();

  try {
    await vectorCacheLoadingPromise;
  } finally {
    vectorCacheLoadingPromise = null;
  }
}

// ============================================================
// 向量检索
// ============================================================
async function searchVectors(query, characterId, limit = 5) {
  if (!embedder || !isVectorReady) return [];
  if (vectorData.length === 0) return [];
  if (!isValidText(query)) return [];

  const queryVec = await embedder(query, { pooling: 'mean', normalize: true });
  const qVec = queryVec.data;
  const currentModel = semanticModelName;
  const scoreThreshold = getMemoryScoreThreshold();

  const scores = vectorData
    .filter(item =>
      item.doc.characterId === characterId &&
      item.vectorModel === currentModel &&
      isValidText(item.doc.userMessage)
    )
    .map(item => {
      const sim = cosineSimilarity(qVec, item.vector);
      return { ...item, score: sim };
    })
    .filter(item => item.score > scoreThreshold)
    .sort((a, b) => b.score - a.score);

  return scores.slice(0, limit).map(item => item.doc);
}

// ============================================================
// 余弦相似度
// ============================================================
function cosineSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a.length !== b.length) {
    console.warn(`[Memory] cosineSimilarity 维度不匹配: a=${a.length}, b=${b.length}，返回 0`);
    return 0;
  }
  let dot = 0, na = 0, nb = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ============================================================
// 关键词检索
// ============================================================
function keywordSearch(query, characterId, limit = 5) {
  if (!miniSearch || !isMiniSearchReady) return [];
  if (!isValidText(query)) return [];
  try {
    const results = miniSearch.search(query, {
      filter: (doc) => doc.characterId === characterId,
      includeFields: ['userMessage', 'assistantMessage', 'timestamp'],
    });
    return results.slice(0, limit).map(r => r);
  } catch (e) {
    console.warn('[Memory] MiniSearch 搜索失败:', e);
    return [];
  }
}

// ============================================================
// 混合检索
// ============================================================
async function hybridSearch(characterId, query, limit = 5) {
  const keywordResults = keywordSearch(query, characterId, limit * 2);
  const semanticResults = await searchVectors(query, characterId, limit * 2);
  const merged = [...keywordResults, ...semanticResults];
  const seen = new Set();
  const unique = [];
  for (const doc of merged) {
    if (!seen.has(doc.id)) {
      seen.add(doc.id);
      unique.push(doc);
    }
  }
  return unique.slice(0, limit);
}

// ============================================================
// 主搜索接口
// ============================================================
export async function searchMemories(characterId, query, limit = 5) {
  const settings = getAppState().get('settings');
  const mode = settings?.retrievalMode || 'keyword';
  if (!isValidText(query)) return [];

  if (mode === 'semantic' && isVectorReady) {
    return await searchVectors(query, characterId, limit);
  } else if (mode === 'hybrid' && isVectorReady && isMiniSearchReady) {
    return await hybridSearch(characterId, query, limit);
  } else {
    return keywordSearch(query, characterId, limit);
  }
}

// ============================================================
// 添加记忆
// ============================================================
export async function addMemory(characterId, userMessage, assistantMessage) {
  const stores = await getStores();

  const hasValidUserMessage = isValidText(userMessage);
  if (!hasValidUserMessage) {
    console.warn('[Memory] addMemory: userMessage 为空，跳过向量生成');
  }

  const entry = {
    id: generateUUID(),
    characterId,
    userMessage: hasValidUserMessage ? userMessage : '',
    assistantMessage: assistantMessage || '',
    timestamp: Date.now(),
  };

  if (hasValidUserMessage && isVectorReady && embedder) {
    try {
      const vec = await embedder(userMessage, { pooling: 'mean', normalize: true });
      entry.vector = Array.from(vec.data);
      entry.vectorModel = semanticModelName;
    } catch (e) {
      console.warn('[Memory] 生成向量失败', e);
    }
  }

  await stores.memories.add(entry);

  if (entry.vector) {
    vectorData.push({
      id: entry.id,
      vector: entry.vector,
      vectorModel: entry.vectorModel,
      doc: entry,
    });
  }

  if (miniSearch && isMiniSearchReady) {
    try {
      miniSearch.add(entry);
    } catch (e) {
      console.warn('[Memory] MiniSearch.add 失败:', e);
    }
  } else {
    try {
      await initMiniSearch();
    } catch (e) {
      console.warn('[Memory] initMiniSearch 失败:', e);
    }
  }

  const all = await stores.memories.getByIndex('characterId', characterId);
  if (all.length > 500) {
    const sorted = all.sort((a, b) => a.timestamp - b.timestamp);
    const toDelete = sorted.slice(0, all.length - 500);
    for (const old of toDelete) {
      await stores.memories.delete(old.id);
      if (miniSearch && isMiniSearchReady) {
        try {
          miniSearch.remove(old);
        } catch (e) {
          console.warn('[Memory] 移除索引失败:', e);
        }
      }
      vectorData = vectorData.filter(item => item.id !== old.id);
    }
  }
}

// ============================================================
// 更新记忆中的用户消息
// ============================================================
export async function updateMemoriesByUserMessage(characterId, oldText, newText) {
  if (!oldText || !newText || oldText === newText) return 0;
  if (!isValidText(newText)) return 0;

  const stores = await getStores();
  const memories = await stores.memories.getByIndex('characterId', characterId);
  let updated = 0;

  for (const mem of memories) {
    if (mem.userMessage !== oldText) continue;

    const originalMem = mem;
    const updatedMem = { ...mem, userMessage: newText };

    let newVector = null;
    let newVectorModel = null;
    let needVectorRemoval = false;

    if (isVectorReady && embedder) {
      try {
        const vec = await embedder(newText, { pooling: 'mean', normalize: true });
        newVector = Array.from(vec.data);
        newVectorModel = semanticModelName;
        updatedMem.vector = newVector;
        updatedMem.vectorModel = newVectorModel;
      } catch (e) {
        console.warn('[Memory] 编辑后重新生成向量失败，清除旧向量:', e);
        delete updatedMem.vector;
        delete updatedMem.vectorModel;
        needVectorRemoval = true;
      }
    } else {
      delete updatedMem.vector;
      delete updatedMem.vectorModel;
      needVectorRemoval = true;
    }

    await stores.memories.update(mem.id, updatedMem);

    if (newVector) {
      const item = vectorData.find(v => v.id === mem.id);
      if (item) {
        item.vector = newVector;
        item.vectorModel = newVectorModel;
        item.doc.userMessage = newText;
      }
    } else if (needVectorRemoval) {
      vectorData = vectorData.filter(v => v.id !== mem.id);
    }

    if (miniSearch && isMiniSearchReady) {
      try {
        miniSearch.remove(originalMem);
        miniSearch.add(updatedMem);
      } catch (e) {
        console.warn('[Memory] 更新 MiniSearch 索引失败:', e);
      }
    }

    updated++;
  }

  if (updated > 0) {
    console.log(`[Memory] 已更新 ${updated} 条关联记忆`);
  }
  return updated;
}

// ============================================================
// 初始化 MiniSearch
// ============================================================
export async function initMiniSearch() {
  if (isMiniSearchReady) return miniSearch;
  if (miniSearchInitPromise) return miniSearchInitPromise;

  miniSearchInitPromise = (async () => {
    const stores = await getStores();
    const allMemories = await stores.memories.getAll();

    if (typeof MiniSearch === 'undefined') {
      console.warn('[Memory] MiniSearch 库未加载');
      return null;
    }

    try {
      miniSearch = new MiniSearch({
        fields: ['userMessage'],
        storeFields: ['id', 'characterId', 'userMessage', 'assistantMessage', 'timestamp'],
        searchOptions: {
          boost: { userMessage: 2 },
          fuzzy: 0.2,
          prefix: true,
        },
        tokenize: (text) => {
          if (!text) return [];
          const whitespaceTokens = text.split(/[\s,，。！？；：、.]+/).filter(t => t.length > 0);
          const result = new Set(whitespaceTokens);
          const chineseChars = text.match(/[\u4e00-\u9fa5a-zA-Z0-9]+/g) || [];
          for (const token of chineseChars) {
            for (let i = 0; i < token.length; i++) {
              const ch = token[i];
              if (ch.trim()) result.add(ch);
            }
            for (let i = 0; i < token.length - 1; i++) {
              const pair = token[i] + token[i + 1];
              if (pair.trim()) result.add(pair);
            }
            if (token.length > 1) result.add(token);
          }
          return Array.from(result);
        },
      });

      const validMemories = allMemories.filter(m => isValidText(m.userMessage));
      if (validMemories.length > 0) {
        miniSearch.addAll(validMemories);
      }
      isMiniSearchReady = true;
      console.log(`[Memory] MiniSearch 索引已加载，共 ${validMemories.length} 条记忆（跳过 ${allMemories.length - validMemories.length} 条无效）`);
    } catch (e) {
      console.error('[Memory] MiniSearch 初始化失败:', e);
      miniSearch = null;
    } finally {
      miniSearchInitPromise = null;
    }
    return miniSearch;
  })();

  return miniSearchInitPromise;
}

// ============================================================
// 后台初始化语义引擎
// ============================================================
async function initSemanticInBackground() {
  try {
    const settings = getAppState().get('settings');
    const modelId = settings?.semanticModelId;
    if (!modelId) {
      console.log('[Memory] 未配置语义模型，跳过语义初始化');
      return;
    }

    console.log('[Memory] 开始初始化语义引擎，模型:', modelId);

    const existsLocally = await checkLocalModel(modelId);

    if (existsLocally) {
      const userDtype = settings.semanticDtype;
      if (userDtype) {
        // detectAvailableDtypes 已带缓存，此处不会重复发 HEAD
        const available = await detectAvailableDtypes(modelId);
        if (!available.includes(userDtype)) {
          console.warn(
            `[Memory] 用户选择的 dtype "${userDtype}" 在本地不存在，` +
            `回退到默认 "${getDefaultDtype(modelId)}"。本地可用: ${available.join(', ')}`
          );
          const { updateSettings } = await import('./settings.js');
          await updateSettings({ semanticDtype: '' });
        }
      }
      await initSemanticEngine(modelId);
    } else if (settings?.autoDownloadModels) {
      console.log('[Memory] 本地不存在模型，尝试后台下载:', modelId);
      await downloadModel(modelId);
      await initSemanticEngine(modelId);
    } else {
      console.log('[Memory] 语义模型未下载，请手动下载或启用自动下载');
    }
  } catch (e) {
    console.warn('[Memory] 后台语义初始化失败:', e);
  } finally {
    const settings = getAppState().get('settings');
    retrievalMode = settings?.retrievalMode || 'keyword';
    console.log('[Memory] 后台初始化完成，检索模式:', retrievalMode);

    try {
      const globalEventBus = (await import('../core/eventBus.js')).default;
      globalEventBus.emit('memory:vector-init-done', {
        ready: isVectorReady,
        model: semanticModelName,
        timestamp: Date.now(),
      });
    } catch (e) {}
  }
}

// ============================================================
// 统一初始化入口（快速返回）
// ============================================================
export async function initMemoryIndex() {
  await initMiniSearch();

  if (backgroundInitDone) return;

  if (!initPromise) {
    initPromise = (async () => {
      await initSemanticInBackground();
      backgroundInitDone = true;
    })();
  }

  return;
}

// ============================================================
// 其他辅助函数
// ============================================================
export async function getMemoriesByCharacter(characterId) {
  const stores = await getStores();
  return await stores.memories.getByIndex('characterId', characterId);
}

export async function deleteMemory(id) {
  const stores = await getStores();
  const mem = await stores.memories.get(id);
  await stores.memories.delete(id);

  if (miniSearch && isMiniSearchReady && mem) {
    try {
      miniSearch.remove(mem);
    } catch (e) {
      console.warn('[Memory] 移除索引失败:', e);
    }
  }

  vectorData = vectorData.filter(item => item.id !== id);
}

// ============================================================
// 对外暴露语义引擎接口（供 worldBook.js 等模块使用）
// ============================================================
export function getMemoryEmbedder() {
  return embedder;
}

export function isMemoryVectorReady() {
  return isVectorReady;
}

// ============================================================
// 导出状态供调试
// ============================================================
export {
  isVectorReady,
  vectorData,
  miniSearch,
  isMiniSearchReady,
  semanticModelName,
};