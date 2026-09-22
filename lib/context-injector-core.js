/**
 * @module context-injector/context-injector-core
 *
 * @description Utopia 上下文注入工具（全面增强版）
 *
 * **支持的特性：**
 * - 注入类型：constant / conditional / logic / sticky / scheduled / counter / cycle / delayed
 * - 条件组合：and / or / not + 19 种操作符
 * - 占位符模板：{{path || default}}
 * - 宏模板：可复用片段，带参数
 * - 优先级、互斥组、作用域、概率触发、启用开关、需激活标志
 * - 精细化定位：index / relative / nested
 * - 异步内容源（支持 Promise）
 * - 动态规则链（onTrigger 激活/停用其他规则）
 * - 延时注入、循环注入
 * - 日志集成（传入 Logger 实例，自动输出规则执行链）
 *
 * @note 语义匹配约定：
 *   使用 `semantic_match` 操作符时，调用方必须在 context 中预先提供
 *   `_semanticHits`（Set<string> | string[] | { [id]: true }），包含所有
 *   命中语义规则的 ID。injector 本身不负责计算命中，只负责判断。
 *   这一设计保持了 injector 对"语义"概念的零感知。
 *
 * @note 性能考量：
 *   - `buildMessages` 每次都会遍历所有规则（包括未启用的），当规则数量极大（>500）时可能影响性能。
 *   - `delayed` 类型使用 `setTimeout`，频繁调用 `buildMessages` 可能创建大量定时器（内部做了去重，但仍需注意）。
 *   - `scheduled` / `cycle` 依赖客户端时间，可能被用户篡改或时区不匹配导致非预期触发。
 *   - `_cascadeDeactivate` 迭代传播的复杂度为 O(N²)（N=激活链规则数）。
 *     实际场景规则数在百级以内，可忽略；若超千级需考虑反向拓扑排序优化。
 */

// ============================================================
// 内置工具函数
// ============================================================

/**
 * 根据路径字符串安全获取深层对象值。
 *
 * 支持点号与方括号混合语法，例如 `"a.b[0].c"`、`"a['b'].c"`。
 *
 * @param {Object} obj - 源对象。
 * @param {string} path - 路径。
 * @returns {*} 路径对应的值；中间任一环节为 null/undefined 时返回 undefined。
 * @private
 */
function safeGetByPath(obj, path) {
  if (!obj || typeof path !== 'string') return undefined;
  // 将 .a[0].b 统一拆成 ['a', '0', 'b']
  const keys = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let current = obj;
  for (const key of keys) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * 内置比较操作符字典（19 种）。
 *
 * 调用约定：`op(actualValue, conditionValue, ctx)`
 *   - 前两个参数为通用参数
 *   - 第三个参数 `ctx` 仅被 `semantic_match` 等特殊操作符使用
 *
 * @enum {Function}
 * @private
 */
const OPERATORS = {
  // ---------- 通用比较 ----------
  /** 等于 */
  eq: (a, b) => a === b,
  /** 不等于 */
  neq: (a, b) => a !== b,
  /** 值存在（非 null 且非 undefined） */
  exists: (a) => a !== undefined && a !== null,
  /** 值为空（undefined / null / 空串 / 空数组） */
  empty: (a) =>
    a === undefined || a === null || a === '' || (Array.isArray(a) && a.length === 0),

  // ---------- 数值比较 ----------
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  /** 数值介于 [b[0], b[1]] */
  between: (a, b) => Array.isArray(b) && b.length >= 2 && a >= b[0] && a <= b[1],

  // ---------- 字符串操作 ----------
  /** 字符串包含 */
  contains: (a, b) => a != null && String(a).includes(String(b)),
  /** 字符串不包含 */
  not_contains: (a, b) => a == null || !String(a).includes(String(b)),
  /** 以某字符串开头 */
  startsWith: (a, b) => a != null && String(a).startsWith(String(b)),
  /** 以某字符串结尾 */
  endsWith: (a, b) => a != null && String(a).endsWith(String(b)),
  /** 正则匹配（b 为模式字符串） */
  regex: (a, b) => {
    if (typeof b !== 'string' || b === '') return false;
    try {
      return new RegExp(b).test(String(a));
    } catch {
      return false;
    }
  },
  /** 字符串长度大于 b */
  lengthGt: (a, b) => String(a == null ? '' : a).length > b,
  /** 字符串长度小于 b */
  lengthLt: (a, b) => String(a == null ? '' : a).length < b,

  // ---------- 集合操作 ----------
  /** 值包含于数组 b */
  in: (a, b) => Array.isArray(b) && b.includes(a),
  /** 值不包含于数组 b */
  not_in: (a, b) => !Array.isArray(b) || !b.includes(a),

  // ---------- 语义匹配（外部注入命中集合） ----------
  /**
   * 语义匹配 —— 检查当前规则 ID 是否在预计算的命中集合中。
   *
   * 使用方式：
   *   { path: 'user.message', op: 'semantic_match', value: 'rule-uuid' }
   *
   * 约定：
   *   - context._semanticHits 是 Set<string> | string[] | { [id]: true }
   *   - 由外部（如 worldBook 模块的语义预筛）预先计算并填入
   *   - injector 不关心命中集合如何生成，只负责判断
   *
   * @param {*} a - 路径值（本操作符不使用）
   * @param {string} b - 要查找的规则 ID
   * @param {Object} ctx - 上下文对象
   * @returns {boolean}
   */
  semantic_match: (a, b, ctx) => {
    if (!b) return false;
    const hits = ctx && ctx._semanticHits;
    if (!hits) return false;
    if (hits instanceof Set) return hits.has(b);
    if (Array.isArray(hits)) return hits.includes(b);
    if (typeof hits === 'object') return hits[b] === true;
    return false;
  },
};

/**
 * 递归解析条件对象，返回布尔值。
 *
 * 支持：
 *   - and / or / not 逻辑组合（任意嵌套）
 *   - { path, op, value } 简单条件
 *   - { ruleTriggered: ruleId } 检查某规则是否在本轮已触发
 *   - 函数条件（直接调用）
 *
 * @param {Object|Function} condition - 条件定义。
 * @param {Object} ctx - 上下文数据。
 * @returns {boolean}
 * @private
 */
function evaluateCondition(condition, ctx) {
  if (typeof condition === 'function') return !!condition(ctx);
  if (!condition || typeof condition !== 'object') return false;

  // ---------- 逻辑组合 ----------
  if (condition.and) {
    if (!Array.isArray(condition.and) || condition.and.length === 0) return false;
    return condition.and.every((c) => evaluateCondition(c, ctx));
  }
  if (condition.or) {
    if (!Array.isArray(condition.or) || condition.or.length === 0) return false;
    return condition.or.some((c) => evaluateCondition(c, ctx));
  }
  if (condition.not) {
    return !evaluateCondition(condition.not, ctx);
  }

  // ---------- 规则触发检查 ----------
  if (condition.ruleTriggered) {
    const trace = ctx._internalTrace || [];
    return trace.some((t) => t.ruleId === condition.ruleTriggered && t.triggered);
  }

  // ---------- 简单条件 { path, op, value } ----------
  if (condition.path) {
    const actual = safeGetByPath(ctx, condition.path);
    const op = OPERATORS[condition.op] || OPERATORS.eq;
    try {
      return op(actual, condition.value, ctx);
    } catch (err) {
      // 单个操作符出错不应中断整条条件链
      return false;
    }
  }

  return false;
}

/**
 * 替换模板中的占位符 `{{path || default}}`。
 *
 * - 路径不存在时使用 `||` 后面的默认值
 * - 默认值也缺失时保留原始 `{{...}}` 文本
 *
 * @param {string} template - 模板字符串。
 * @param {Object} ctx - 上下文对象。
 * @returns {string}
 * @private
 */
function resolveTemplate(template, ctx) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{(.+?)\}\}/g, (match, expression) => {
    const parts = expression.split('||').map((s) => s.trim());
    const mainPath = parts[0];
    let value = safeGetByPath(ctx, mainPath);
    if (value === undefined || value === null) {
      value = parts.length > 1 ? parts[1] : match;
    }
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  });
}

/**
 * 解析规则的实际注入内容。
 *
 * 支持：
 *   - useMacro + macroParams：从宏模板解析
 *   - content 为函数：同步或异步（Promise）
 *   - content 为字符串：走占位符替换
 *
 * @param {Object} rule - 规则对象。
 * @param {Object} ctx - 上下文。
 * @param {Object} [macros={}] - 宏定义字典。
 * @returns {Promise<string>}
 * @private
 */
async function resolveContent(rule, ctx, macros = {}) {
  let raw = '';
  if (rule.useMacro && macros[rule.useMacro]) {
    raw = macros[rule.useMacro];
    if (rule.macroParams) {
      for (const [key, val] of Object.entries(rule.macroParams)) {
        raw = raw.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), val);
      }
    }
  } else if (typeof rule.content === 'function') {
    const result = rule.content(ctx);
    raw = result instanceof Promise ? await result : result;
  } else {
    raw = rule.content || '';
  }
  return resolveTemplate(raw, ctx);
}

// ============================================================
// 主入口：创建注入器实例
// ============================================================

/**
 * 创建一个上下文注入器实例。
 *
 * @param {Object} options - 配置项。
 * @param {Array<Object>} options.rules - 注入规则列表。
 * @param {Object} [options.macros={}] - 宏模板定义。
 * @param {Object} [options.eventBus] - 事件总线实例（需具备 emit 方法）。
 * @param {Object} [options.logger] - 日志记录器实例（需具备 debug/info/warn/error 方法）。
 * @returns {{ buildMessages: Function, resetState: Function, updateRules: Function }}
 */
export function createContextInjector({ rules = [], macros = {}, eventBus, logger } = {}) {
  // ---------- 状态存储 ----------
  const stickyState = new Map();
  const counterState = new Map();
  const scheduledState = new Map();
  const delayedState = new Map();
  const activeRuleSet = new Set();
  const activationDeps = new Map();

  // ---------- 内部日志辅助 ----------
  const log = (level, msg, data) => {
    if (logger && typeof logger[level] === 'function') {
      try {
        logger[level](`[ContextInjector] ${msg}`, data);
      } catch {
        // 忽略 logger 自身的错误
      }
    }
  };

  // ---------- 预处理：排序 + 补默认优先级 ----------
  let processedRules = _prepareRules(rules);

  function _prepareRules(ruleList) {
    return (ruleList || [])
      .map((rule, index) => ({
        ...rule,
        _index: index,
        priority: rule.priority || 100,
      }))
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * 递归停用一组规则及其激活链下游规则。
   *
   *   算法：
   *     1. 建立反向索引 reverseDeps: 被激活方 → Set<激活方>
   *     2. 迭代传播：从 rootIds 出发，维护 toBeDeactivated 集合。
   *        对每个已失效规则 r 的每个子规则 c：
   *          若 c 的所有激活源都在 toBeDeactivated 中 → c 也失效，继续传播
   *     3. 应用清理：从 activeRuleSet 和 activationDeps 移除
   *     4. 清理其他规则中指向已失效规则的引用
   *     5. 清理空的子集合
   *
   * @param {Iterable<string>} rootIds - 起始规则 id 集合（从规则集消失的规则）
   * @private
   */
  function _cascadeDeactivate(rootIds) {
    const rootArray = [...rootIds];
    if (rootArray.length === 0) return;

    // ---------- 1. 建立反向索引：activated -> Set<activator> ----------
    const reverseDeps = new Map();
    for (const [activatorId, childSet] of activationDeps.entries()) {
      for (const childId of childSet) {
        if (!reverseDeps.has(childId)) {
          reverseDeps.set(childId, new Set());
        }
        reverseDeps.get(childId).add(activatorId);
      }
    }

    // ---------- 2. 迭代传播：计算必然失效的规则集合 ----------
    const toBeDeactivated = new Set(rootArray);
    const queue = [...rootArray];

    while (queue.length > 0) {
      const id = queue.shift();

      // 找出该规则曾激活的子规则
      const children = activationDeps.get(id);
      if (!children || children.size === 0) continue;

      for (const childId of children) {
        if (toBeDeactivated.has(childId)) continue;

        // 检查 childId 的所有激活源是否都已失效
        const activators = reverseDeps.get(childId);
        if (!activators || activators.size === 0) {
          // 无激活源记录（不应发生），保守处理：失效
          toBeDeactivated.add(childId);
          queue.push(childId);
          continue;
        }

        let allDeactivated = true;
        for (const activatorId of activators) {
          if (!toBeDeactivated.has(activatorId)) {
            allDeactivated = false;
            break;
          }
        }

        if (allDeactivated) {
          toBeDeactivated.add(childId);
          queue.push(childId);
        }
      }
    }

    // ---------- 3. 应用清理 ----------
    for (const id of toBeDeactivated) {
      activeRuleSet.delete(id);
      activationDeps.delete(id);
    }

    // ---------- 4. 清理其他规则中指向已失效规则的引用 ----------
    for (const [, childSet] of activationDeps.entries()) {
      for (const id of toBeDeactivated) {
        childSet.delete(id);
      }
    }

    // ---------- 5. 清理空的子集合（保持状态整洁） ----------
    const emptyActivators = [];
    for (const [activatorId, childSet] of activationDeps.entries()) {
      if (childSet.size === 0) {
        emptyActivators.push(activatorId);
      }
    }
    for (const id of emptyActivators) {
      activationDeps.delete(id);
    }
  }

  /**
   * 热更新规则集（不重建实例，保留所有内部状态）
   *
   *
   *   本方法仅替换 processedRules，所有运行时状态保持不变。
   *
   *   同时实现"规则被禁用/删除时其激活链失效"：
   *     - 从新规则集中消失的规则，视为"被禁用或被删除"
   *     - 它们本身从 activeRuleSet 移除
   *     - 它们曾激活的下游规则，仅当所有激活源都失效时才失效
   *
   * @param {Array<Object>} newRules - 新的规则列表
   */
  function updateRules(newRules) {
    const newRuleIds = new Set((newRules || []).map(r => r.id));

    // 找出从规则集中消失的规则（含被删除与被禁用的规则）
    const removedRuleIds = new Set();
    for (const rule of processedRules) {
      if (!newRuleIds.has(rule.id)) {
        removedRuleIds.add(rule.id);
      }
    }

    if (removedRuleIds.size > 0) {
      _cascadeDeactivate(removedRuleIds);
      log('debug', `规则集更新：已处理 ${removedRuleIds.size} 条移除规则的激活链`, {
        removed: [...removedRuleIds],
      });
    }

    processedRules = _prepareRules(newRules);
  }

  // ============================================================
  // 作用域检查
  // ============================================================

  /**
   * 检查规则的作用域是否匹配当前上下文。
   *
   * 支持：
   *   - `global`：总是匹配
   *   - `character:{id}`：匹配当前角色
   *   - `character:*`：任意角色
   *   - `group:{id}`：匹配当前群组
   *   - `group:*`：任意群组
   *
   * @param {Object} rule
   * @param {Object} ctx
   * @returns {boolean}
   */
  function checkScope(rule, ctx) {
    if (!rule.scope) return true;
    if (rule.scope === 'global') return true;

    if (rule.scope.startsWith('character:')) {
      const targetId = rule.scope.substring('character:'.length);
      if (targetId === '*') return true;
      const currentCharId = safeGetByPath(ctx, 'character.id');
      const currentCharClass = safeGetByPath(ctx, 'character.class');
      return currentCharId === targetId || currentCharClass === targetId;
    }

    if (rule.scope.startsWith('group:')) {
      const targetId = rule.scope.substring('group:'.length);
      if (targetId === '*') return true;
      const currentGroupId = safeGetByPath(ctx, 'group.id');
      return currentGroupId === targetId;
    }

    return false;
  }

  // ============================================================
  // 内容定位
  // ============================================================

  /**
   * 将消息按 position 配置插入到消息数组中。
   *
   * position 支持：
   *   - 'before'（默认）：前置
   *   - 'after'：后置
   *   - { index }：指定索引
   *   - { relative: { role, offset } }：相对于某角色的最后一条消息
   *   - { nested: { index, field } }：嵌套进某条消息的 content 字段
   *
   * 边界处理：
   *   - index 越界时自动截断到 [0, messages.length]
   *   - relative 找不到 role 时降级为前置
   *   - nested 越界时降级为前置
   *
   * @param {Array} messages
   * @param {Object} message
   * @param {string|Object} position
   */
  function applyPosition(messages, message, position) {
    if (typeof position === 'object' && position !== null) {
      // ---------- 索引定位 ----------
      if (position.index !== undefined) {
        const idx = Math.max(0, Math.min(messages.length, position.index));
        messages.splice(idx, 0, message);
        return;
      }

      // ---------- 相对定位 ----------
      if (position.relative) {
        const { role, offset = 0 } = position.relative;
        const lastIndex = messages.map((m) => m.role).lastIndexOf(role);
        if (lastIndex !== -1) {
          let idx = lastIndex + offset;
          idx = Math.max(0, Math.min(messages.length, idx));
          messages.splice(idx, 0, message);
          return;
        }
        // 找不到 role → 降级为前置（继续执行到函数末尾的 unshift）
      }

      // ---------- 嵌套定位 ----------
      if (position.nested) {
        const { index, field = 'content' } = position.nested;
        if (messages[index]) {
          if (typeof messages[index][field] === 'string') {
            messages[index][field] += '\n' + message.content;
          } else if (Array.isArray(messages[index][field])) {
            messages[index][field].push({ type: 'text', text: message.content });
          }
          return;
        }
        // 越界 → 降级为前置
      }
    }

    // ---------- 默认 ----------
    if (position === 'after') {
      messages.push(message);
    } else {
      messages.unshift(message);
    }
  }

  // ============================================================
  // 核心方法：buildMessages
  // ============================================================

  /**
   * 根据用户消息和上下文动态构建带有系统注入的完整消息数组。
   *
   * @param {Array<Object>} userMessages - 原始用户消息数组。
   * @param {Object} ctx - 上下文数据。
   * @returns {Promise<Array<Object>>} 注入后的消息数组（附加非枚举属性 _injectTrace）
   */
  async function buildMessages(userMessages = [], ctx = {}) {
    let messages = [...userMessages];
    const trace = [];
    ctx._internalTrace = trace;

    // 本轮已触发的互斥组（替代原来的 O(n²) 遍历）
    const firedExclusiveGroups = new Set();

    log('debug', `开始构建消息，当前规则总数: ${processedRules.length}`, {
      userMessageCount: userMessages.length,
    });

    for (const rule of processedRules) {
      // ---------- 0. 前置过滤 ----------
      if (rule.enabled === false) continue;
      if (!checkScope(rule, ctx)) continue;
      if (rule.requireActivation && !activeRuleSet.has(rule.id)) continue;

      // ---------- 1. 根据类型判断是否注入 ----------
      let shouldInject = false;

      switch (rule.type) {
        case 'constant':
          shouldInject = true;
          break;

        case 'conditional':
          shouldInject = evaluateCondition(rule.condition, ctx);
          break;

        case 'logic':
          if (typeof rule.logic === 'function') {
            shouldInject = await rule.logic(ctx, messages);
          }
          break;

        case 'sticky': {
          const key = rule.sticky?.key || rule.id;
          const state = stickyState.get(key) || { triggered: false };
          if (!state.triggered) {
            shouldInject = rule.condition ? evaluateCondition(rule.condition, ctx) : true;
            if (shouldInject) {
              state.triggered = true;
              stickyState.set(key, state);
            }
          }
          break;
        }

        case 'scheduled': {
          const schedule = rule.schedule || {};
          const now = Date.now();
          const lastKey = `_sched_${rule.id}`;
          const lastState = scheduledState.get(lastKey) || { value: 0 };

          if (schedule.interval && now - lastState.value >= schedule.interval) {
            shouldInject = true;
            scheduledState.set(lastKey, { value: now });
          } else if (schedule.times && Array.isArray(schedule.times)) {
            const d = new Date();
            const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            if (schedule.times.includes(timeStr) && lastState.value !== timeStr) {
              shouldInject = true;
              scheduledState.set(lastKey, { value: timeStr });
            }
          }
          break;
        }

        case 'counter': {
          const counterKey = rule.counter?.key || rule.id;
          const countState = counterState.get(counterKey) || { count: 0 };
          countState.count++;
          counterState.set(counterKey, countState);
          if (rule.counter?.every && countState.count % rule.counter.every === 0) {
            shouldInject = true;
          }
          break;
        }

        case 'delayed': {
          const delayKey = `_delay_${rule.id}`;
          const delayState = delayedState.get(delayKey) || { timerId: null, triggered: false };
          if (!delayState.triggered) {
            const firstCondition = rule.firstCondition
              ? evaluateCondition(rule.firstCondition, ctx)
              : true;
            if (firstCondition) {
              const delayMs = rule.delay || 0;
              if (delayMs === 0) {
                shouldInject = true;
                delayState.triggered = true;
              } else if (!delayState.timerId) {
                delayState.timerId = setTimeout(() => {
                  delayState.triggered = true;
                  if (eventBus?.emit) {
                    eventBus.emit('injector:delayed-ready', { ruleId: rule.id });
                  }
                }, delayMs);
              }
            }
            delayedState.set(delayKey, delayState);
          } else if (delayState.triggered && rule.repeat) {
            shouldInject = true;
          }
          break;
        }

        case 'cycle': {
          const cycleKey = `_cycle_${rule.id}`;
          const cycleState = scheduledState.get(cycleKey) || { count: 0, lastTrigger: 0 };
          const now = Date.now();
          const interval = rule.cycle?.interval || 60000;
          if (now - cycleState.lastTrigger >= interval) {
            shouldInject = true;
            cycleState.lastTrigger = now;
            cycleState.count++;
            scheduledState.set(cycleKey, cycleState);
          }
          break;
        }

        default:
          break;
      }

      // ---------- 2. 概率检查 ----------
      if (shouldInject && rule.probability !== undefined) {
        shouldInject = Math.random() < rule.probability;
      }

      // ---------- 3. 注入处理 ----------
      if (shouldInject) {
        // 互斥组：同组内本轮只触发第一条
        if (rule.exclusiveGroup && firedExclusiveGroups.has(rule.exclusiveGroup)) {
          continue;
        }

        try {
          const content = await resolveContent(rule, ctx, macros);
          if (content) {
            const injectMsg = { role: 'system', content };
            applyPosition(messages, injectMsg, rule.position || 'before');
            trace.push({ ruleId: rule.id, triggered: true, content });

            // 记录互斥组
            if (rule.exclusiveGroup) {
              firedExclusiveGroups.add(rule.exclusiveGroup);
            }

            log('info', `✅ 规则触发: ${rule.id} (${rule.type})`, {
              ruleId: rule.id,
              type: rule.type,
              contentPreview: content.substring(0, 80),
            });

            // 动态规则链
            if (rule.onTrigger) {
              if (rule.onTrigger.activateRules) {
                rule.onTrigger.activateRules.forEach((id) => {
                  activeRuleSet.add(id);
                  if (!activationDeps.has(rule.id)) {
                    activationDeps.set(rule.id, new Set());
                  }
                  activationDeps.get(rule.id).add(id);
                  log('debug', `🔗 激活规则: ${id}`);
                });
              }
              if (rule.onTrigger.deactivateRules) {
                rule.onTrigger.deactivateRules.forEach((id) => {
                  activeRuleSet.delete(id);
                  log('debug', `🔗 停用规则: ${id}`);
                });
              }
            }

            if (eventBus?.emit) {
              eventBus.emit('injector:rule-triggered', { ruleId: rule.id, content });
            }
          }
        } catch (err) {
          log('error', `❌ 规则 "${rule.id}" 执行失败`, { error: err.message });
          if (eventBus?.emit) {
            eventBus.emit('injector:error', { ruleId: rule.id, error: err });
          }
        }
      } else {
        trace.push({ ruleId: rule.id, triggered: false });
        log('debug', `⏭️  规则跳过: ${rule.id} (${rule.type})`, {
          reason:
            rule.enabled === false
              ? '已禁用'
              : !checkScope(rule, ctx)
              ? '作用域不匹配'
              : '条件未满足',
        });
      }
    }

    log('info', `消息构建完成，共注入 ${trace.filter((t) => t.triggered).length} 条规则`, {
      totalRules: processedRules.length,
      triggeredCount: trace.filter((t) => t.triggered).length,
      finalMessageCount: messages.length,
    });

    // 设置不可枚举的 _injectTrace 属性
    Object.defineProperty(messages, '_injectTrace', {
      value: trace,
      writable: true,
      enumerable: false,
      configurable: true,
    });

    return messages;
  }

  // ============================================================
  // resetState
  // ============================================================

  /**
   * 重置注入器内部状态：清除粘性、计数器、计划、延时定时器及动态激活规则。
   */
  function resetState() {
    stickyState.clear();
    counterState.clear();
    scheduledState.clear();
    delayedState.forEach((state) => {
      if (state.timerId) clearTimeout(state.timerId);
    });
    delayedState.clear();
    activeRuleSet.clear();
    activationDeps.clear();
  }

  return { buildMessages, resetState, updateRules };
}