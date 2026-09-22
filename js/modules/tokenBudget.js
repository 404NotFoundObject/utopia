// js/modules/tokenBudget.js - Token 预算管理器
//
// 职责：
//   1. 估算文本的 token 数（中英文混合）
//   2. 根据模型的上下文窗口计算可用预算
//   3. 按优先级裁剪上下文（支持三种策略）
//   4. 世界书规则的单独预算裁剪
//   5. 输出统计信息（用于调试）
//
// 支持三种剪裁策略：
//   - drop_lowest:     丢弃最低优先级的整条消息（默认）
//   - truncate_longest: 截断最长的那条到预算内（system + history 均支持）
//   - summary_oldest:  用摘要替代最旧的历史消息
//

import { getAppState } from '../core/state.js';

// ============================================================
// 模型上下文窗口表
// ============================================================

const MODEL_CONTEXT_WINDOWS = [
  { pattern: /o1|o3|o4/i,                     value: 200000 },
  { pattern: /claude-4/i,                    value: 200000 },
  { pattern: /claude-3\.5/i,                 value: 200000 },
  { pattern: /claude-3/i,                    value: 200000 },
  { pattern: /gemini-1\.5-pro/i,             value: 2000000 },
  { pattern: /gemini-2/i,                    value: 1000000 },
  { pattern: /gemini-1\.5/i,                 value: 1000000 },
  { pattern: /gpt-4o/i,                      value: 128000 },
  { pattern: /gpt-4-turbo/i,                 value: 128000 },
  { pattern: /gpt-4\.1/i,                    value: 1000000 },
  { pattern: /gpt-4/i,                       value: 8192 },
  { pattern: /gpt-3\.5/i,                    value: 16385 },
  { pattern: /deepseek-reasoner/i,           value: 64000 },
  { pattern: /deepseek/i,                    value: 64000 },
  { pattern: /qwen2\.5/i,                    value: 131072 },
  { pattern: /qwen/i,                        value: 32000 },
  { pattern: /llama-3\.[1-9]/i,              value: 128000 },
  { pattern: /llama-3/i,                     value: 128000 },
  { pattern: /mistral-large/i,               value: 128000 },
  { pattern: /mistral/i,                     value: 32000 },
  { pattern: /command-r/i,                   value: 128000 },
  { pattern: /grok/i,                        value: 131072 },
  { pattern: /.*/,                           value: 8192 },
];

export function getModelContextWindow(modelName) {
  if (!modelName) return 8192;
  const lower = modelName.toLowerCase();
  for (const { pattern, value } of MODEL_CONTEXT_WINDOWS) {
    if (pattern.test(lower)) return value;
  }
  return 8192;
}

// ============================================================
// Token 估算
// ============================================================

export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  const chineseCount = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const otherCount = text.length - chineseCount;
  const chineseTokens = chineseCount / 1.5;
  const otherTokens = otherCount / 4;
  return Math.ceil((chineseTokens + otherTokens) * 1.1);
}

export function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const msg of messages) {
    total += 4;
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    }
  }
  return total;
}

// ============================================================
// 优先级标签规范
// ============================================================

export const PRIORITY = {
  IDENTITY: 100,
  CONSISTENCY: 95,
  TIME: 90,
  EMOTION: 85,
  BODY: 85,
  TRANSITION: 80,
  CROSS_DAY: 80,
  COLD: 80,
  INTERRUPTION: 80,
  USER_CONTEXT: 75,
  CHARACTER_CONTEXT: 70,
  WORLDBOOK_HIGH: 65,
  WORLDBOOK: 50,
  MEMORY: 45,
  EXAMPLES: 40,
  SUMMARY: 35,
};

const UNDROPPABLE_PRIORITY = 90;
const MIN_TOKENS_PER_MESSAGE = 20;

const SUMMARY_OLDEST_MIN_KEEP = 3;

const VALID_STRATEGIES = ['drop_lowest', 'truncate_longest', 'summary_oldest'];

// ============================================================
// 默认设置
// ============================================================

export function getDefaultTokenBudgetSettings() {
  return {
    enabled: true,
    contextWindowMode: 'auto',
    manualContextWindow: 8192,
    reserveForGeneration: 1024,
    allocation: {
      system: 0.4,
      history: 0.4,
      memory: 0.1,
      summary: 0.1,
    },
    strategy: 'drop_lowest',
    worldBookBudgetRatio: 0.3,
  };
}

// ============================================================
// 深度合并 + 全字段数值安全化
// ============================================================
function getTokenBudgetSettings() {
  const settings = getAppState().get('settings') || {};
  const userTB = settings.tokenBudget || {};
  const defaults = getDefaultTokenBudgetSettings();

  const toNum = (v, fallback) => {
    if (v === null || v === undefined) return fallback;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const clampNum = (v, min, max, fallback) => {
    const n = toNum(v, fallback);
    return Math.min(max, Math.max(min, n));
  };

  const enabled = typeof userTB.enabled === 'boolean' ? userTB.enabled : defaults.enabled;
  const contextWindowMode = userTB.contextWindowMode === 'manual' ? 'manual' : 'auto';
  const manualContextWindow = clampNum(userTB.manualContextWindow, 1024, 2000000, defaults.manualContextWindow);
  const reserveForGeneration = clampNum(userTB.reserveForGeneration, 128, 8192, defaults.reserveForGeneration);
  const strategy = VALID_STRATEGIES.includes(userTB.strategy) ? userTB.strategy : defaults.strategy;
  const worldBookBudgetRatio = clampNum(userTB.worldBookBudgetRatio, 0, 0.5, defaults.worldBookBudgetRatio);

  const userAlloc = userTB.allocation || {};
  const allocation = {
    system: clampNum(userAlloc.system, 0, 1, defaults.allocation.system),
    history: clampNum(userAlloc.history, 0, 1, defaults.allocation.history),
    memory: clampNum(userAlloc.memory, 0, 1, defaults.allocation.memory),
    summary: clampNum(userAlloc.summary, 0, 1, defaults.allocation.summary),
  };

  return {
    enabled,
    contextWindowMode,
    manualContextWindow,
    reserveForGeneration,
    allocation,
    strategy,
    worldBookBudgetRatio,
  };
}

export function getWorldBookBudgetRatio() {
  return getTokenBudgetSettings().worldBookBudgetRatio;
}

// ============================================================
// 预算计算
// ============================================================

export function computeBudget(modelName) {
  const cfg = getTokenBudgetSettings();

  let contextWindow;
  if (cfg.contextWindowMode === 'manual') {
    contextWindow = cfg.manualContextWindow;
  } else {
    contextWindow = getModelContextWindow(modelName);
  }

  const reserved = cfg.reserveForGeneration;
  const available = Math.max(0, contextWindow - reserved);

  const alloc = cfg.allocation || {};
  const safeRatio = (v, fallback) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  return {
    contextWindow,
    reserved,
    available,
    breakdown: {
      system: Math.floor(available * safeRatio(alloc.system, 0.4)),
      history: Math.floor(available * safeRatio(alloc.history, 0.4)),
      memory: Math.floor(available * safeRatio(alloc.memory, 0.1)),
      summary: Math.floor(available * safeRatio(alloc.summary, 0.1)),
    },
    config: cfg,
  };
}

// ============================================================
// 策略 1：drop_lowest
// ============================================================

function fitSystemMessagesDropLowest(messages, budget) {
  const indexed = messages.map((m, i) => ({ ...m, _localIndex: i }));
  const sorted = [...indexed].sort((a, b) => b.priority - a.priority);

  const kept = [];
  const dropped = [];
  let usedTokens = 0;

  for (const msg of sorted) {
    const tokens = estimateTokens(msg.content);

    if (usedTokens + tokens <= budget) {
      kept.push({ ...msg, tokens });
      usedTokens += tokens;
    } else if (msg.priority >= UNDROPPABLE_PRIORITY) {
      const remaining = budget - usedTokens;
      if (remaining > 50) {
        const truncated = truncateToTokens(msg.content, remaining);
        kept.push({ ...msg, content: truncated, tokens: remaining, truncated: true });
        usedTokens += remaining;
      } else {
        dropped.push({ ...msg, tokens, reason: 'no_budget_left_for_undroppable' });
      }
    } else {
      dropped.push({ ...msg, tokens, reason: 'over_budget' });
    }
  }

  kept.sort((a, b) => (a._localIndex ?? 0) - (b._localIndex ?? 0));

  return { kept, dropped, usedTokens };
}

// ============================================================
// 策略 2：truncate_longest（system）
// ============================================================

function fitSystemMessagesTruncate(messages, budget) {
  const working = messages.map(msg => ({
    ...msg,
    tokens: estimateTokens(msg.content),
  }));

  let totalTokens = working.reduce((sum, m) => sum + m.tokens, 0);

  if (totalTokens <= budget) {
    return { kept: working, dropped: [], usedTokens: totalTokens };
  }

  let safetyCounter = 0;
  const SAFETY_LIMIT = 100;

  while (totalTokens > budget && safetyCounter < SAFETY_LIMIT) {
    safetyCounter++;

    let longestIdx = -1;
    let longestTokens = 0;
    for (let i = 0; i < working.length; i++) {
      const m = working[i];
      if (m.tokens <= MIN_TOKENS_PER_MESSAGE) continue;
      if (m.tokens > longestTokens) {
        longestTokens = m.tokens;
        longestIdx = i;
      }
    }

    if (longestIdx === -1) {
      console.warn('[TokenBudget] truncate_longest 达到最小值仍超预算，降级为 drop_lowest');
      return fitSystemMessagesDropLowest(messages, budget);
    }

    const needed = totalTokens - budget;
    const canTrim = longestTokens - MIN_TOKENS_PER_MESSAGE;
    const trimAmount = Math.min(needed, canTrim);
    const newTokens = longestTokens - trimAmount;

    const newContent = truncateToTokens(working[longestIdx].content, newTokens);
    working[longestIdx] = {
      ...working[longestIdx],
      content: newContent,
      tokens: newTokens,
      truncated: true,
    };

    totalTokens -= trimAmount;
  }

  return { kept: working, dropped: [], usedTokens: totalTokens };
}

// ============================================================
// 策略 3：summary_oldest
// ============================================================

function fitHistorySummaryOldest(messages, budget, summary) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { kept: [], dropped: [], usedTokens: 0 };
  }

  const hasSummary = typeof summary === 'string' && summary.trim().length > 0;

  // 无摘要时降级为 drop_lowest
  if (!hasSummary) {
    return fitHistoryMessages(messages, budget, 'drop_lowest', '');
  }

  const kept = [];
  let usedTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(msg.content) + 4;
    const overBudget = usedTokens + tokens > budget;

    // 超出预算且已达保底条数，停止（剩余旧消息由摘要替代）
    if (overBudget && kept.length >= SUMMARY_OLDEST_MIN_KEEP) {
      break;
    }

    // 未超预算，或未达保底：保留
    kept.push(msg);
    usedTokens += tokens;
  }

  kept.reverse();

  const droppedCount = messages.length - kept.length;
  const dropped = droppedCount > 0 ? messages.slice(0, droppedCount) : [];

  return { kept, dropped, usedTokens };
}

// ============================================================
// 策略 4：truncate_longest 对 history 生效
// ============================================================

function fitHistoryTruncate(messages, budget) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { kept: [], dropped: [], usedTokens: 0 };
  }

  const working = messages.map(msg => ({
    ...msg,
    tokens: estimateTokens(msg.content) + 4,
  }));

  let totalTokens = working.reduce((sum, m) => sum + m.tokens, 0);

  if (totalTokens <= budget) {
    return { kept: working, dropped: [], usedTokens: totalTokens };
  }

  let cursor = 0;
  while (totalTokens > budget && cursor < working.length) {
    const m = working[cursor];
    if (m.tokens <= MIN_TOKENS_PER_MESSAGE) {
      cursor++;
      continue;
    }
    const needed = totalTokens - budget;
    const canTrim = m.tokens - MIN_TOKENS_PER_MESSAGE;
    const trimAmount = Math.min(needed, canTrim);
    const newTokens = m.tokens - trimAmount;
    const newContent = truncateToTokens(m.content, newTokens);

    working[cursor] = {
      ...m,
      content: newContent,
      tokens: newTokens,
      truncated: true,
    };
    totalTokens -= trimAmount;
    cursor++;
  }

  const dropped = [];
  while (totalTokens > budget && working.length > 0) {
    const d = working.shift();
    totalTokens -= d.tokens;
    dropped.push(d);
  }

  return { kept: working, dropped, usedTokens: totalTokens };
}

// ============================================================
// 裁剪主入口
// ============================================================

export function fitSystemMessages(systemMessages, budget, strategy = 'drop_lowest') {
  if (!Array.isArray(systemMessages) || systemMessages.length === 0) {
    return { kept: [], dropped: [], usedTokens: 0 };
  }

  const normalized = systemMessages.map((msg, idx) => ({
    ...msg,
    priority: typeof msg.priority === 'number' ? msg.priority : PRIORITY.WORLDBOOK,
    tag: msg.tag || `untagged_${idx}`,
  }));

  switch (strategy) {
    case 'truncate_longest':
      return fitSystemMessagesTruncate(normalized, budget);
    case 'summary_oldest':
      return fitSystemMessagesDropLowest(normalized, budget);
    case 'drop_lowest':
    default:
      return fitSystemMessagesDropLowest(normalized, budget);
  }
}

export function fitHistoryMessages(messages, budget, strategy = 'drop_lowest', summary = '') {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { kept: [], dropped: [], usedTokens: 0 };
  }

  if (strategy === 'summary_oldest') {
    return fitHistorySummaryOldest(messages, budget, summary);
  }

  if (strategy === 'truncate_longest') {
    return fitHistoryTruncate(messages, budget);
  }

  const kept = [];
  const dropped = [];
  let usedTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(msg.content) + 4;

    if (usedTokens + tokens <= budget) {
      kept.unshift(msg);
      usedTokens += tokens;
    } else {
      dropped.unshift(msg);
    }
  }

  return { kept, dropped, usedTokens };
}

export function fitWorldBookRules(rules, budget) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return { kept: [], dropped: [], usedTokens: 0 };
  }

  const normalized = rules.map(r => ({
    ...r,
    _priority: typeof r.priority === 'number' ? r.priority : PRIORITY.WORLDBOOK,
  }));

  const sorted = [...normalized].sort((a, b) => b._priority - a._priority);

  const kept = [];
  const dropped = [];
  let usedTokens = 0;

  for (const rule of sorted) {
    const tokens = estimateTokens(rule.content || '');

    if (usedTokens + tokens <= budget) {
      kept.push(rule);
      usedTokens += tokens;
    } else if (kept.length === 0) {
      const truncated = truncateToTokens(rule.content || '', budget);
      kept.push({ ...rule, content: truncated, _truncated: true });
      usedTokens = budget;
    } else {
      dropped.push(rule);
    }
  }

  return { kept, dropped, usedTokens };
}

// ============================================================
// 文本截断
// ============================================================

function truncateToTokens(text, maxTokens) {
  if (!text) return '';
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) return text;

  const ratio = maxTokens / estimated;
  const targetLength = Math.floor(text.length * ratio);

  let cutPoint = targetLength;
  const candidates = ['。', '\n', '！', '？', '.', '!', '?', '，'];
  for (const c of candidates) {
    const idx = text.lastIndexOf(c, targetLength);
    if (idx > targetLength * 0.7) {
      cutPoint = idx + 1;
      break;
    }
  }

  return text.slice(0, cutPoint) + '...';
}

// ============================================================
// 统一构建消息数组
// ============================================================

export function fitContextByBudget(params) {
  const {
    modelName,
    systemMessages,
    historyMessages,
    userMessage,
    summary = '',
    systemBudgetOverride,
  } = params;

  const cfg = getTokenBudgetSettings();

  if (!cfg.enabled) {
    const budget = computeBudget(modelName);

    const sysMsgs = systemMessages.filter(m => m.tag !== 'memory' && m.tag !== 'summary');
    const memMsgs = systemMessages.filter(m => m.tag === 'memory');
    const sumMsgs = systemMessages.filter(m => m.tag === 'summary');

    const systemTokens = estimateMessagesTokens(sysMsgs);
    const memoryTokens = estimateMessagesTokens(memMsgs);
    const summaryTokens = estimateMessagesTokens(sumMsgs);
    const historyTokens = estimateMessagesTokens(historyMessages);
    const userTokens = estimateTokens(userMessage);
    const totalTokens = systemTokens + memoryTokens + summaryTokens + historyTokens + userTokens;

    return {
      systemKept: systemMessages,
      historyKept: historyMessages,
      userMessage,
      stats: {
        enabled: false,
        contextWindow: budget.contextWindow,
        reserved: budget.reserved,
        available: budget.available,
        systemBudget: budget.breakdown.system,
        memoryBudget: budget.breakdown.memory,
        summaryBudget: budget.breakdown.summary,
        historyBudget: budget.breakdown.history,
        systemUsed: systemTokens,
        memoryUsed: memoryTokens,
        summaryUsed: summaryTokens,
        historyUsed: historyTokens,
        userTokens,
        totalTokens,
        totalUsed: totalTokens,
        droppedTags: [],
        droppedCount: 0,
        strategy: cfg.strategy,
      },
    };
  }

  const budget = computeBudget(modelName);
  const userTokens = estimateTokens(userMessage);
  const historyBudget = Math.max(0, budget.breakdown.history - userTokens);
  const strategy = cfg.strategy;

  const indexed = systemMessages.map((m, i) => ({ ...m, _origIndex: i }));
  const pureSystemMsgs = indexed.filter(m => m.tag !== 'memory' && m.tag !== 'summary');
  const memoryMsgs = indexed.filter(m => m.tag === 'memory');
  const summaryMsgs = indexed.filter(m => m.tag === 'summary');

  let pureSystemBudget;
  if (typeof systemBudgetOverride === 'number' && Number.isFinite(systemBudgetOverride) && systemBudgetOverride >= 0) {
    pureSystemBudget = systemBudgetOverride;
  } else {
    pureSystemBudget = budget.breakdown.system;
  }

  const pureSystemResult = fitSystemMessages(pureSystemMsgs, pureSystemBudget, strategy);
  const memoryResult = fitSystemMessages(memoryMsgs, budget.breakdown.memory, strategy);
  const summaryResult = fitSystemMessages(summaryMsgs, budget.breakdown.summary, strategy);

  const systemKept = [
    ...pureSystemResult.kept,
    ...memoryResult.kept,
    ...summaryResult.kept,
  ].sort((a, b) => (a._origIndex ?? 0) - (b._origIndex ?? 0));

  const historyResult = fitHistoryMessages(historyMessages, historyBudget, strategy, summary);

  return {
    systemKept,
    historyKept: historyResult.kept,
    userMessage,
    stats: {
      enabled: true,
      contextWindow: budget.contextWindow,
      reserved: budget.reserved,
      available: budget.available,
      systemBudget: pureSystemBudget,
      memoryBudget: budget.breakdown.memory,
      summaryBudget: budget.breakdown.summary,
      historyBudget,
      systemUsed: pureSystemResult.usedTokens,
      memoryUsed: memoryResult.usedTokens,
      summaryUsed: summaryResult.usedTokens,
      historyUsed: historyResult.usedTokens,
      userTokens,
      totalUsed:
        pureSystemResult.usedTokens +
        memoryResult.usedTokens +
        summaryResult.usedTokens +
        historyResult.usedTokens +
        userTokens,
      droppedTags: [
        ...pureSystemResult.dropped.map(m => m.tag),
        ...memoryResult.dropped.map(m => m.tag),
        ...summaryResult.dropped.map(m => m.tag),
        ...historyResult.dropped.map((m, i) => `history_msg_${i}`),
      ],
      droppedCount:
        pureSystemResult.dropped.length +
        memoryResult.dropped.length +
        summaryResult.dropped.length +
        historyResult.dropped.length,
      strategy,
    },
  };
}

// ============================================================
// 调试
// ============================================================

export function formatBudgetReport(stats) {
  if (!stats.enabled) {
    const lines = [
      `【Token 预算】未启用。`,
      `  上下文窗口: ${stats.contextWindow}`,
      `  可用预算: ${stats.available}`,
      `  ─────────────`,
      `  系统提示: ${stats.systemUsed}`,
      `  长期记忆: ${stats.memoryUsed}`,
      `  对话摘要: ${stats.summaryUsed}`,
      `  历史消息: ${stats.historyUsed}`,
      `  用户消息: ${stats.userTokens}`,
      `  ─────────────`,
      `  实际总使用: ${stats.totalTokens}`,
    ];
    return lines.join('\n');
  }

  const strategyLabels = {
    drop_lowest: '丢弃最低优先级',
    truncate_longest: '截断最长条目',
    summary_oldest: '摘要替换最旧',
  };

  const lines = [
    `【Token 预算】`,
    `  上下文窗口: ${stats.contextWindow}`,
    `  预留生成: ${stats.reserved}`,
    `  可用预算: ${stats.available}`,
    `  ─────────────`,
    `  系统提示预算: ${stats.systemBudget} / 已用 ${stats.systemUsed}`,
    `  长期记忆预算: ${stats.memoryBudget} / 已用 ${stats.memoryUsed}`,
    `  对话摘要预算: ${stats.summaryBudget} / 已用 ${stats.summaryUsed}`,
    `  历史消息预算: ${stats.historyBudget} / 已用 ${stats.historyUsed}`,
    `  用户消息: ${stats.userTokens}`,
    `  ─────────────`,
    `  总计: ${stats.totalUsed} / ${stats.available}`,
    `  剪裁策略: ${strategyLabels[stats.strategy] || stats.strategy}`,
  ];

  if (stats.droppedCount > 0) {
    lines.push(
      `  ⚠ 丢弃 ${stats.droppedCount} 条：` +
      `${stats.droppedTags.slice(0, 5).join(', ')}` +
      `${stats.droppedTags.length > 5 ? '...' : ''}`
    );
  } else {
    lines.push(`  ✅ 无剪裁`);
  }

  return lines.join('\n');
}

export function systemMsg(content, tag, priority = PRIORITY.WORLDBOOK) {
  return { role: 'system', content, tag, priority };
}