// js/modules/injector.js - 提示词注入适配器（完整版 + 语义预筛 + 匹配轨迹 + 世界书预算）
import { createContextInjector } from '/lib/index.js';
import globalEventBus from '../core/eventBus.js';

let injectorInstance = null;
let isInitialized = false;
let initPromise = null;

// ============================================================
// 宏定义（★ 已扩展 characterContext）
// ============================================================
const MACROS = {
  userContext: '【用户信息】\n名称：{{user.name}}\n',
  characterContext: `【角色信息（务必严格遵循，不可更改）】
- 姓名：{{character.name}}
- 性别：{{character.gender || '未指定'}}
- 简介：{{character.description}}
- 性格：{{character.personality}}
- 背景：{{character.background || '（未设置）'}}
- 与用户的关系：{{character.relationship}}
- 对用户的称呼：{{character.callUser || '用户'}}
- 初次相遇场景：{{character.scene || '（未设置）'}}

【核心系统提示词（最高优先级，必须严格遵守）】
{{character.systemPrompt}}

【一致性要求】
你必须严格遵守以上所有设定，不得编造或修改任何身份信息（姓名、性别、关系、称呼、性格、背景等）。任何情况下都必须保持人设一致。`,

  characterIdentity: `【角色身份（不可更改）】
- 姓名：{{character.name}}
- 关系：{{character.relationship}}
- 对用户的称呼：{{character.callUser}}
- 性格：{{character.personality}}
- 其他设定请参考系统提示词。
你必须严格遵守以上身份，绝对不要编造或修改自己的姓名、关系、称呼或其他核心设定。`,

  groupContext: '【群组信息】\n- 群名称：{{group.name}}\n- 成员数：{{group.memberCount}} 人\n- 群描述：{{group.description || "无"}}\n- 当前活跃度：{{group.activeLevel || "正常"}}',
  groupMemberList: '【群成员列表】\n{{group.members}}',
  groupRules: '【群组规则】\n{{group.rules || "请遵守基本的群聊礼仪。"}}',
};

// ---------- 宏展开工具 ----------
function expandMacros(rules) {
  return rules.map(rule => {
    if (rule.content && typeof rule.content === 'string') {
      rule.content = rule.content.replace(/\{\{macro\.(\w+)\}\}/g, (match, name) => {
        return MACROS[name] !== undefined ? MACROS[name] : match;
      });
    }
    return rule;
  });
}

// ============================================================
// 基础规则
// ============================================================
function getBaseRules() {
  return [
    {
      id: 'consistency_instruction',
      type: 'constant',
      content: '【一致性要求】请确保你的回复与之前的内容保持一致，不要改变已经确定的事实（如角色的穿着、喜好、关系等）。如果发现矛盾，请优先遵循摘要中的信息。',
      position: 'before',
      priority: 0,
    },
    {
      id: 'identity_lock',
      type: 'constant',
      content: '{{macro.characterIdentity}}',
      position: 'before',
      priority: 1,
    },
    {
      id: 'name_reminder',
      type: 'conditional',
      condition: {
        or: [
          { path: 'user.message', op: 'contains', value: '名字' },
          { path: 'user.message', op: 'contains', value: '姓名' },
          { path: 'user.message', op: 'contains', value: '称呼' },
          { path: 'user.message', op: 'contains', value: '叫什么' },
          { path: 'user.message', op: 'contains', value: '名' },
        ]
      },
      content: '【名字提醒】用户正在询问你的名字，请务必回答“我叫{{character.name}}”，不要添加其他姓氏或中间名。这是你的唯一正确姓名。',
      position: 'before',
      priority: 2,
    },
    {
      id: 'time_context',
      type: 'constant',
      content: `【当前游戏时间】{{gameTime.natural}}（时段：{{gameTime.period}}）
{{gameTime.description}}
**你必须根据当前时段调整回复：深夜时表达困倦或想结束对话，清晨时精神饱满，午间可能略带困意。时间感知是角色扮演的重要部分。**`,
      position: 'before',
      priority: 3,
    },
    {
      id: 'time_reminder',
      type: 'conditional',
      condition: {
        or: [
          { path: 'user.message', op: 'contains', value: '几点' },
          { path: 'user.message', op: 'contains', value: '时间' },
          { path: 'user.message', op: 'contains', value: '什么时候' },
        ]
      },
      content: '【时间提醒】用户正在询问时间，请务必直接引用当前游戏时间（{{gameTime.natural}}）回答，不要猜测。',
      position: 'before',
      priority: 4,
    },
    {
      id: 'character_context',
      type: 'constant',
      content: '{{macro.characterContext}}',
      position: 'before',
      priority: 95,
    },
    {
      id: 'user_context',
      type: 'constant',
      content: '{{macro.userContext}}',
      position: 'before',
      priority: 30,
    },
  ];
}

/**
 * 把"展开宏 + 传给注入器"变为一个原子操作。
 *
 * 幂等性：
 *   expandMacros 对同一对象的重复调用是幂等的
 *   （{{macro.xxx}} 替换后不再匹配），因此重复传入相同规则集不会产生副作用。
 *
 * @param {Array<Object>} worldBookRules - 世界书规则列表（未展开宏）
 * @returns {Array<Object>} 实际应用的完整规则集
 * @private
 */
function _applyRulesToInjector(worldBookRules) {
  const baseRules = getBaseRules();
  const allRules = expandMacros([...baseRules, ...(worldBookRules || [])]);

  if (injectorInstance) {
    // 已存在实例：热更新规则集，保留引擎内部状态
    injectorInstance.updateRules(allRules);
  } else {
    // 首次创建
    injectorInstance = createContextInjector({
      rules: allRules,
      macros: MACROS,
      eventBus: globalEventBus,
      logger: console,
    });
    isInitialized = true;
  }

  return allRules;
}

// ============================================================
// 对外 API
// ============================================================

/**
 * 初始化 / 更新注入器
 *
 * @param {Array} rules - 完整规则集（含 baseRules，调用方自行拼装）
 * @param {Object} [options] - 仅在首次创建时生效的初始化选项
 * @returns {Object} 注入器实例
 */
export function initInjector(rules = [], options = {}) {
  if (injectorInstance) {
    injectorInstance.updateRules(rules);
    isInitialized = true;
    return injectorInstance;
  }

  injectorInstance = createContextInjector({
    rules,
    macros: MACROS,
    eventBus: globalEventBus,
    logger: console,
    ...options,
  });
  isInitialized = true;
  return injectorInstance;
}

/**
 * 获取注入器实例（首次调用触发初始化）
 *
 * @returns {Object} 注入器实例
 */
export function getInjector() {
  if (!isInitialized) {
    // 首次创建：只有 baseRules
    _applyRulesToInjector([]);

    if (!initPromise) {
      initPromise = (async () => {
        try {
          const wb = await import('./worldBook.js');
          const rules = await wb.getEnabledRules();
          _applyRulesToInjector(rules);
          console.log('[Injector] 初始世界书规则已加载:', rules.length);
        } catch (err) {
          console.warn('[Injector] 加载世界书规则失败:', err);
        }
      })();
    }
  }
  return injectorInstance;
}

/**
 * 更新世界书规则（对外 API，供 worldBook.js 保存后调用）
 *
 * @param {Array} rules - 新的世界书规则列表
 */
export async function updateWorldBookRules(rules) {
  _applyRulesToInjector(rules || []);
  globalEventBus.emit('injector:worldbook-updated', {
    ruleCount: (rules || []).length,
  });
}

// ============================================================
// 应用注入（核心：动态加载世界书 + 语义预筛 + 匹配轨迹 + 世界书预算）
// ============================================================
export async function applyInjection(messages, context, options = {}) {
  if (initPromise) {
    await initPromise;
  }

  // ---------- ① 动态加载世界书规则 ----------
  let freshRules = null;
  try {
    const { getEnabledRules } = await import('./worldBook.js');
    const contextForRules = {
      characterId: context?.character?.id || context?.characterId,
      groupId: context?.group?.id || context?.groupId,
    };
    freshRules = await getEnabledRules(
      (contextForRules.characterId || contextForRules.groupId) ? contextForRules : null
    );

    if (options.worldBookBudget && freshRules.length > 0) {
      try {
        const { fitWorldBookRules } = await import('./tokenBudget.js');
        const budgetResult = fitWorldBookRules(freshRules, options.worldBookBudget);
        if (budgetResult.dropped.length > 0) {
          console.log(
            `[Injector] 世界书预算裁剪：` +
            `保留 ${budgetResult.kept.length}/${freshRules.length} 条，` +
            `使用 ${budgetResult.usedTokens}/${options.worldBookBudget} tokens，` +
            `丢弃 ${budgetResult.dropped.length} 条`
          );
          if (budgetResult.dropped.length > 0) {
            const droppedNames = budgetResult.dropped.map(r => r.name || r.id).slice(0, 5);
            console.log(`[Injector] 丢弃的规则: ${droppedNames.join(', ')}${budgetResult.dropped.length > 5 ? ' ...' : ''}`);
          }
        }
        freshRules = budgetResult.kept;
      } catch (e) {
        console.warn('[Injector] 世界书预算裁剪失败:', e);
      }
    }
  } catch (err) {
    console.warn('[Injector] 加载世界书规则失败，本次使用上次规则集:', err);
    // 降级：freshRules 为 null，走"仅用 baseRules + 上次规则集"的路径
    // 说明：这比"用空规则集覆盖"更安全——避免一次加载失败导致规则全丢
  }

  if (freshRules !== null) {
    _applyRulesToInjector(freshRules);
  }

  // ---------- ② 语义预筛 ----------
  let semanticHits = new Set();
  let semanticTrace = null;

  try {
    const userMessage = context?.user?.message;
    if (userMessage && typeof userMessage === 'string' && userMessage.trim()) {
      const { testSemanticMatch, matchSemanticRules } = await import('./worldBook.js');

      const contextForRules = {
        characterId: context?.character?.id || context?.characterId,
        groupId: context?.group?.id || context?.groupId,
      };
      const ctxArg = (contextForRules.characterId || contextForRules.groupId)
        ? contextForRules
        : null;

      try {
        const allScores = await testSemanticMatch(userMessage, ctxArg);
        semanticTrace = {
          message: userMessage,
          scores: allScores || [],
          timestamp: Date.now(),
        };
      } catch (traceErr) {
        semanticTrace = { message: userMessage, scores: [], error: traceErr.message };
      }

      semanticHits = await matchSemanticRules(userMessage, ctxArg);
      if (semanticHits && semanticHits.size > 0) {
        console.log(`[Injector] 语义预筛命中 ${semanticHits.size} 条规则`);
      }
    }
  } catch (err) {
    console.warn('[Injector] 语义预筛失败，跳过语义规则:', err);
  }

  if (typeof window !== 'undefined') {
    window.__lastSemanticTrace = semanticTrace;
  }

  // ---------- ③ 把命中集合注入 context ----------
  const enrichedContext = { ...context };
  Object.defineProperty(enrichedContext, '_semanticHits', {
    value: semanticHits,
    writable: true,
    enumerable: false,
    configurable: true,
  });

  // ---------- ④ 调用注入器 ----------
  const injector = getInjector();
  const result = await injector.buildMessages(messages, enrichedContext);
  return result;
}

// ---------- 重置注入器状态 ----------
export function resetInjectorState() {
  if (injectorInstance) {
    injectorInstance.resetState();
  }
}

/**
 *
 * @param {Array} rules - 新的完整规则集
 */
export function updateInjectorRules(rules) {
  if (injectorInstance) {
    initInjector(rules);
  }
}