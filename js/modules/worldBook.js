// js/modules/worldBook.js - 世界书管理（完整版，含语义触发支持）
import { getStores, withKeyLock } from '../core/db.js';
import { generateUUID } from '../core/utils.js';
import { getAppState } from '../core/state.js';
import { showToast } from '../ui/components/toast.js';
import globalEventBus from '../core/eventBus.js';

let _stores = null;
async function getS() {
  if (!_stores) _stores = await getStores();
  return _stores;
}

function toFiniteNumber(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

const DEFAULT_SEMANTIC_THRESHOLD = 0.55;

// ============================================================
// 默认值
// ============================================================

export function getDefaultRule() {
  return {
    id: generateUUID(),
    name: '新规则',
    description: '',
    enabled: true,
    scope: 'global',
    groupId: null,
    category: '',
    type: 'conditional',
    condition: { path: 'user.message', op: 'contains', value: '' },
    content: '',
    position: 'before',
    priority: 50,
    probability: 1.0,
    onTrigger: { activateRules: [], deactivateRules: [] },
    exclusiveGroup: null,
    sticky: null,
    schedule: null,
    requireActivation: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),

    // ★ 语义触发相关字段
    semanticQuery: '',
    semanticThreshold: null,
    vector: null,
    vectorModel: null,
    _userCondition: null,
  };
}

export function getDefaultGroup() {
  return {
    id: generateUUID(),
    name: '新规则组',
    description: '',
    enabled: true,
    priority: 50,
    ruleIds: [],
    exclusiveGroup: null,
    onTrigger: { activateGroups: [], deactivateGroups: [] },
    parentGroupId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ============================================================
// 条件序列化 / 反序列化 / 规范化
// ============================================================

export function isSimpleCondition(cond) {
  return cond && typeof cond === 'object' && 'path' in cond && 'op' in cond;
}

function isInjectorComposite(cond) {
  return cond && typeof cond === 'object' && ('and' in cond || 'or' in cond || 'not' in cond);
}

export function serializeCondition(uiCondition) {
  if (!uiCondition) return { path: 'user.message', op: 'contains', value: '' };
  if (isInjectorComposite(uiCondition)) return uiCondition;
  if (isSimpleCondition(uiCondition)) return uiCondition;
  if (uiCondition.type === 'simple') {
    return {
      path: uiCondition.path || 'user.message',
      op: uiCondition.op || 'contains',
      value: uiCondition.value || '',
    };
  }
  if (uiCondition.type === 'and') {
    return { and: (uiCondition.children || []).map(c => serializeCondition(c)) };
  }
  if (uiCondition.type === 'or') {
    return { or: (uiCondition.children || []).map(c => serializeCondition(c)) };
  }
  if (uiCondition.type === 'not') {
    return {
      not: uiCondition.condition
        ? serializeCondition(uiCondition.condition)
        : { path: 'user.message', op: 'contains', value: '' },
    };
  }
  return { path: 'user.message', op: 'contains', value: '' };
}

export function deserializeCondition(storedCondition) {
  if (!storedCondition) return { type: 'simple', path: 'user.message', op: 'contains', value: '' };
  if (storedCondition.and) {
    return { type: 'and', children: storedCondition.and.map(c => deserializeCondition(c)) };
  }
  if (storedCondition.or) {
    return { type: 'or', children: storedCondition.or.map(c => deserializeCondition(c)) };
  }
  if (storedCondition.not) {
    return { type: 'not', condition: deserializeCondition(storedCondition.not) };
  }
  if (isSimpleCondition(storedCondition)) {
    return {
      type: 'simple',
      path: storedCondition.path || 'user.message',
      op: storedCondition.op || 'contains',
      value: storedCondition.value || '',
    };
  }
  if (storedCondition.type === 'and' && storedCondition.conditions) {
    return { type: 'and', children: storedCondition.conditions.map(c => deserializeCondition(c)) };
  }
  if (storedCondition.type === 'or' && storedCondition.conditions) {
    return { type: 'or', children: storedCondition.conditions.map(c => deserializeCondition(c)) };
  }
  if (storedCondition.type === 'not' && storedCondition.condition) {
    return { type: 'not', condition: deserializeCondition(storedCondition.condition) };
  }
  return { type: 'simple', path: 'user.message', op: 'contains', value: '' };
}

export function normalizeCondition(condition) {
  if (!condition) return { path: 'user.message', op: 'contains', value: '' };
  if (isInjectorComposite(condition)) return condition;
  if (isSimpleCondition(condition)) return condition;
  if (condition.type === 'and' && condition.children) {
    return { and: condition.children.map(c => normalizeCondition(c)) };
  }
  if (condition.type === 'or' && condition.children) {
    return { or: condition.children.map(c => normalizeCondition(c)) };
  }
  if (condition.type === 'not' && condition.condition) {
    return { not: normalizeCondition(condition.condition) };
  }
  if (condition.type === 'simple') {
    return {
      path: condition.path || 'user.message',
      op: condition.op || 'contains',
      value: condition.value || '',
    };
  }
  if (condition.path !== undefined) {
    return { path: condition.path, op: condition.op || 'contains', value: condition.value || '' };
  }
  return { path: 'user.message', op: 'contains', value: '' };
}

export function getConditionDescription(condition, depth = 0) {
  if (!condition) return '无条件';
  const indent = '  '.repeat(depth);
  if (condition.and) {
    const descs = condition.and.map(c => getConditionDescription(c, depth + 1));
    return `${indent}AND (${descs.length}个条件)`;
  }
  if (condition.or) {
    const descs = condition.or.map(c => getConditionDescription(c, depth + 1));
    return `${indent}OR (${descs.length}个条件)`;
  }
  if (condition.not) {
    return `${indent}NOT (${condition.not ? getConditionDescription(condition.not, depth + 1) : '无'})`;
  }
  if (condition.path) {
    const pathLabels = {
      'user.message': '用户消息',
      'character.name': '角色名',
      'character.description': '角色描述',
      'character.personality': '角色性格',
      'character.relationship': '角色关系',
      'emotionState.valence': '愉悦度',
      'emotionState.arousal': '唤醒度',
      'emotionState.dominance': '支配度',
      'emotionState.affection': '好感度',
      'bodyState.energy': '精力',
      'bodyState.sleepiness': '睡意',
      'bodyState.health': '健康',
      'bodyState.sleepStatus': '睡眠状态',
      'gameTime.hour': '小时',
      'gameTime.minute': '分钟',
      'gameTime.period': '时段',
      'gameTime.full': '完整时间',
      'group.name': '群组名',
      'group.description': '群组描述',
      'group.memberCount': '成员数',
      'group.activeLevel': '活跃度',
    };
    const pathLabel = pathLabels[condition.path] || condition.path;
    const opLabels = {
      'eq': '等于', 'neq': '不等于', 'gt': '大于', 'gte': '大于等于',
      'lt': '小于', 'lte': '小于等于', 'contains': '包含', 'not_contains': '不包含',
      'regex': '正则匹配', 'exists': '存在', 'empty': '为空', 'between': '介于',
      'lengthGt': '长度大于', 'lengthLt': '长度小于', 'startsWith': '以...开头',
      'endsWith': '以...结尾', 'in': '包含于', 'not_in': '不包含于',
      'semantic_match': '语义匹配',
    };
    const opLabel = opLabels[condition.op] || condition.op;
    return `${pathLabel} ${opLabel} "${condition.value}"`;
  }
  return '未知条件';
}

// ============================================================
// 语义向量核心函数
// ============================================================

async function generateRuleVector(rule) {
  if (!rule.semanticQuery || !rule.semanticQuery.trim()) return null;
  try {
    const { getMemoryEmbedder, isMemoryVectorReady } = await import('./memory.js');
    if (!isMemoryVectorReady()) return null;
    const embedder = getMemoryEmbedder();
    if (!embedder) return null;
    const vec = await embedder(rule.semanticQuery, { pooling: 'mean', normalize: true });
    return Array.from(vec.data);
  } catch (e) {
    console.warn('[WorldBook] 生成规则向量失败:', e);
    return null;
  }
}

function getCurrentVectorModelId() {
  const settings = getAppState().get('settings') || {};
  return settings.semanticModelId || null;
}

function isRuleVectorValid(rule) {
  if (!rule.vector) return false;
  if (rule.vectorModel !== getCurrentVectorModelId()) return false;
  return true;
}

function isUserExtraCondition(cond) {
  if (!cond || typeof cond !== 'object') return false;

  // ---------- 简单条件 ----------
  if (typeof cond.path === 'string' && typeof cond.op === 'string') {
    // 语义 cond 自身 → 无效
    if (cond.op === 'semantic_match') return false;

    const OPS_WITHOUT_VALUE = ['exists', 'empty'];
    const valueIsEmpty =
      cond.value === undefined ||
      cond.value === null ||
      cond.value === '' ||
      (typeof cond.value === 'string' && cond.value.trim() === '');

    if (!OPS_WITHOUT_VALUE.includes(cond.op) && valueIsEmpty) {
      return false;
    }

    return true;
  }

  // ---------- AND 组合：至少一个有效子条件 ----------
  if (Array.isArray(cond.and)) {
    return cond.and.some(c => isUserExtraCondition(c));
  }

  // ---------- OR 组合 ----------
  if (Array.isArray(cond.or)) {
    return cond.or.some(c => isUserExtraCondition(c));
  }

  // ---------- NOT ----------
  if (cond.not !== undefined) {
    return isUserExtraCondition(cond.not);
  }

  return false;
}

function stripSemanticCondFromCondition(cond, ruleId) {
  if (!cond || typeof cond !== 'object') return cond;

  if (typeof cond.path === 'string' && typeof cond.op === 'string') {
    if (cond.path === 'user.message' && cond.op === 'semantic_match' && cond.value === ruleId) {
      return null;
    }
    return cond;
  }

  if (Array.isArray(cond.and)) {
    const children = cond.and
      .map(c => stripSemanticCondFromCondition(c, ruleId))
      .filter(c => c !== null);

    const deduped = [];
    const seen = new Set();
    for (const c of children) {
      const key = JSON.stringify(c);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(c);
      }
    }

    if (deduped.length === 0) return null;
    if (deduped.length === 1) return deduped[0];
    return { and: deduped };
  }

  return cond;
}

function buildSemanticCondition(rule) {
  const semanticCond = {
    path: 'user.message',
    op: 'semantic_match',
    value: rule.id,
  };

  const userCond = rule._userCondition;
  if (!isUserExtraCondition(userCond)) {
    return semanticCond;
  }

  return { and: [semanticCond, userCond] };
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
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

export async function syncWorldBookVectors() {
  const result = { updated: 0, skipped: 0, editedDuringSync: 0 };

  try {
    const { isMemoryVectorReady } = await import('./memory.js');
    if (!isMemoryVectorReady()) {
      console.log('[WorldBook] 语义引擎未就绪，跳过向量同步');
      return result;
    }

    const currentModel = getCurrentVectorModelId();
    if (!currentModel) {
      console.log('[WorldBook] 未配置语义模型，跳过向量同步');
      return result;
    }

    const stores = await getS();
    const allRules = await getAllRules();
    const semanticRules = allRules.filter(r => r.type === 'semantic' && r.semanticQuery);

    for (const rule of semanticRules) {
      // ---------- 阶段 1：锁内取最新快照 + 快速检查 ----------
      const snapshot = await withKeyLock('worldbook_rule', rule.id, async () => {
        const fresh = await stores.world_book.get(rule.id);
        if (!fresh) return null;
        if (fresh.type !== 'semantic' || !fresh.semanticQuery) return null;
        if (isRuleVectorValid(fresh)) return { skip: true };
        return { rule: fresh };
      });

      if (!snapshot) continue;
      if (snapshot.skip) {
        result.skipped++;
        continue;
      }

      // ---------- 阶段 2：锁外生成向量（避免长锁） ----------
      const vec = await generateRuleVector(snapshot.rule);
      if (!vec) continue;

      // ---------- 阶段 3：锁内条件写回 ----------
      // 三种结果：
      //   'updated'                 → 语义查询未变 + 时间戳未变，正常写回
      //   'updated_no_timestamp'    → 语义查询未变但 updatedAt 变了（用户改了其他字段），
      //                               只写向量，保留用户的 updatedAt
      //   'edited'                  → 语义查询变了，本次生成的向量已失效，跳过
      //   'gone'                    → 规则已被删除或类型变更
      const outcome = await withKeyLock('worldbook_rule', rule.id, async () => {
        const fresh = await stores.world_book.get(rule.id);
        if (!fresh) return 'gone';
        if (fresh.type !== 'semantic' || !fresh.semanticQuery) return 'gone';

        // 语义查询变更 → 本次向量失效
        if (fresh.semanticQuery !== snapshot.rule.semanticQuery) {
          console.log(`[WorldBook] 规则 "${fresh.name || rule.id}" 在同步期间被编辑，跳过本次写回`);
          return 'edited';
        }

        // R2：updatedAt 变化 = 用户改过其他字段 → 只写向量，不覆盖 updatedAt
        if (fresh.updatedAt !== snapshot.rule.updatedAt) {
          fresh.vector = vec;
          fresh.vectorModel = currentModel;
          await stores.world_book.update(rule.id, fresh);
          return 'updated_no_timestamp';
        }

        // 正常路径
        fresh.vector = vec;
        fresh.vectorModel = currentModel;
        fresh.updatedAt = Date.now();
        await stores.world_book.update(rule.id, fresh);
        return 'updated';
      });

      if (outcome === 'updated' || outcome === 'updated_no_timestamp') {
        result.updated++;
      } else if (outcome === 'edited') {
        result.editedDuringSync++;
      }
      // 'gone' 不计入任何计数
    }

    console.log(
      `[WorldBook] 向量同步完成：更新 ${result.updated}，跳过 ${result.skipped}` +
      (result.editedDuringSync > 0 ? `，编辑跳过 ${result.editedDuringSync}` : '')
    );

    if (result.updated > 0) {
      globalEventBus.emit('worldbook:vectors-synced', result);
    }
  } catch (e) {
    console.warn('[WorldBook] 同步向量失败:', e);
  }

  return result;
}

export async function matchSemanticRules(userMessage, context = null) {
  const result = new Set();
  if (!userMessage || !userMessage.trim()) return result;

  try {
    const { getMemoryEmbedder, isMemoryVectorReady } = await import('./memory.js');
    if (!isMemoryVectorReady()) return result;
    const embedder = getMemoryEmbedder();
    if (!embedder) return result;

    const settings = getAppState().get('settings') || {};
    const semanticConfig = settings.worldBookSemantic || {};
    if (semanticConfig.enabled === false) return result;

    const globalThreshold = toFiniteNumber(semanticConfig.threshold) ?? DEFAULT_SEMANTIC_THRESHOLD;
    const globalTopK = toFiniteNumber(semanticConfig.topK) ?? 5;

    const enabledRules = await getEnabledRules(context);
    const semanticRules = enabledRules.filter(
      r => r.type === 'semantic' && r.semanticQuery && r.vector
    );

    if (semanticRules.length === 0) return result;

    let queryVec;
    try {
      const vec = await embedder(userMessage, { pooling: 'mean', normalize: true });
      queryVec = vec.data;
    } catch (e) {
      console.warn('[WorldBook] 用户消息向量化失败:', e);
      return result;
    }

    const scores = [];
    const currentModel = getCurrentVectorModelId();
    for (const rule of semanticRules) {
      if (rule.vectorModel !== currentModel) continue;
      const sim = cosineSimilarity(queryVec, rule.vector);
      const ruleThreshold = toFiniteNumber(rule.semanticThreshold);
      const threshold = ruleThreshold ?? globalThreshold;
      if (sim >= threshold) {
        scores.push({ ruleId: rule.id, score: sim, name: rule.name });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    const top = scores.slice(0, globalTopK);
    for (const item of top) {
      result.add(item.ruleId);
    }

    if (top.length > 0) {
      console.log('[WorldBook] 语义命中规则:',
        top.map(t => `${t.name}(${t.score.toFixed(3)})`).join(', '));
    }
  } catch (e) {
    console.warn('[WorldBook] 语义预筛失败:', e);
  }

  return result;
}

export async function testSemanticMatch(text, context = null) {
  if (typeof text !== 'string' || text.trim() === '') {
    console.warn('[WorldBook] testSemanticMatch: 输入文本为空，返回空结果');
    return [];
  }

  let getMemoryEmbedder, isMemoryVectorReady;
  try {
    const memory = await import('./memory.js');
    getMemoryEmbedder = memory.getMemoryEmbedder;
    isMemoryVectorReady = memory.isMemoryVectorReady;
  } catch (e) {
    console.warn('[WorldBook] testSemanticMatch: 无法加载 memory 模块:', e);
    return [];
  }

  if (!isMemoryVectorReady()) {
    console.log('[WorldBook] testSemanticMatch: 语义引擎未就绪');
    return [];
  }

  const embedder = getMemoryEmbedder();
  if (!embedder) {
    console.log('[WorldBook] testSemanticMatch: embedder 未初始化');
    return [];
  }

  let semanticRules;
  try {
    const enabledRules = await getEnabledRules(context);
    semanticRules = enabledRules.filter(
      r => r.type === 'semantic' && r.semanticQuery && r.vector
    );
  } catch (e) {
    console.warn('[WorldBook] testSemanticMatch: 获取规则失败:', e);
    return [];
  }

  if (semanticRules.length === 0) return [];

  let queryVec;
  try {
    const embedResult = await embedder(text, { pooling: 'mean', normalize: true });
    queryVec = embedResult?.data;
  } catch (e) {
    console.warn('[WorldBook] testSemanticMatch: 向量化失败:', e);
    return [];
  }

  if (!queryVec || !ArrayBuffer.isView(queryVec)) {
    console.warn('[WorldBook] testSemanticMatch: 向量化返回无效数据');
    return [];
  }

  const currentModel = getCurrentVectorModelId();
  const settings = getAppState().get('settings') || {};
  const globalThreshold = toFiniteNumber(settings.worldBookSemantic?.threshold) ?? DEFAULT_SEMANTIC_THRESHOLD;

  const scores = [];
  for (const rule of semanticRules) {
    if (rule.vectorModel !== currentModel) continue;

    if (!rule.vector || rule.vector.length !== queryVec.length) {
      console.warn(`[WorldBook] testSemanticMatch: 规则 "${rule.name}" 向量维度不匹配，跳过`);
      continue;
    }

    const sim = cosineSimilarity(queryVec, rule.vector);
    const ruleThreshold = toFiniteNumber(rule.semanticThreshold);
    const threshold = ruleThreshold ?? globalThreshold;
    scores.push({
      ruleId: rule.id,
      name: rule.name,
      score: sim,
      semanticQuery: rule.semanticQuery,
      threshold: threshold,
    });
  }

  scores.sort((a, b) => b.score - a.score);
  return scores;
}

// ============================================================
// 规则 CRUD
// ============================================================

export async function getAllRules() {
  const stores = await getS();
  return await stores.world_book.getAll();
}

export async function getRule(id) {
  const stores = await getS();
  return await stores.world_book.get(id);
}

export async function getRulesByGroup(groupId) {
  const stores = await getS();
  try {
    return await stores.world_book.getByIndex('groupId', groupId);
  } catch (err) {
    const all = await stores.world_book.getAll();
    return all.filter(r => r.groupId === groupId);
  }
}

export async function getEnabledRules(context = null) {
  const all = await getAllRules();
  const groups = await getAllGroups();
  const enabledGroupIds = new Set(groups.filter(g => g.enabled).map(g => g.id));
  return all.filter(r => {
    if (!r.enabled) return false;
    if (r.groupId && !enabledGroupIds.has(r.groupId)) return false;
    if (r.scope === 'global') return true;
    if (r.scope.startsWith('character:') && context?.characterId) {
      return r.scope === `character:${context.characterId}`;
    }
    if (r.scope.startsWith('group:') && context?.groupId) {
      return r.scope === `group:${context.groupId}`;
    }
    return false;
  });
}

export async function getRulesByScope(scope) {
  const stores = await getS();
  const all = await stores.world_book.getAll();
  return all.filter(r => r.scope === scope || r.scope === 'global');
}

export async function addRule(ruleData) {
  const stores = await getS();
  const rule = {
    ...getDefaultRule(),
    ...ruleData,
    id: generateUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (rule.type === 'semantic' && rule.semanticQuery) {
    const vec = await generateRuleVector(rule);
    if (vec) {
      rule.vector = vec;
      rule.vectorModel = getCurrentVectorModelId();
    }
    rule._userCondition = isUserExtraCondition(ruleData.condition)
      ? ruleData.condition
      : null;
    rule.condition = buildSemanticCondition({
      id: rule.id,
      _userCondition: rule._userCondition,
    });
  } else if (rule.condition) {
    rule.condition = normalizeCondition(rule.condition);
    if (rule.type !== 'semantic') rule._userCondition = null;
  }

  if (!rule.onTrigger) rule.onTrigger = { activateRules: [], deactivateRules: [] };

  return withKeyLock('worldbook_rule', rule.id, async () => {
    await stores.world_book.add(rule);
    if (rule.groupId) await addRuleToGroup(rule.groupId, rule.id);
    await reloadWorldBookRules();
    globalEventBus.emit('worldbook:rule-added', { rule });
    return rule;
  });
}

export async function updateRule(id, updates) {
  return withKeyLock('worldbook_rule', id, async () => {
    const stores = await getS();
    const existing = await stores.world_book.get(id);
    if (!existing) throw new Error('规则不存在');

    const oldGroupId = existing.groupId ?? null;
    const newGroupId = (updates.groupId !== undefined) ? (updates.groupId ?? null) : oldGroupId;

    if (oldGroupId !== newGroupId) {
      if (oldGroupId) await removeRuleFromGroup(oldGroupId, id);
      if (newGroupId) await addRuleToGroup(newGroupId, id);
    }

    const base = (oldGroupId !== newGroupId)
      ? (await stores.world_book.get(id)) || existing
      : existing;

    const updated = { ...base, ...updates, updatedAt: Date.now() };

    const semanticChanged =
      updated.type === 'semantic' &&
      updated.semanticQuery &&
      (
        !base.vector ||
        base.semanticQuery !== updated.semanticQuery ||
        base.vectorModel !== getCurrentVectorModelId()
      );

    if (semanticChanged) {
      const vec = await generateRuleVector(updated);
      if (vec) {
        updated.vector = vec;
        updated.vectorModel = getCurrentVectorModelId();
      } else {
        updated.vector = null;
        updated.vectorModel = null;
      }
    }

    if (updated.type === 'semantic') {
      if (updates.condition !== undefined) {
        if (isUserExtraCondition(updates.condition)) {
          updated._userCondition = updates.condition;
        } else {
          updated._userCondition = null;
        }
      } else if (!isUserExtraCondition(updated._userCondition)) {
        updated._userCondition = null;
      }
      updated.condition = buildSemanticCondition({
        id: updated.id,
        _userCondition: updated._userCondition,
      });
    } else {
      if (base.type === 'semantic') {
        updated.vector = null;
        updated.vectorModel = null;
        updated._userCondition = null;
        updated.semanticQuery = '';
        updated.semanticThreshold = null;
      }
      if (updates.condition) {
        updated.condition = normalizeCondition(updates.condition);
      }
    }

    await stores.world_book.update(id, updated);
    await reloadWorldBookRules();
    globalEventBus.emit('worldbook:rule-updated', { rule: updated });
    return updated;
  });
}

export async function deleteRule(id) {
  return withKeyLock('worldbook_rule', id, async () => {
    const stores = await getS();
    const rule = await stores.world_book.get(id);
    if (rule?.groupId) await removeRuleFromGroup(rule.groupId, id);
    await stores.world_book.delete(id);
    await reloadWorldBookRules();
    globalEventBus.emit('worldbook:rule-deleted', { id });
  });
}

export async function toggleRule(id) {
  return withKeyLock('worldbook_rule', id, async () => {
    const stores = await getS();
    const rule = await stores.world_book.get(id);
    if (!rule) throw new Error('规则不存在');
    rule.enabled = !rule.enabled;
    rule.updatedAt = Date.now();
    await stores.world_book.update(id, rule);
    await reloadWorldBookRules();
    globalEventBus.emit('worldbook:rule-toggled', { rule });
    return rule;
  });
}

// ============================================================
// 规则组 CRUD
// ============================================================

export async function getAllGroups() {
  const stores = await getS();
  return await stores.rule_groups.getAll();
}

export async function getGroup(id) {
  const stores = await getS();
  return await stores.rule_groups.get(id);
}

export async function addGroup(groupData) {
  const stores = await getS();
  const group = {
    ...getDefaultGroup(),
    ...groupData,
    id: generateUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await stores.rule_groups.add(group);
  globalEventBus.emit('worldbook:group-added', { group });
  return group;
}

export async function updateGroup(id, updates) {
  const stores = await getS();
  const existing = await stores.rule_groups.get(id);
  if (!existing) throw new Error('规则组不存在');
  const updated = { ...existing, ...updates, updatedAt: Date.now() };
  await stores.rule_groups.update(id, updated);
  globalEventBus.emit('worldbook:group-updated', { group: updated });
  return updated;
}

export async function deleteGroup(id) {
  const stores = await getS();
  const rules = await getRulesByGroup(id);
  for (const rule of rules) await stores.world_book.delete(rule.id);
  await stores.rule_groups.delete(id);
  await reloadWorldBookRules();
  globalEventBus.emit('worldbook:group-deleted', { id });
}

export async function toggleGroup(id) {
  const stores = await getS();
  const group = await stores.rule_groups.get(id);
  if (!group) throw new Error('规则组不存在');
  group.enabled = !group.enabled;
  group.updatedAt = Date.now();
  await stores.rule_groups.update(id, group);
  await reloadWorldBookRules();
  globalEventBus.emit('worldbook:group-toggled', { group });
  return group;
}

// ============================================================
// 组内规则管理
// ============================================================

export async function addRuleToGroup(groupId, ruleId) {
  const stores = await getS();
  const group = await stores.rule_groups.get(groupId);
  if (!group) {
    console.warn(`[WorldBook] 组不存在: ${groupId}`);
    return;
  }
  if (!group.ruleIds.includes(ruleId)) {
    group.ruleIds.push(ruleId);
    group.updatedAt = Date.now();
    await stores.rule_groups.update(groupId, group);

    const rule = await stores.world_book.get(ruleId);
    if (rule) {
      rule.groupId = groupId;
      await stores.world_book.update(ruleId, rule);
    }
  }
}

export async function removeRuleFromGroup(groupId, ruleId) {
  const stores = await getS();
  const group = await stores.rule_groups.get(groupId);
  if (!group) {
    console.warn(`[WorldBook] 组不存在: ${groupId}`);
    return;
  }
  group.ruleIds = group.ruleIds.filter(id => id !== ruleId);
  group.updatedAt = Date.now();
  await stores.rule_groups.update(groupId, group);

  const rule = await stores.world_book.get(ruleId);
  if (rule) {
    rule.groupId = null;
    await stores.world_book.update(ruleId, rule);
  }
}

export async function getGroupRules(groupId) {
  return await getRulesByGroup(groupId);
}

function repairSemanticRule(rule) {
  const semanticCondId = rule.id;
  let changed = false;
  let _userCondition = rule._userCondition ?? null;

  if (_userCondition && typeof _userCondition === 'object') {
    const stripped = stripSemanticCondFromCondition(_userCondition, semanticCondId);
    if (JSON.stringify(stripped) !== JSON.stringify(_userCondition)) {
      _userCondition = stripped;
      changed = true;
    }
    if (!isUserExtraCondition(_userCondition)) {
      if (_userCondition !== null) {
        _userCondition = null;
        changed = true;
      }
    }
  }

  const rebuilt = buildSemanticCondition({
    id: semanticCondId,
    _userCondition,
  });

  if (JSON.stringify(rebuilt) !== JSON.stringify(rule.condition)) {
    changed = true;
  }

  return {
    changed,
    rule: {
      _userCondition,
      condition: rebuilt,
    },
  };
}

export async function migrateWorldBookData() {
  const stores = await getS();
  const allRules = await stores.world_book.getAll();
  let needUpdate = false;

  for (const rule of allRules) {
    let changed = false;

    if (rule.condition) {
      const normalized = normalizeCondition(rule.condition);
      if (JSON.stringify(normalized) !== JSON.stringify(rule.condition)) {
        rule.condition = normalized;
        changed = true;
      }
    } else {
      rule.condition = { path: 'user.message', op: 'contains', value: '' };
      changed = true;
    }

    if (rule.groupId === undefined) { rule.groupId = null; changed = true; }
    if (!rule.onTrigger) { rule.onTrigger = { activateRules: [], deactivateRules: [] }; changed = true; }
    if (!rule.onTrigger.activateRules) { rule.onTrigger.activateRules = []; changed = true; }
    if (!rule.onTrigger.deactivateRules) { rule.onTrigger.deactivateRules = []; changed = true; }
    if (rule.exclusiveGroup === undefined) { rule.exclusiveGroup = null; changed = true; }

    if (rule.semanticQuery === undefined) { rule.semanticQuery = ''; changed = true; }
    if (rule.semanticThreshold === undefined) { rule.semanticThreshold = null; changed = true; }
    if (rule.vector === undefined) { rule.vector = null; changed = true; }
    if (rule.vectorModel === undefined) { rule.vectorModel = null; changed = true; }
    if (rule._userCondition === undefined) { rule._userCondition = null; changed = true; }

    if (rule.type === 'semantic') {
      const fixResult = repairSemanticRule(rule);
      if (fixResult.changed) {
        rule._userCondition = fixResult.rule._userCondition;
        rule.condition = fixResult.rule.condition;
        changed = true;
        console.log(`[WorldBook] 修复语义规则污染: ${rule.name || rule.id}`);
      }
    }

    if (changed) {
      await stores.world_book.update(rule.id, rule);
      needUpdate = true;
    }
  }

  if (needUpdate) console.log('[WorldBook] 数据迁移完成');
  return needUpdate;
}

// ============================================================
// 重新加载到注入器
// ============================================================

export async function reloadWorldBookRules() {
  const enabledRules = await getEnabledRules();
  const { updateWorldBookRules } = await import('./injector.js');
  await updateWorldBookRules(enabledRules);
}

// ============================================================
// 导入 / 导出
// ============================================================

export async function exportRules(ids = null) {
  const stores = await getS();
  const all = await stores.world_book.getAll();
  const selected = ids ? all.filter(r => ids.includes(r.id)) : all;
  return JSON.stringify(selected, null, 2);
}

export async function exportGroups(ids = null) {
  const stores = await getS();
  const all = await stores.rule_groups.getAll();
  const selected = ids ? all.filter(g => ids.includes(g.id)) : all;
  return JSON.stringify(selected, null, 2);
}

export async function importRules(jsonString) {
  const stores = await getS();
  const rules = JSON.parse(jsonString);
  if (!Array.isArray(rules)) throw new Error('无效的规则数组');
  let count = 0;
  const currentModel = getCurrentVectorModelId();

  for (const rule of rules) {
    if (!rule.id) rule.id = generateUUID();
    if (rule.condition) rule.condition = normalizeCondition(rule.condition);
    if (!rule.onTrigger) rule.onTrigger = { activateRules: [], deactivateRules: [] };

    if (rule.vector && rule.vectorModel !== currentModel) {
      rule.vector = null;
      rule.vectorModel = null;
    }

    if (rule.type === 'semantic') {
      const fixResult = repairSemanticRule(rule);
      if (fixResult.changed) {
        rule._userCondition = fixResult.rule._userCondition;
        rule.condition = fixResult.rule.condition;
      }
    }

    if (rule.groupId) {
      const group = await stores.rule_groups.get(rule.groupId);
      if (!group) {
        const newGroup = getDefaultGroup();
        newGroup.id = rule.groupId;
        newGroup.name = rule.groupId;
        await stores.rule_groups.add(newGroup);
      }
      await addRuleToGroup(rule.groupId, rule.id);
    }

    rule.createdAt = rule.createdAt || Date.now();
    rule.updatedAt = Date.now();
    await stores.world_book.add(rule);
    count++;
  }

  await reloadWorldBookRules();
  globalEventBus.emit('worldbook:rules-imported', { count });
  return count;
}

export async function importGroups(jsonString) {
  const stores = await getS();
  const groups = JSON.parse(jsonString);
  if (!Array.isArray(groups)) throw new Error('无效的组数组');
  let count = 0;
  for (const group of groups) {
    if (!group.id) group.id = generateUUID();
    group.createdAt = group.createdAt || Date.now();
    group.updatedAt = Date.now();
    await stores.rule_groups.add(group);
    count++;
  }
  globalEventBus.emit('worldbook:groups-imported', { count });
  return count;
}

// ============================================================
// 选择器工具
// ============================================================

export async function getAvailableRulesForSelector(excludeIds = []) {
  const stores = await getS();
  const all = await stores.world_book.getAll();
  return all.filter(r => r.enabled && !excludeIds.includes(r.id))
    .map(r => ({ id: r.id, name: r.name, description: r.description }));
}

export async function getAvailableGroupsForSelector(excludeIds = []) {
  const stores = await getS();
  const all = await stores.rule_groups.getAll();
  return all.filter(g => g.enabled && !excludeIds.includes(g.id))
    .map(g => ({ id: g.id, name: g.name, description: g.description, ruleCount: g.ruleIds?.length || 0 }));
}

// ============================================================
// 路径和操作符列表
// ============================================================

export function getAvailablePaths() {
  return [
    { label: '用户消息', value: 'user.message' },
    { label: '角色名称', value: 'character.name' },
    { label: '角色描述', value: 'character.description' },
    { label: '角色性格', value: 'character.personality' },
    { label: '角色关系', value: 'character.relationship' },
    { label: '情感-愉悦度', value: 'emotionState.valence' },
    { label: '情感-唤醒度', value: 'emotionState.arousal' },
    { label: '情感-支配度', value: 'emotionState.dominance' },
    { label: '情感-好感度', value: 'emotionState.affection' },
    { label: '身体-精力', value: 'bodyState.energy' },
    { label: '身体-睡意', value: 'bodyState.sleepiness' },
    { label: '身体-健康', value: 'bodyState.health' },
    { label: '身体-睡眠状态', value: 'bodyState.sleepStatus' },
    { label: '游戏时间-小时', value: 'gameTime.hour' },
    { label: '游戏时间-分钟', value: 'gameTime.minute' },
    { label: '游戏时间-时段', value: 'gameTime.period' },
    { label: '游戏时间-完整', value: 'gameTime.full' },
    { label: '群组-名称', value: 'group.name' },
    { label: '群组-描述', value: 'group.description' },
    { label: '群组-成员数', value: 'group.memberCount' },
    { label: '群组-活跃度', value: 'group.activeLevel' },
  ];
}

export function getAvailableOperators() {
  return [
    { label: '等于 (eq)', value: 'eq' },
    { label: '不等于 (neq)', value: 'neq' },
    { label: '大于 (gt)', value: 'gt' },
    { label: '大于等于 (gte)', value: 'gte' },
    { label: '小于 (lt)', value: 'lt' },
    { label: '小于等于 (lte)', value: 'lte' },
    { label: '包含 (contains)', value: 'contains' },
    { label: '不包含 (not_contains)', value: 'not_contains' },
    { label: '正则匹配 (regex)', value: 'regex' },
    { label: '存在 (exists)', value: 'exists' },
    { label: '为空 (empty)', value: 'empty' },
    { label: '介于 (between)', value: 'between' },
    { label: '长度大于 (lengthGt)', value: 'lengthGt' },
    { label: '长度小于 (lengthLt)', value: 'lengthLt' },
    { label: '以...开头 (startsWith)', value: 'startsWith' },
    { label: '以...结尾 (endsWith)', value: 'endsWith' },
    { label: '包含于 (in)', value: 'in' },
    { label: '不包含于 (not_in)', value: 'not_in' },
  ];
}