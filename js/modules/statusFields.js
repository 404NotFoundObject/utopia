/**
 * @module statusFields
 * @description `/status <字段> <值>` 可写数值字段表。
 *
 * 为什么单独成文件：
 *   命令引擎已两千多行，而字段表 + 解析 + 夹取是纯计算，抽出来既能单测，
 *   也避免命令处理逻辑再膨胀。这里**只做纯计算**，不碰数据库——写库由
 *   命令引擎拿到 patch 后走 `updateCharacter`。
 *
 * 为什么必须显式列字段（而不是让用户写任意路径）：
 *   角色对象里混着时间戳、枚举字符串和内部结构，任意写入很容易把状态写坏
 *   （例如把 lastUpdate 改成 0 会让下一 tick 一次性推进几万小时）。白名单
 *   之外的字段一律拒绝。
 */

import { getGameTime } from './time.js';

/** 情感主维度：引擎侧 clamp 到 -100~100（emotionEngine 的 RELATION_MIN/MAX 同为此区间） */
const BIPOLAR = { min: -100, max: 100 };
/** 百分比类：体力 / 睡意 / 健康 / 需求，引擎侧统一 clamp 到 0~100 */
const PERCENT = { min: 0, max: 100 };

/**
 * 字段定义。
 * - key：主名（裸名，用户输入的首选写法）
 * - aliases：别名。带前缀的 `body.` / `emotion.` 用于消除同名歧义
 * - path：从角色对象出发的取值路径，首段决定归属（emotionState / bodyState）
 * - group：决定写回时整块替换哪一个子对象、以及刷新哪个 lastUpdate
 *
 * ⚠️ 同名坑：`emotionState.energy`（情感能量）与 `bodyState.energy`（体力）同时
 * 存在。裸名 `energy` 归 body（用户说到「精力」通常指体力），情感侧必须写
 * `emotion.energy`，否则会改错地方。
 */
const FIELDS = [
  // ---- 身体 ----
  { key: 'health', aliases: ['body.health'], group: 'body', path: ['bodyState', 'health'], label: '健康', range: PERCENT },
  { key: 'energy', aliases: ['body.energy', 'stamina'], group: 'body', path: ['bodyState', 'energy'], label: '体力', range: PERCENT },
  { key: 'sleepiness', aliases: ['body.sleepiness'], group: 'body', path: ['bodyState', 'sleepiness'], label: '睡意', range: PERCENT },
  // 睡眠债上限 = 每日需求(默认 7h) × SLEEP_DEBT_MAX_FACTOR(3)，见 bodyState.js
  { key: 'sleepdebt', aliases: ['body.sleepdebthours', 'sleepdebthours'], group: 'body', path: ['bodyState', 'sleepDebtHours'], label: '睡眠债(h)', range: { min: 0, max: 21 } },
  { key: 'sleepthours', aliases: ['body.totalsleephours', 'totalsleephours'], group: 'body', path: ['bodyState', 'totalSleepHours'], label: '今日已睡(h)', range: { min: 0, max: 24 } },
  { key: 'sleepquality', aliases: ['body.sleepquality'], group: 'body', path: ['bodyState', 'sleepQuality'], label: '睡眠质量', range: { min: 0, max: 1 } },
  { key: 'illness', aliases: ['body.illness.severity', 'illness.severity'], group: 'body', path: ['bodyState', 'illness', 'severity'], label: '疾病严重度', range: PERCENT },
  { key: 'injury', aliases: ['body.injury.severity', 'injury.severity'], group: 'body', path: ['bodyState', 'injury', 'severity'], label: '伤势严重度', range: PERCENT },

  // ---- 情感 ----
  { key: 'valence', aliases: ['emotion.valence'], group: 'emotion', path: ['emotionState', 'valence'], label: '愉悦', range: BIPOLAR },
  { key: 'arousal', aliases: ['emotion.arousal'], group: 'emotion', path: ['emotionState', 'arousal'], label: '唤醒', range: BIPOLAR },
  { key: 'dominance', aliases: ['emotion.dominance'], group: 'emotion', path: ['emotionState', 'dominance'], label: '支配', range: BIPOLAR },
  { key: 'attention', aliases: ['emotion.attention'], group: 'emotion', path: ['emotionState', 'attention'], label: '专注', range: BIPOLAR },
  { key: 'surprise', aliases: ['emotion.surprise'], group: 'emotion', path: ['emotionState', 'surprise'], label: '惊讶', range: BIPOLAR },
  { key: 'affection', aliases: ['emotion.affection'], group: 'emotion', path: ['emotionState', 'affection'], label: '好感', range: BIPOLAR },
  { key: 'trust', aliases: ['emotion.trust'], group: 'emotion', path: ['emotionState', 'trust'], label: '信任', range: BIPOLAR },
  { key: 'intimacy', aliases: ['emotion.intimacy'], group: 'emotion', path: ['emotionState', 'intimacy'], label: '亲密', range: BIPOLAR },
  { key: 'emotion.energy', aliases: ['mood.energy'], group: 'emotion', path: ['emotionState', 'energy'], label: '情感能量', range: BIPOLAR },

  // ---- 需求 ----
  { key: 'safety', aliases: ['needs.safety', 'emotion.needs.safety'], group: 'emotion', path: ['emotionState', 'needs', 'safety'], label: '安全感', range: PERCENT },
  { key: 'esteem', aliases: ['needs.esteem', 'emotion.needs.esteem'], group: 'emotion', path: ['emotionState', 'needs', 'esteem'], label: '自尊', range: PERCENT },
  { key: 'belonging', aliases: ['needs.belonging', 'emotion.needs.belonging'], group: 'emotion', path: ['emotionState', 'needs', 'belonging'], label: '归属', range: PERCENT },
  { key: 'autonomy', aliases: ['needs.autonomy', 'emotion.needs.autonomy'], group: 'emotion', path: ['emotionState', 'needs', 'autonomy'], label: '自主', range: PERCENT },
  { key: 'pleasure', aliases: ['needs.pleasure', 'emotion.needs.pleasure'], group: 'emotion', path: ['emotionState', 'needs', 'pleasure'], label: '愉悦需求', range: PERCENT },
];

/** 索引：主名 + 别名 → 字段定义 */
const INDEX = new Map();
for (const f of FIELDS) {
  INDEX.set(f.key, f);
  for (const a of f.aliases || []) INDEX.set(a, f);
}

/** 归一化：去空白、转小写、去掉前缀斜杠 */
function normalize(name) {
  return String(name ?? '').trim().toLowerCase().replace(/^\/+/, '');
}

/** 按名字查字段，未命中返回 null */
export function resolveStatusField(name) {
  return INDEX.get(normalize(name)) || null;
}

/** 全部字段（供 /status 无值查询与 fields 列表使用） */
export function listStatusFields() {
  return FIELDS.slice();
}

/** 从角色对象读出字段当前值（缺失时返回 null） */
export function readStatusValue(character, field) {
  if (!character || !field) return null;
  let cur = character;
  for (const seg of field.path) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[seg];
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : null;
}

/**
 * 解析待写入的值。
 *
 * 写法（负号有歧义，故用前缀显式区分）：
 *   `90`     绝对值
 *   `=-50`   绝对值负数（双极性字段如好感/愉悦要设成负数时用这种）
 *   `+5` / `+=5`   相对加
 *   `-5` / `-=5`   相对减
 *
 * 为什么不能让 `-50` 直接表示「设为 -50」：那样就没法表达「减 50」了。二者
 * 必然冲突，所以把带符号的一律归为相对增减，绝对值负数多写一个 `=`。
 * 超范围一律夹取到字段值域，并回报 clamped（引擎自身也是这么夹的）。
 *
 * @returns {{ok:boolean, value?:number, relative?:boolean, clamped?:boolean, error?:string}}
 */
export function parseStatusValue(expr, current, field) {
  const raw = String(expr ?? '').trim();
  if (!raw) return { ok: false, error: '缺少数值' };

  let relative = false;
  let sign = 1;
  let numPart = raw;

  const rel = /^([+-])=?\s*(.*)$/.exec(raw); // +5 / +=5 / -5 / -=5
  const abs = /^=\s*(.*)$/.exec(raw); // =90 / =-50
  if (rel && rel[2] !== '') {
    relative = true;
    sign = rel[1] === '-' ? -1 : 1;
    numPart = rel[2];
  } else if (abs && abs[1] !== '') {
    numPart = abs[1];
  }

  const parsed = sign * Number(numPart);
  if (!Number.isFinite(parsed)) return { ok: false, error: `“${raw}”不是有效数值` };

  const base = typeof current === 'number' && Number.isFinite(current) ? current : 0;
  const target = relative ? base + parsed : parsed;

  const { min, max } = field.range;
  const value = Math.max(min, Math.min(max, target));
  return { ok: true, value, relative, clamped: value !== target };
}

/**
 * 生成写回 patch。
 *
 * ⚠️ 两个必须注意的点：
 * 1. `updateCharacter` 是**浅合并**，直接传 `{ bodyState: { health: 90 } }` 会把
 *    整个子对象冲掉。所以这里返回的是深合并后的**完整子对象**。
 * 2. **必须同步 lastUpdate**。所有自然演化路径（updateBodyByTime / handleBodyEvent
 *    等）都会写 `lastUpdate = getGameTime()`；若这里不动它，下一 tick 会拿陈旧
 *    基准一次性推进大量小时数，把刚设的值立刻冲掉。手动设值相当于一次外部
 *    干预，时间基准要一并重置到当前。
 *
 * @returns {{emotionState?:object}|{bodyState?:object}}
 */
export function buildStatusPatch(character, field, value) {
  const root = field.group === 'emotion' ? 'emotionState' : 'bodyState';
  const base = character?.[root] || {};
  const next = setPath({ ...base }, field.path.slice(1), value);
  next.lastUpdate = currentGameTime();
  return { [root]: next };
}

/**
 * 取当前游戏时间。时间系统未初始化时回落到 Date.now()——
 * 一条改状态的命令不该因为时间模块还没就绪就整个崩掉。
 */
function currentGameTime() {
  try {
    const t = getGameTime();
    return Number.isFinite(t) ? t : Date.now();
  } catch {
    return Date.now();
  }
}

/** 沿路径写入，逐层浅拷贝，不改原对象 */
function setPath(target, path, value) {
  if (path.length === 1) {
    target[path[0]] = value;
    return target;
  }
  const [head, ...rest] = path;
  target[head] = setPath({ ...(target[head] || {}) }, rest, value);
  return target;
}

/** 人类可读的数值展示：整数不带小数，其余保留一位 */
export function formatStatusValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
