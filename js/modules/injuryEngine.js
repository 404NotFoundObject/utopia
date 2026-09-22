// js/modules/injuryEngine.js - 受伤引擎（三层分离设计）
//
// 设计目标：
//   1. 不做类型枚举——受伤类型由 LLM 自由生成
//   2. 不做纯概率 roll——受伤必须有语义原因
//   3. injuryResistance 有真实作用——影响判定倾向 + 数值缩放 + 恢复速率
//
// 三层架构：
//   ① 触发过滤（确定性）：关键词 + 状态 + 冷却 → 过滤 95%+ 消息
//   ② 语义裁决（LLM）：判断是否受伤 + 生成类型/严重度/时长
//   ③ 数值落地（确定性）：缩放 + 写入 + 事件
//
// 设计原则：
//   - 保守策略：任何一层失败都不受伤
//   - 冷却保护：默认 2 游戏小时内不重复判定
//   - 类型开放：受伤类型由 LLM 自由描述，不做枚举
//   - narrative 优先：LLM 生成的叙述性描述用于展示和提示词

import { getAppState } from '../core/state.js';
import { getGameTime } from './time.js';
import { updateCharacter } from './character.js';
import { sendChatRequest } from '../core/api.js';
import { getBodyProfile } from './profileDefaults.js';
import globalEventBus from '../core/eventBus.js';

// ============================================================
// 常量
// ============================================================

/**
 * 受伤提示关键词——用于第 1 层预筛。
 * 命中任一关键词才进入 LLM 裁决。
 * 这是"廉价预筛"，不是"判定"——漏网只会跳过 LLM，不会误判受伤。
 */
const INJURY_HINT_KEYWORDS = [
  // 动作类
  '摔', '跌', '撞', '划', '割', '烫', '烧', '扭', '砸', '碰',
  // 场景类
  '打架', '战斗', '搏斗', '格斗', '意外', '事故', '车祸',
  '摔倒', '跌落', '坠落', '碰撞', '受伤', '流血',
  // 身体感受类
  '痛', '疼', '伤口', '瘀', '肿', '擦伤', '扭到',
];

/**
 * 冷却窗口：同一角色在 N 游戏小时内不重复判定。
 * 防止用户连续输入含"疼"字的消息导致 LLM 频繁调用。
 */
const INJURY_CHECK_COOLDOWN_HOURS = 2;

/**
 * 单次 LLM 裁决的超时时间。
 * 超时视为"未受伤"，避免阻塞主对话流程。
 */
const INJURY_LLM_TIMEOUT_MS = 15000;

/**
 * severity 低于该值时视为"未受伤"。
 * 用于处理 injuryResistance 极高导致缩放后伤害可忽略的场景。
 */
const MIN_VISIBLE_SEVERITY = 5;

// ============================================================
// 第 1 层：触发过滤（确定性）
// ============================================================

/**
 * 判断是否值得调用 LLM 进行受伤裁决。
 *
 * 返回 true 的条件（全部满足）：
 *   1. 消息长度 ≥ 4
 *   2. 消息包含受伤关键词
 *   3. 角色当前未受伤
 *   4. 角色不在冷却窗口内
 *   5. 角色不是免疫受伤的特殊类型
 *   6. 身体状态引擎已启用
 *
 * @param {string} userMessage
 * @param {Object} character
 * @returns {boolean}
 */
export function shouldCheckInjury(userMessage, character) {
  if (!userMessage || userMessage.trim().length < 4) return false;

  // 引擎开关
  const settings = getAppState().get('settings') || {};
  if (settings.engineFlags?.bodyState === false) return false;

  if (!character || !character.bodyState) return false;

  // 已受伤 → 不重复触发
  if (character.bodyState.injury?.type) return false;

  // 特殊类型免疫
  const profile = getBodyProfile(character);
  if (isImmuneToInjury(profile)) return false;

  // 冷却窗口
  const lastCheck = character.bodyState.lastInjuryCheckTime || 0;
  const now = getGameTime();
  const hoursSince = (now - lastCheck) / (1000 * 60 * 60);
  if (lastCheck > 0 && hoursSince < INJURY_CHECK_COOLDOWN_HOURS) return false;

  // 关键词过滤
  const lower = userMessage.toLowerCase();
  const hasKeyword = INJURY_HINT_KEYWORDS.some(kw => lower.includes(kw));
  if (!hasKeyword) return false;

  return true;
}

/**
 * 判断角色是否免疫受伤（类型层面的免疫，与 injuryResistance 无关）。
 *
 * 免疫规则：
 *   - immortal / angel / spirit：无实体或超自然存在，不受伤
 *   - injuryResistance >= 0.99：用户手动设置极高抵抗，视为免疫
 *
 * 注意：undead（亡灵）不在免疫列表——亡灵虽不会因时间衰减，
 *       但物理伤害对其仍有意义（与 illness 的免疫判定保持一致）。
 */
function isImmuneToInjury(profile) {
  if (!profile) return false;
  return profile.special === 'immortal'
    || profile.special === 'angel'
    || profile.special === 'spirit'
    || profile.injuryResistance >= 0.99;
}

// ============================================================
// 第 2 层：语义裁决（LLM）
// ============================================================

/**
 * 调用 LLM 判断当前情境下角色是否受伤。
 *
 * @param {string} userMessage - 用户消息
 * @param {Object} character - 角色对象
 * @returns {Promise<Object|null>} 裁决结果或 null（失败）
 */
async function judgeInjuryWithLLM(userMessage, character) {
  const profile = getBodyProfile(character);
  const bodyState = character.bodyState;
  const injuryResistance = profile.injuryResistance ?? 0.5;

  const prompt = buildInjuryPrompt(userMessage, character, injuryResistance, bodyState);

  try {
    const response = await Promise.race([
      sendChatRequest({
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: '你是角色扮演中的"身体状态分析器"。只输出 JSON 对象，不要任何解释。',
        temperature: 0.2,
        maxTokens: 250,
        stream: false,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Injury LLM timeout')), INJURY_LLM_TIMEOUT_MS)
      ),
    ]);

    const content = response.content?.trim();
    if (!content) return null;

    return parseInjuryJson(content);
  } catch (e) {
    console.warn('[Injury] LLM 裁决失败:', e.message);
    return null;
  }
}

/**
 * 构建受伤裁决的 prompt。
 *
 * 关键约束：
 *   - 明确说明"只有叙述中确实包含可能造成物理伤害的事件才判定受伤"
 *   - 明确说明 injuryResistance 的语义
 *   - 受伤类型用自然语言描述，不枚举
 *   - 明确 duration_hours 的语义
 */
function buildInjuryPrompt(userMessage, character, injuryResistance, bodyState) {
  const resistanceDesc = describeResistance(injuryResistance);
  const healthDesc = bodyState.health >= 70 ? '健康'
    : bodyState.health >= 40 ? '轻伤未愈'
    : '身体虚弱';

  return `判断当前情境下角色是否应该发生"受伤"。

【角色信息】
- 名称：${character.name}
- 受伤抵抗：${injuryResistance.toFixed(2)}（${resistanceDesc}）
- 当前健康：${Math.round(bodyState.health)}（${healthDesc}）

【用户叙述】
${userMessage}

【判定原则】
1. 只有叙述中**确实包含可能造成物理伤害的事件**才判定受伤。
   - 摔倒、撞击、打斗、被烫伤、被划伤、意外事故 → 可能受伤
   - 情绪波动、日常活动、亲密互动、聊天、开玩笑 → 不应受伤
2. 受伤抵抗高的角色，仅在**高危情境**下才受伤，且**伤势更轻**。
3. 受伤抵抗低的角色，**轻微意外**也可能受伤。
4. 受伤类型用**自然语言**描述（如"扭伤脚踝"、"手臂划伤"、"轻微脑震荡"），不要套用固定分类。
5. duration_hours 是恢复所需的游戏小时数，普通擦伤 24-48 小时，骨折可能数天。

【输出格式】
只输出一个 JSON，不要解释，不要 markdown 代码块：
{
  "injured": true,
  "type": "受伤类型的自然语言描述",
  "severity": 严重程度整数（0-100）,
  "duration_hours": 恢复所需游戏小时数（整数）,
  "narrative": "一句话描述受伤经过（用于注入提示词，15字以内）"
}

若判定为**不受伤**（包括叙述中无危险事件、或角色抵抗足够高使伤害可忽略），输出：
{"injured": false}
`;
}

/**
 * 将 injuryResistance 数值转换为自然语言描述。
 */
function describeResistance(r) {
  if (r >= 0.8) return '极强（几乎不会受伤）';
  if (r >= 0.6) return '较强';
  if (r >= 0.4) return '普通';
  if (r >= 0.2) return '较弱';
  return '极弱（极易受伤）';
}

/**
 * 解析 LLM 返回的 JSON（多层次容错）。
 *
 * 容错层级：
 *   1. 剥离 markdown 代码块
 *   2. 直接解析
 *   3. 提取最外层 JSON 对象
 *   4. 返回 null（失败）
 */
function parseInjuryJson(text) {
  if (!text) return null;

  // 剥离 markdown 代码块
  let cleaned = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();

  // 尝试直接解析
  let parsed = tryParse(cleaned);
  if (parsed) return validateInjuryResult(parsed);

  // 提取最外层 JSON
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    parsed = tryParse(jsonMatch[0]);
    if (parsed) return validateInjuryResult(parsed);
  }

  return null;
}

function tryParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * 校验并规范化 LLM 返回的结构。
 *
 * 校验项：
 *   - injured 必须是 boolean
 *   - injured = true 时，type 必须是非空字符串
 *   - severity / duration_hours 会被 clamp 到合理范围
 *   - narrative 会被截断到 60 字符
 *   - type 会被截断到 30 字符
 */
function validateInjuryResult(raw) {
  if (!raw || typeof raw !== 'object') return null;

  // 不受伤情形
  if (raw.injured === false) {
    return { injured: false };
  }

  // 受伤情形：校验必填字段
  if (raw.injured !== true) return null;
  if (typeof raw.type !== 'string' || !raw.type.trim()) return null;

  const severity = Math.max(0, Math.min(100, parseInt(raw.severity, 10) || 30));
  const durationHours = Math.max(1, Math.min(720, parseInt(raw.duration_hours, 10) || 24));
  const narrative = (typeof raw.narrative === 'string')
    ? raw.narrative.trim().slice(0, 60)
    : `角色${raw.type}`;

  return {
    injured: true,
    type: raw.type.trim().slice(0, 30),
    severity,
    durationHours,
    narrative,
  };
}

// ============================================================
// 第 3 层：数值落地（确定性）
// ============================================================

/**
 * 将 LLM 裁决结果按 injuryResistance / recoverySpeed 缩放后写入 character.bodyState。
 *
 * 缩放规则：
 *   severity:
 *     scaled = raw × (1 - injuryResistance × 0.5)
 *     r = 0.0 → ×1.00（不缩放）
 *     r = 0.5 → ×0.75（基准）
 *     r = 1.0 → ×0.50（严重减半）
 *
 *   durationHours:
 *     scaled = raw / (0.5 + recoverySpeed) / (0.5 + injuryResistance)
 *     r=0.5, speed=1.0 → raw / 2.25
 *     r=1.0, speed=2.0 → raw / 3.75
 *
 * 若缩放后的 severity < MIN_VISIBLE_SEVERITY，视为"未受伤"（抵抗高到伤害可忽略）。
 *
 * @param {Object} character
 * @param {Object} result - judgeInjuryWithLLM 的返回值
 * @returns {Promise<boolean>} 是否实际写入
 */
async function applyInjury(character, result) {
  if (!result || !result.injured) return false;

  const profile = getBodyProfile(character);
  const bodyState = character.bodyState;

  const resistance = profile.injuryResistance ?? 0.5;
  const recovery = profile.recoverySpeed ?? 1.0;

  const scaledSeverity = Math.round(result.severity * (1 - resistance * 0.5));
  const scaledDuration = result.durationHours / (0.5 + recovery) / (0.5 + resistance);

  // 极小严重度视为"未受伤"
  if (scaledSeverity < MIN_VISIBLE_SEVERITY) {
    console.log(`[Injury] ${character.name} 受伤抵抗过高，${result.type} 被忽略`);
    return false;
  }

  bodyState.injury = {
    type: result.type,
    severity: scaledSeverity,
    startTime: getGameTime(),
    duration: 0,                              // 已恢复时长（由 bodyState 引擎累加）
    recoveryRate: 1.0,
    location: '',
    narrative: result.narrative,              // ★ LLM 生成的叙述性描述
    expectedDurationHours: scaledDuration,    // ★ 预估恢复时长（游戏小时）
  };

  await updateCharacter(character.id, { bodyState }, { skipReload: true });

  globalEventBus.emit('body:injury', {
    characterId: character.id,
    injury: bodyState.injury,
    timestamp: Date.now(),
  });

  console.log(
    `[Injury] ${character.name} 受伤: ${result.type} ` +
    `(severity=${scaledSeverity}, 预计 ${Math.round(scaledDuration)}h 恢复)`
  );

  return true;
}

// ============================================================
// 公开入口
// ============================================================

/**
 * 主入口：检查并应用受伤。
 *
 * 调用时机：在 chat.js 的用户消息处理流程中，UI 事件之后、生成回复之前。
 *
 * 失败降级：任何一层出错都不影响主流程（保守策略 = 不受伤）。
 *
 * @param {Object} character
 * @param {string} userMessage
 * @returns {Promise<boolean>} 是否发生了新的受伤
 */
export async function checkAndApplyInjury(character, userMessage) {
  try {
    // 第 1 层：触发过滤
    if (!shouldCheckInjury(userMessage, character)) return false;

    // 记录检查时间（无论结果如何，都进入冷却）
    // 这样即使 LLM 失败/超时，也能防止频繁重试
    const bodyState = character.bodyState;
    bodyState.lastInjuryCheckTime = getGameTime();
    await updateCharacter(character.id, { bodyState }, { skipReload: true });

    // 第 2 层：语义裁决
    const result = await judgeInjuryWithLLM(userMessage, character);
    if (!result || !result.injured) return false;

    // 第 3 层：数值落地
    return await applyInjury(character, result);
  } catch (e) {
    console.warn('[Injury] 检查失败:', e);
    return false;
  }
}

// ============================================================
// 调试工具（可选）
// ============================================================

/**
 * 手动触发一次受伤裁决（绕过冷却）。
 * 用于测试或调试场景。
 *
 * @param {Object} character
 * @param {string} userMessage
 * @returns {Promise<Object|null>} 裁决结果
 */
export async function debugJudgeInjury(character, userMessage) {
  if (!character || !character.bodyState) {
    console.warn('[Injury] debugJudgeInjury: 无效的 character');
    return null;
  }
  const result = await judgeInjuryWithLLM(userMessage, character);
  console.log('[Injury] debug 裁决结果:', result);
  return result;
}

/**
 * 获取当前受伤检查的配置参数（用于调试展示）。
 */
export function getInjuryConfig() {
  return {
    cooldownHours: INJURY_CHECK_COOLDOWN_HOURS,
    llmTimeoutMs: INJURY_LLM_TIMEOUT_MS,
    minVisibleSeverity: MIN_VISIBLE_SEVERITY,
    keywordCount: INJURY_HINT_KEYWORDS.length,
  };
}