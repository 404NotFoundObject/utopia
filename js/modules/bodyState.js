// js/modules/bodyState.js - 身体状态引擎（含个性化 profile 与特殊类型）
import { getStores } from '../core/db.js';
import { getAppState } from '../core/state.js';
import { getGameTime, getGameDate } from './time.js';
import { updateCharacter } from './character.js';
import { getEmotionLabel } from './emotionEngine.js';
import globalEventBus from '../core/eventBus.js';
import {
  getBodyProfile,
  getCircadianMultiplier,
} from './profileDefaults.js';
import { sendChatRequest } from '../core/api.js';

// ---------- 常量（基础速率，被 profile 因子缩放） ----------
const ENERGY_DECAY_RATE = 2;
const SLEEPINESS_INCREASE_RATE = 3;
const HEALTH_DECAY_RATE = 0.5;
const RECOVERY_RATE_SLEEP = 8;
// 审计 P3-6：RECOVERY_RATE_REST / MIN_SLEEP_HOURS 为死常量（仅声明、从未读取），已删除。

// ---------- 睡眠债（审计 P3-6 / P3-8） ----------
// 睡眠债以「小时」计量：清醒时把每日睡眠需求摊到 24 小时持续累积，
// 睡眠时按实际睡眠时长 × 睡眠质量偿还，永不为负。
// 在此之前代码里没有任何「没睡够」的概念：生病只看 health < 50，
// 熬几个通宵也不会有事，FAQ「长期不睡会生病」是与代码不符的空头承诺。
const SLEEP_DEBT_MAX_FACTOR = 3;      // 债务上限 = 每日需求 × 3（睡再多债也不会一次还清）
const SLEEP_DEBT_SICK_THRESHOLD = 1.5; // 债务 / 每日需求 ≥ 1.5 时开始独立判定生病
const SLEEP_DEBT_SICK_RATE = 0.006;    // 睡眠债致病的每小时基础概率
const NAP_REPAY_FACTOR = 0.8;          // 午休的还债效率低于夜间睡眠
const SLEEP_DEBT_SLEEPINESS_GAIN = 0.4; // 债务对睡意增速的加成系数
const SLEEP_DEBT_ENERGY_GAIN = 0.25;    // 债务对清醒时精力消耗的加成系数
const SLEEP_DEBT_HEALTH_GAIN = 0.5;     // 债务对健康衰减的加成系数
const SLEEP_DEBT_RECOVERY_GAIN = 0.15;  // 债务对睡眠恢复的加成系数（补觉睡得更沉）

// ============================================================
// 引擎开关
// ============================================================
function isBodyStateEngineEnabled() {
  const settings = getAppState().get('settings') || {};
  return settings.engineFlags?.bodyState !== false;
}

// ============================================================
// 性别键归一化
// ============================================================
function normalizeGenderKey(gender) {
  if (gender === 'non-binary') return 'non_binary';
  return gender || 'unknown';
}

// ============================================================
// 特殊类型辅助
// ============================================================

/**
 * 判断角色是否属于"永不睡眠/永不生病"的类型
 * @private
 */
function isImmortalLike(profile) {
  return profile.special === 'immortal'
    || profile.special === 'angel'
    || profile.special === 'undead'
    || profile.special === 'spirit';
}

/**
 * 判断角色是否属于"无睡意"的类型
 * @private
 */
function hasNoSleepiness(profile) {
  return isImmortalLike(profile)
    || profile.special === 'artificial';
}

// ---------- 默认状态 ----------
export function getDefaultBodyState() {
  const now = getGameTime();
  return {
    energy: 80,
    sleepiness: 30,
    health: 95,
    consciousness: '清醒',
    sleepStatus: '清醒',
    specialStates: [],
    illness: {
      type: null,
      severity: 0,
      startTime: 0,
      duration: 0,
      recoveryRate: 1.0,
    },
    injury: {
      type: null,
      severity: 0,
      startTime: 0,
      duration: 0,
      recoveryRate: 1.0,
      location: '',
      narrative: '',
      expectedDurationHours: 0,
    },
    lastWakeTime: now,
    // 审计 P3-6：totalSleepHours 原为「累计睡眠时长」，写了从不读。
    // 现改为「当日已睡小时数」（含午休），跨游戏日自动清零，
    // 由睡眠债结算、身体描述与 /inspect 共同消费。
    totalSleepHours: 0,
    sleepLedgerDate: null,
    sleepQuality: 1.0,
    // 审计 P3-6：dreamContent 原为死字段，现由睡醒时的梦境生成写入（见 generateDream）。
    dreamContent: '',
    lastDreamDate: null,
    // 审计 P3-6 / P3-8：睡眠债（小时）。见 applySleepDebt。
    sleepDebtHours: 0,
    lastUpdate: now,
    napStartTime: 0,
    lastNapDecideDate: null,
    lastNapDate: null,
    lastInjuryCheckTime: 0,
  };
}

// ---------- 基于游戏时间和性格初始化身体状态 ----------
export function getInitialBodyState(gameTime, personality) {
  const state = getDefaultBodyState();
  const p = personality || {};
  const neuroticism = (p.neuroticism || 50) / 100;
  const extraversion = (p.extraversion || 50) / 100;
  const conscientiousness = (p.conscientiousness || 50) / 100;

  const date = new Date(gameTime);
  const hour = date.getHours();

  let baseSleepiness = 30;
  let baseEnergy = 80;
  let sleepStatus = '清醒';
  let consciousness = '清醒';

  if (hour >= 23 || hour < 6) {
    baseSleepiness = 80 + 10 * (1 - conscientiousness);
    baseEnergy = 30 - 10 * neuroticism;
    sleepStatus = Math.random() > 0.5 ? '浅睡' : '深睡';
    consciousness = '迷糊';
    state.sleepQuality = 0.8 + 0.2 * (1 - neuroticism);
  } else if (hour >= 6 && hour < 8) {
    baseSleepiness = 40 - 20 * conscientiousness;
    baseEnergy = 60 + 20 * (1 - neuroticism);
    sleepStatus = '清醒';
    consciousness = '清醒';
    state.sleepQuality = 1.0;
  } else if (hour >= 12 && hour < 14) {
    baseSleepiness = 50 + 10 * (1 - conscientiousness);
    baseEnergy = 70 - 10 * neuroticism;
    sleepStatus = Math.random() > 0.6 ? '困倦' : '清醒';
    consciousness = '清醒';
    state.sleepQuality = 0.9;
  } else {
    baseSleepiness = 30 - 10 * (1 - conscientiousness);
    baseEnergy = 80 - 10 * neuroticism;
    sleepStatus = '清醒';
    consciousness = '清醒';
    state.sleepQuality = 1.0;
  }

  state.sleepiness = Math.max(0, Math.min(100, baseSleepiness));
  state.energy = Math.max(0, Math.min(100, baseEnergy));
  state.sleepStatus = sleepStatus;
  state.consciousness = consciousness;
  state.lastWakeTime = gameTime;
  state.totalSleepHours = 0;
  state.health = 95 - 10 * neuroticism;

  state.lastUpdate = gameTime;
  return state;
}

// ---------- 获取当前时段 ----------
// 审计 P3-5：清晨边界与 time.js 的 getPeriod 统一为 5–8（原为 6–8），
// 消除「5:00–6:00 时段划分不一致」的漂移。
// 注：本模块沿用「午间」命名（区别于 time.js 的「中午」），因 bodyState
// 内部多处字符串判断依赖「午间」，二者各自自洽，仅此处边界需对齐。
function getTimePeriod(date) {
  const d = date || getGameDate();
  const hour = d.getHours();
  if (hour >= 5 && hour < 8) return '清晨';
  if (hour >= 8 && hour < 12) return '上午';
  if (hour >= 12 && hour < 14) return '午间';
  if (hour >= 14 && hour < 18) return '下午';
  if (hour >= 18 && hour < 20) return '傍晚';
  if (hour >= 20 && hour < 23) return '夜晚';
  if (hour >= 23 || hour < 5) return '深夜';
  return '其他';
}

// ============================================================
// 午休逻辑（个性化：allowNapping / napTendency）
// ============================================================

/**
 * 午休窗口：12:00 ~ 14:00
 */
function isNapWindow(hour) {
  return hour >= 12 && hour < 14;
}

/**
 * 生成"日期键"，用于判断"今日是否已午休/已判定"
 */
function getDateKey(gameDate) {
  return `${gameDate.getFullYear()}-${gameDate.getMonth()}-${gameDate.getDate()}`;
}

// ============================================================
// 睡眠债（审计 P3-6 / P3-8）
// ============================================================

/**
 * 懒补齐睡眠债相关字段。老角色的 bodyState 里没有这些键，
 * 直接参与算术会得到 NaN 并把 NaN 写回数据库。
 */
function ensureSleepDebtFields(state) {
  if (typeof state.sleepDebtHours !== 'number' || !Number.isFinite(state.sleepDebtHours)) {
    state.sleepDebtHours = 0;
  }
  if (typeof state.totalSleepHours !== 'number' || !Number.isFinite(state.totalSleepHours)) {
    state.totalSleepHours = 0;
  }
  if (state.sleepLedgerDate === undefined) state.sleepLedgerDate = null;
  if (state.lastDreamDate === undefined) state.lastDreamDate = null;
  if (typeof state.dreamContent !== 'string') state.dreamContent = '';
  state.sleepDebtHours = Math.max(0, state.sleepDebtHours);
}

/**
 * 每日睡眠需求（小时）。profile 缺失或非法时回落 7 小时。
 */
function getSleepNeedHours(profile) {
  const need = Number(profile && profile.sleepNeedHours);
  return Number.isFinite(need) && need > 0 ? need : 7;
}

/**
 * 债务比：当前债务 ÷ 每日需求。1.0 表示整整欠了一天的量。
 */
function getSleepDebtRatio(state, profile) {
  return state.sleepDebtHours / getSleepNeedHours(profile);
}

/**
 * 当日睡眠统计跨游戏日清零（totalSleepHours 是「当日已睡」而非累计值）。
 */
function rollSleepLedger(state, gameDate) {
  const todayKey = getDateKey(gameDate);
  if (state.sleepLedgerDate !== todayKey) {
    state.sleepLedgerDate = todayKey;
    state.totalSleepHours = 0;
  }
  return todayKey;
}

/**
 * 累积 / 偿还睡眠债。
 * @param {'sleep'|'nap'|'awake'} mode 睡眠模式（nap 的还债效率低于夜间睡眠）
 */
function applySleepDebt(state, profile, hours, mode) {
  ensureSleepDebtFields(state);
  // 无睡意类型（不死之身 / 人造生命等）不产生也不偿还睡眠债
  if (hasNoSleepiness(profile)) {
    state.sleepDebtHours = 0;
    return;
  }

  const need = getSleepNeedHours(profile);
  if (mode === 'sleep' || mode === 'nap') {
    const quality = typeof state.sleepQuality === 'number' && Number.isFinite(state.sleepQuality)
      ? state.sleepQuality
      : 1;
    const efficiency = mode === 'nap' ? NAP_REPAY_FACTOR : 1;
    state.sleepDebtHours = Math.max(0, state.sleepDebtHours - hours * quality * efficiency);
    state.totalSleepHours += hours;
  } else {
    // 清醒时按「每日需求摊到 24 小时」连续累积：清醒一整天正好欠一天的量
    state.sleepDebtHours = Math.min(
      need * SLEEP_DEBT_MAX_FACTOR,
      state.sleepDebtHours + hours * (need / 24)
    );
  }
}

/**
 * 处理午休状态转换。
 */
function processNapping(state, profile, gameDate, gameNow) {
  // ---- 兼容老角色 bodyState：懒补齐缺失字段 ----
  if (state.napStartTime === undefined) state.napStartTime = 0;
  if (state.lastNapDecideDate === undefined) state.lastNapDecideDate = null;
  if (state.lastNapDate === undefined) state.lastNapDate = null;
  ensureSleepDebtFields(state);

  const hour = gameDate.getHours();
  const inWindow = isNapWindow(hour);
  const todayKey = getDateKey(gameDate);

  // ============================================================
  // (1) 午休唤醒检查
  // ============================================================
  if (state.napStartTime > 0) {
    const napElapsedHours = (gameNow - state.napStartTime) / (1000 * 60 * 60);
    const napDuration = 0.3 + profile.napTendency * 0.7;

    const shouldWake =
      !inWindow ||
      napElapsedHours >= napDuration ||
      state.sleepiness < 15 ||
      state.energy > 90;

    if (!shouldWake) return null;

    state.sleepStatus = '清醒';
    state.consciousness = '清醒';
    state.lastWakeTime = gameNow;
    // 审计 P3-6：午休时长计入当日睡眠并按较低效率偿还睡眠债
    applySleepDebt(state, profile, napElapsedHours, 'nap');
    state.sleepiness = Math.max(0, state.sleepiness - 40);
    state.energy = Math.min(100, state.energy + 20);
    state.sleepQuality = Math.min(1.0, state.sleepQuality + 0.1);
    state.napStartTime = 0;
    return 'nap-end';
  }

  // ============================================================
  // (2) 午休触发判定（仅首次进入窗口时判定一次）
  // ============================================================
  if (!inWindow) return null;
  if (!profile.allowNapping) return null;
  if (state.lastNapDecideDate === todayKey) return null;
  if (state.sleepStatus !== '清醒' && state.sleepStatus !== '困倦') return null;
  if (state.sleepiness < 55) return null;
  if (state.energy >= 75) return null;

  state.lastNapDecideDate = todayKey;

  if (Math.random() >= profile.napTendency) return null;

  state.sleepStatus = '浅睡';
  state.consciousness = '迷糊';
  state.napStartTime = gameNow;
  state.lastNapDate = todayKey;
  return 'nap-start';
}

// ---------- 分段推进（审计 S-2） ----------
// 单次 updateBodyByTime 会收到「好几天没开应用」攒下的巨大 hours。此前整段
// 只做一次「睡 / 醒」判定、并把全部时长一次性套用：入睡态把整段全算成睡觉，
// 清醒态把整段全算成清醒 —— 后者尤其致命：角色连续清醒几十个游戏小时、睡眠债
// 一口气顶到 3 倍上限，回归后立刻被「缺觉致病」判定判病，而玩家只觉得莫名其妙。
// 这里把长跨度切成 ≤1 游戏小时的小步逐段推进，让睡/醒转换、昼夜节律与债务
// 结算在跨度内部自然发生。步数上限兜底，避免超长离线把主线程卡住。
const BODY_STEP_HOURS = 1;
const BODY_MAX_STEPS = 720;   // 30 天 @1h；更长的跨度自动放大步长

// ---------- 自然入睡（审计 S-1） ----------
// 此前「困倦」是个死胡同：只有 energy<10 且 sleepiness>90 才会睡着，
// 等价于「必须先昏厥才能睡觉」。于是角色几十小时不睡、债务打满、一睡又是长睡
// 不起。这里补上困倦 → 入睡的正常通道。
const SLEEP_ONSET_BEDTIME = 60;    // 夜间（夜晚/深夜/清晨）就寝的睡意阈值
const SLEEP_DEEP_THRESHOLD = 70;   // 刚躺下、睡意仍重 → 转深睡（前半夜睡得沉）
const INSOMNIA_BASE_RATE = 0.05;   // 「困但睡不着」的每小时基础概率（× 神经质）

/**
 * 推进一小段身体状态。updateBodyByTime 会把它按 BODY_STEP_HOURS 切成多步调用。
 *
 * @param {Object} character
 * @param {Object} profile - getBodyProfile(character) 的结果
 * @param {number} hours - 本步推进的游戏小时数
 * @param {Date} at - 本步结束时对应的游戏时刻（昼夜节律按它算，而非「现在」）
 * @param {boolean} verbose - 是否打印午休等过程日志（长跨度分段时关闭，避免刷屏）
 * @returns {boolean} 本步是否自然睡醒（供上层触发梦境生成）
 */
function simulateBodyStep(character, profile, hours, at, verbose) {
  const state = character.bodyState;
  const personality = character.personalityParameters || {};
  const neuroticism = (personality.neuroticism || 50) / 100;
  const extraversion = (personality.extraversion || 50) / 100;
  const agreeableness = (personality.agreeableness || 50) / 100;
  const conscientiousness = (personality.conscientiousness || 50) / 100;

  const gameDate = at;
  const nowTs = at.getTime();
  const circadian = getCircadianMultiplier(gameDate.getHours(), profile);
  const period = getTimePeriod(gameDate);

  // 睡眠债（审计 P3-6 / P3-8）：本步用「进入时的债务」影响各项速率，
  // 步末再按实际睡/醒结算，避免同一次计算里自相矛盾。
  ensureSleepDebtFields(state);
  rollSleepLedger(state, gameDate);
  const debtRatio = getSleepDebtRatio(state, profile);
  const debtAmplify = Math.min(debtRatio, SLEEP_DEBT_MAX_FACTOR);

  // ============================================================
  // ★ 午休逻辑
  // ============================================================
  const napAction = processNapping(state, profile, gameDate, nowTs);
  if (napAction && verbose) {
    console.log(`[BodyState] ${character.name || character.id} 午休${napAction === 'nap-start' ? '开始' : '结束'}`);
  }

  const isSleeping = (state.sleepStatus === '浅睡' || state.sleepStatus === '深睡');
  // 本步是否自然睡醒（浅睡 → 清醒），用于触发梦境生成
  let wokeUpNaturally = false;

  // ============================================================
  // 精力
  // ============================================================
  let energyChange = 0;
  if (isSleeping) {
    const quality = state.sleepQuality;
    // 欠觉越多补觉睡得越沉（债务对恢复的正向加成）
    energyChange = RECOVERY_RATE_SLEEP * quality * hours
      * profile.energyRecoveryFactor
      * (1 + state.health / 200)
      * (1 + debtAmplify * SLEEP_DEBT_RECOVERY_GAIN);
  } else {
    let baseConsume = ENERGY_DECAY_RATE * hours
      * profile.energyDecayFactor
      * circadian
      * (1 - conscientiousness * 0.1)
      * (1 + debtAmplify * SLEEP_DEBT_ENERGY_GAIN);
    if (state.specialStates.includes('亢奋')) baseConsume *= 1.5;
    if (state.specialStates.includes('萎靡')) baseConsume *= 0.7;
    if (period === '深夜') baseConsume *= 1.2;
    energyChange = -baseConsume;
  }
  state.energy = Math.max(0, Math.min(100, state.energy + energyChange));

  // ============================================================
  // 睡意
  // ============================================================
  if (hasNoSleepiness(profile)) {
    state.sleepiness = 0;
  } else {
    let sleepinessChange = 0;
    if (isSleeping) {
      sleepinessChange = -8 * hours * state.sleepQuality;
    } else {
      // 睡眠债让困意来得更早、更猛
      let baseIncrease = SLEEPINESS_INCREASE_RATE * hours
        * profile.sleepinessRateFactor
        / Math.max(0.5, circadian)
        * (1 - conscientiousness * 0.1)
        * (1 + debtAmplify * SLEEP_DEBT_SLEEPINESS_GAIN);
      if (period === '深夜') baseIncrease *= 2;
      else if (period === '午间') baseIncrease *= 1.5;
      else if (period === '清晨') baseIncrease *= 0.5;
      const emotion = getEmotionLabel(character.emotionState);
      if (emotion === '兴奋' || emotion === '惊喜') baseIncrease *= 0.5;
      if (emotion === '悲伤' || emotion === '愤怒') baseIncrease *= 1.5;
      if (state.specialStates.includes('失眠')) baseIncrease *= 1.5;
      sleepinessChange = baseIncrease;
    }
    state.sleepiness = Math.max(0, Math.min(100, state.sleepiness + sleepinessChange));
  }

  // ============================================================
  // 睡眠状态切换
  // ============================================================
  if (isSleeping) {
    if (state.sleepStatus === '深睡' && state.sleepiness < 30) {
      state.sleepStatus = '浅睡';
      state.consciousness = '迷糊';
    } else if (state.sleepStatus === '浅睡' && state.sleepiness < 20) {
      state.sleepStatus = '清醒';
      state.consciousness = '清醒';
      state.lastWakeTime = nowTs;
      // 本步的睡眠时长由末尾 applySleepDebt 统一结算（不再在此处重复累加）
      wokeUpNaturally = true;
    } else if (state.sleepStatus === '浅睡' && state.sleepiness >= SLEEP_DEEP_THRESHOLD) {
      // 刚躺下、睡意还重 → 沉下去；后半夜睡意退了再自然转回浅睡
      state.sleepStatus = '深睡';
    }
  } else {
    const sleepinessThreshold = 80 - (profile.sleepNeedHours - 7) * 3;
    // ★ 自然入睡通道（审计 S-1）：困倦不再只是个展示用的中间态，睡意到位就躺下。
    //   夜间阈值更低（到点就寝），白天要攒够睡意才会睡。
    const isBedtime = period === '夜晚' || period === '深夜' || period === '清晨';
    const onsetThreshold = isBedtime
      ? Math.min(sleepinessThreshold, SLEEP_ONSET_BEDTIME)
      : sleepinessThreshold;

    if (state.sleepiness >= onsetThreshold) {
      // 神经质高的角色偶尔「困但睡不着」：这一步维持困倦，由下面的失眠判定挂上状态
      const insomniaChance = INSOMNIA_BASE_RATE * neuroticism * hours;
      if (insomniaChance > 0 && Math.random() < insomniaChance) {
        state.sleepStatus = '困倦';
      } else {
        state.sleepStatus = '浅睡';
        state.consciousness = '迷糊';
      }
    } else if (state.sleepiness > 50 && (period === '深夜' || period === '午间')) {
      state.sleepStatus = '困倦';
    } else {
      state.sleepStatus = '清醒';
    }
    if (state.energy < 10 && state.sleepiness > 90) {
      // 力竭昏厥：与主动入睡区分开，意识直接掉到「昏厥」
      state.sleepStatus = '深睡';
      state.consciousness = '昏厥';
      state.lastWakeTime = nowTs;
    }
  }

  // ============================================================
  // 健康
  // ============================================================
  let healthChange = 0;
  if (isSleeping) {
    healthChange = RECOVERY_RATE_SLEEP * hours * 0.5
      * profile.recoverySpeed
      * (1 + agreeableness * 0.2);
  } else {
    // 长期缺觉拖垮身体：健康衰减随债务放大
    let baseHealthDecay = HEALTH_DECAY_RATE * hours
      * (1 + neuroticism * 0.5)
      * (1 + debtAmplify * SLEEP_DEBT_HEALTH_GAIN);
    if (state.specialStates.includes('萎靡')) baseHealthDecay *= 1.5;
    baseHealthDecay /= Math.max(0.3, profile.constitution * 1.5 + 0.3);
    healthChange = -baseHealthDecay;
  }
  if (state.illness.type) {
    healthChange *= (1 - state.illness.severity / 200);
  }
  if (state.injury.type) {
    healthChange *= (1 - state.injury.severity / 200);
  }
  state.health = Math.max(0, Math.min(100, state.health + healthChange));

  // ============================================================
  // 特殊状态
  // ============================================================
  const emotionLabel = getEmotionLabel(character.emotionState);
  if (state.energy > 70 && (emotionLabel === '兴奋' || emotionLabel === '爱慕')) {
    if (!state.specialStates.includes('亢奋')) state.specialStates.push('亢奋');
  } else {
    state.specialStates = state.specialStates.filter(s => s !== '亢奋');
  }
  if (state.energy < 30 || emotionLabel === '悲伤' || emotionLabel === '愤怒') {
    if (!state.specialStates.includes('萎靡')) state.specialStates.push('萎靡');
  } else {
    state.specialStates = state.specialStates.filter(s => s !== '萎靡');
  }

  // ============================================================
  // 生病概率
  // ============================================================
  // 审计 P3-8：生病不再只看健康值。睡眠债过重会压低免疫力，即使健康值还很高
  // 也可能病倒——这才是 FAQ 一直承诺、但代码里从未实现的「长期不睡会生病」。
  if (!state.illness.type) {
    const resistanceFactor = 2 - profile.illnessResistance * 2;
    let illnessChance = 0;
    if (state.health < 50) {
      illnessChance = 0.01 * hours * (1 + neuroticism) * resistanceFactor;
    }
    const sickFromDebt = debtRatio >= SLEEP_DEBT_SICK_THRESHOLD;
    if (sickFromDebt) {
      // 债务越重概率越高：刚过阈值约 0.6%/游戏小时，触顶（3 倍需求）约 1.5%/游戏小时
      const debtChance = SLEEP_DEBT_SICK_RATE * hours
        * (debtRatio - SLEEP_DEBT_SICK_THRESHOLD + 1)
        * resistanceFactor;
      illnessChance = Math.max(illnessChance, debtChance);
    }
    if (illnessChance > 0 && Math.random() < Math.min(1, illnessChance)) {
      // 缺觉致病的病因池不含胃炎（胃炎与作息无关）
      const illnesses = (sickFromDebt && state.health >= 50)
        ? ['感冒', '发烧', '头痛']
        : ['感冒', '发烧', '胃炎', '头痛'];
      const type = illnesses[Math.floor(Math.random() * illnesses.length)];
      state.illness.type = type;
      state.illness.severity = Math.min(80, 20 + Math.random() * 40);
      state.illness.startTime = nowTs;
      state.illness.duration = 0;
      state.illness.recoveryRate = 1.0;
    }
  }

  // 疾病恢复
  if (state.illness.type) {
    state.illness.duration += hours;
    let recoveryRate = 0.5 * (1 + state.health / 100) * state.sleepQuality * profile.recoverySpeed;
    if (isSleeping) recoveryRate *= 2;
    state.illness.severity -= recoveryRate * hours * 0.5;
    if (state.illness.severity <= 0) {
      state.illness.type = null;
      state.illness.severity = 0;
      state.illness.duration = 0;
    }
  }

  if (state.injury.type) {
    state.injury.duration += hours;
    const resistanceScale = 0.5 + (profile.injuryResistance ?? 0.5);
    let recoveryRate = 0.3 * (1 + state.health / 100) * state.sleepQuality
      * profile.recoverySpeed
      * resistanceScale;
    if (isSleeping) recoveryRate *= 1.5;
    state.injury.severity -= recoveryRate * hours * 0.3;
    if (state.injury.severity <= 0) {
      state.injury.type = null;
      state.injury.severity = 0;
      state.injury.duration = 0;
      state.injury.location = '';
      state.injury.narrative = '';
      state.injury.expectedDurationHours = 0;
    }
  }

  // ============================================================
  // 失眠状态
  // ============================================================
  if (!isSleeping && state.sleepiness > 80 && state.energy > 20) {
    if (!state.specialStates.includes('失眠')) state.specialStates.push('失眠');
  } else {
    state.specialStates = state.specialStates.filter(s => s !== '失眠');
  }

  // 意识状态
  if (state.sleepStatus === '深睡') {
    state.consciousness = '昏厥';
  } else if (state.sleepStatus === '浅睡') {
    state.consciousness = '迷糊';
  } else if (state.energy < 20 && state.sleepiness > 60) {
    state.consciousness = '恍惚';
  } else {
    state.consciousness = '清醒';
  }

  // ============================================================
  // 睡眠债结算（审计 P3-6）：本步睡了就按睡眠质量还债，醒着就继续欠
  // ============================================================
  const isNapping = isSleeping && state.napStartTime > 0;
  applySleepDebt(state, profile, hours, isSleeping ? (isNapping ? 'nap' : 'sleep') : 'awake');
  if (isSleeping) {
    // 入睡后上一场梦失效，等下次醒来再生成
    state.dreamContent = '';
  }

  return wokeUpNaturally;
}

// ============================================================
// 时间驱动更新（核心：参数化 + 昼夜节律 + 特殊类型 + 午休 + 分段推进）
// ============================================================
export async function updateBodyByTime(character, hours) {
  if (!character || !character.bodyState) return;
  if (!isBodyStateEngineEnabled()) return;

  const totalHours = Number(hours);
  if (!Number.isFinite(totalHours) || totalHours <= 0) return;

  const state = character.bodyState;

  // ★ 读取个性化 profile
  const profile = getBodyProfile(character);

  // ============================================================
  // ★ 特殊类型：完全锁定状态
  // ============================================================
  if (isImmortalLike(profile)) {
    state.energy = Math.max(state.energy, 90);
    state.sleepiness = 0;
    state.sleepDebtHours = 0;
    state.health = Math.max(state.health, 95);
    state.consciousness = '清醒';
    state.sleepStatus = '清醒';
    state.specialStates = state.specialStates.filter(s => s !== '失眠' && s !== '萎靡');
    state.illness = { type: null, severity: 0, startTime: 0, duration: 0, recoveryRate: 1.0 };
    state.injury = {
      type: null, severity: 0, startTime: 0, duration: 0,
      recoveryRate: 1.0, location: '', narrative: '', expectedDurationHours: 0,
    };
    state.napStartTime = 0;
    state.lastUpdate = getGameTime();
    await updateCharacter(character.id, { bodyState: state }, { skipReload: true });
    globalEventBus.emit('body:updated', { characterId: character.id, state, timestamp: Date.now() });
    return;
  }

  // ============================================================
  // ★ 分段推进（审计 S-2）
  // ============================================================
  // 起点取「本角色上次结算时刻」，但不早于本次跨度的起点，避免时间倒流或
  // 与 emotionState 共用 lastUpdate 时把身体多推进一段。
  const endTs = getGameTime();
  const spanStart = endTs - totalHours * 3600000;
  const startTs = Math.min(endTs, Math.max(Number(state.lastUpdate) || 0, spanStart));

  const stepCount = Math.min(BODY_MAX_STEPS, Math.max(1, Math.ceil(totalHours / BODY_STEP_HOURS)));
  const stepHours = totalHours / stepCount;

  let wokeUpNaturally = false;
  for (let i = 0; i < stepCount; i++) {
    const at = new Date(startTs + stepHours * (i + 1) * 3600000);
    if (simulateBodyStep(character, profile, stepHours, at, stepCount === 1)) {
      wokeUpNaturally = true;
    }
  }

  state.lastUpdate = endTs;
  await updateCharacter(character.id, { bodyState: state }, { skipReload: true });

  globalEventBus.emit('body:updated', {
    characterId: character.id,
    state: state,
    timestamp: Date.now(),
  });

  if (wokeUpNaturally) maybeGenerateDream(character);
}

// ---------- 刷新身体状态 ----------
export async function refreshBodyState(character) {
  if (!character) return;
  if (!isBodyStateEngineEnabled()) return;

  const now = getGameTime();
  const lastUpdate = character.bodyState?.lastUpdate || now;
  const hours = (now - lastUpdate) / (1000 * 60 * 60);
  if (hours > 0.1) {
    await updateBodyByTime(character, hours);
  }
}

// ============================================================
// 唤醒逻辑
// ============================================================
export function getWakeChance(character, callCount = 1) {
  const state = character.bodyState;
  const personality = character.personalityParameters || {};
  const neuroticism = (personality.neuroticism || 50) / 100;
  const extraversion = (personality.extraversion || 50) / 100;
  const agreeableness = (personality.agreeableness || 50) / 100;

  const profile = getBodyProfile(character);

  if (isImmortalLike(profile) || profile.special === 'artificial') {
    return 1.0;
  }

  let base = 0.3;
  if (state.sleepStatus === '浅睡') base *= 1.8;
  else if (state.sleepStatus === '深睡') base *= 0.4;
  // 审计 P3-9：原「磨到醒」——反复叫从 0.3 爬到 0.7，深睡也几乎会被磨醒。
  // 改为深睡下 callCount 加成减半，让「深睡难醒」更名副其实，浅睡仍可快速唤醒。
  const callCountBonus = Math.min(callCount, 5) * 0.08;
  base += (state.sleepStatus === '深睡' ? callCountBonus * 0.5 : callCountBonus);
  base *= (1 + extraversion * 0.15);
  base *= (1 - neuroticism * 0.1);
  base *= (1 + agreeableness * 0.1);
  base *= (0.5 + profile.wakeEase);
  return Math.min(1, Math.max(0, base));
}

export async function tryWakeUp(character, callCount = 1) {
  if (!character.bodyState) return { success: false, message: '无身体状态' };
  if (!isBodyStateEngineEnabled()) {
    return { success: true, message: '已经清醒' };
  }

  const state = character.bodyState;
  if (state.sleepStatus === '清醒' || state.sleepStatus === '困倦') {
    return { success: true, message: '已经清醒' };
  }

  const chance = getWakeChance(character, callCount);
  if (Math.random() < chance) {
    state.sleepStatus = '浅睡';
    state.consciousness = '迷糊';
    state.lastWakeTime = getGameTime();
    state.sleepQuality *= 0.7;
    // ★ 若正处于午休，用户主动唤醒视作打断午休
    if (state.napStartTime > 0) {
      state.napStartTime = 0;
    }
    await updateCharacter(character.id, { bodyState: state }, { skipReload: true });
    globalEventBus.emit('body:wakeup', {
      characterId: character.id,
      state: state,
      timestamp: Date.now(),
    });
    // 被叫醒时同样可能有梦（开关关闭时不触发）
    maybeGenerateDream(character);
    return { success: true, message: '你唤醒了角色，她睡眼惺忪地看着你', newState: '迷糊' };
  } else {
    return { success: false, message: '角色仍在沉睡，没有回应你的呼唤', refusal: true };
  }
}

// ============================================================
// 事件驱动更新
// ============================================================
export async function handleBodyEvent(character, eventType, intensity = 0.5) {
  if (!character || !character.bodyState) return;
  if (!isBodyStateEngineEnabled()) return;

  const state = character.bodyState;
  const profile = getBodyProfile(character);

  if (isImmortalLike(profile)) {
    if (eventType === 'intimate') {
      state.energy = Math.min(100, state.energy + 5 * intensity);
    }
    state.lastUpdate = getGameTime();
    await updateCharacter(character.id, { bodyState: state }, { skipReload: true });
    return;
  }

  switch (eventType) {
    case 'praise':
      state.energy += 5 * intensity;
      state.health += 2 * intensity;
      state.specialStates = state.specialStates.filter(s => s !== '萎靡');
      break;
    case 'criticism':
      state.energy -= 10 * intensity / Math.max(0.5, profile.constitution * 1.5);
      if (Math.random() < 0.3 * intensity * (2 - profile.constitution)) {
        if (!state.specialStates.includes('萎靡')) state.specialStates.push('萎靡');
      }
      break;
    case 'care':
      state.health += 10 * intensity * profile.recoverySpeed;
      if (state.illness.type) {
        state.illness.severity -= 10 * intensity * profile.recoverySpeed;
        if (state.illness.severity < 0) state.illness.severity = 0;
      }
      break;
    case 'funny':
      state.energy += 3 * intensity;
      break;
    case 'intimate':
      state.energy += 8 * intensity;
      if (state.energy > 70 && !state.specialStates.includes('亢奋')) {
        state.specialStates.push('亢奋');
      }
      break;
    case 'neglect':
      state.health -= 5 * intensity / Math.max(0.5, profile.constitution * 1.5);
      break;
    default:
      break;
  }

  // 事件驱动路径统一 clamp 到 0–100，避免与时间驱动路径不一致导致漂出（审计 P2-12）
  state.energy = Math.max(0, Math.min(100, state.energy));
  state.health = Math.max(0, Math.min(100, state.health));

  state.lastUpdate = getGameTime();
  await updateCharacter(character.id, { bodyState: state }, { skipReload: true });
}

// ---------- 性别回复池 ----------
const SLEEP_REFUSAL_MESSAGES = {
  male: {
    deep: [
      '呼……呼……（他睡得正沉，完全没听到你的话）',
      '（他沉浸在睡梦中，对你的呼唤毫无反应）',
      '他翻了个身，含糊地嘟囔了一句梦话，又继续睡了。'
    ],
    light: [
      '唔……别吵……让我再睡会儿……（他含糊地说着，把被子裹得更紧了）',
      '（他似乎听到了声音，但只是皱了皱眉，没有睁眼）',
      '他哼了一声，翻了翻身，又沉沉睡去。'
    ]
  },
  female: {
    deep: [
      '呼……呼……（她睡得正香，完全没有听到你的话）',
      '（她沉浸在香甜的梦境中，对你的呼唤毫无反应）',
      '她翻了个身，嘴里嘟囔了一句模糊的梦话，又沉沉睡去。'
    ],
    light: [
      '唔……别吵……让我再睡会儿……（她含糊地说着，又埋进枕头里）',
      '（她似乎听到了你的声音，但只是皱了皱眉，没有醒来的意思）',
      '她轻轻哼了一声，却依然紧闭双眼，呼吸平稳。'
    ]
  },
  non_binary: {
    deep: [
      '呼……呼……（他们睡得正沉，完全没有回应）',
      '（他们沉浸在睡梦中，对你的呼唤毫无反应）',
      '他们翻了个身，含糊地嘟囔了一声，又继续睡去。'
    ],
    light: [
      '唔……别吵……让我再睡会儿……（他们含糊地说着，把被子拉过头顶）',
      '（似乎听到了声音，但只是皱了皱眉，没有醒来）',
      '他们轻轻哼了一声，又陷入沉睡。'
    ]
  },
  unknown: {
    deep: [
      '呼……呼……（睡得正香，完全没有听到你的话）',
      '（沉浸在香甜的梦境中，对你的呼唤毫无反应）',
      '翻了个身，嘴里嘟囔了一句模糊的梦话，又沉沉睡去。'
    ],
    light: [
      '唔……别吵……让我再睡会儿……（含糊地说着，又缩进被子里）',
      '（似乎听到了你的声音，但只是皱了皱眉，没有醒来的意思）',
      '轻轻哼了一声，却依然紧闭双眼，呼吸平稳。'
    ]
  }
};

const WAKING_REPLIES = {
  male: [
    '嗯…？什么事…我还没睡醒……（声音含糊低沉）',
    '……现在几点了？我怎么在这里……（揉着眼睛，一脸茫然）',
    '你叫我…？我刚才梦见…诶？算了……（皱着眉，努力清醒）',
    '……好困…你说什么…（打了个哈欠，眼神还没聚焦）',
    '我刚才睡得好好的……被你吵醒了……（带着点起床气，语气闷闷的）'
  ],
  female: [
    '嗯…？什么事…我还没睡醒……（声音含糊不清）',
    '……现在几点？我怎么在这里……（揉着眼睛，眼神涣散）',
    '你叫我…？我刚刚梦见…诶？什么来着…（一脸茫然）',
    '……好困…你说什么…（打了个哈欠，努力睁开眼）',
    '我刚才睡得好香……被你叫醒了……（带着一丝抱怨，但语气软软的）'
  ],
  non_binary: [
    '嗯…？什么事…我还没醒透……（声音含糊）',
    '……现在几点了？我这是在……（揉了揉眼睛，有些恍惚）',
    '你叫我…？我梦见…啊，忘了……（一脸迷茫）',
    '……好困…你说什么…（打了个哈欠，眼睛半睁）',
    '刚才睡得正舒服……被你叫醒了……（有些无奈，但没有生气）'
  ],
  unknown: [
    '嗯…？什么事…我还没睡醒……（声音含糊）',
    '……现在几点？我怎么在这里……（揉着眼睛）',
    '你叫我…？我刚刚梦见…什么来着……（一脸茫然）',
    '……好困…你说什么…（打了个哈欠）',
    '我刚才睡得好香……被你叫醒了……（语气略带迷糊）'
  ]
};

export function getSleepRefusalMessage(character) {
  if (!isBodyStateEngineEnabled()) return '';

  const state = character.bodyState;
  const genderKey = normalizeGenderKey(character.gender);
  const pool = SLEEP_REFUSAL_MESSAGES[genderKey] || SLEEP_REFUSAL_MESSAGES.unknown;
  const messages = (state.sleepStatus === '深睡') ? pool.deep : pool.light;
  return messages[Math.floor(Math.random() * messages.length)];
}

export function getWakingReply(character) {
  const genderKey = normalizeGenderKey(character.gender);
  const pool = WAKING_REPLIES[genderKey] || WAKING_REPLIES.unknown;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------- 身体状态描述 ----------
export function getBodyDescription(character) {
  if (!character || !character.bodyState) return '身体状态未知';
  const state = character.bodyState;
  const profile = getBodyProfile(character);
  const parts = [];
  parts.push(`精力:${Math.round(state.energy)}`);
  parts.push(`睡意:${Math.round(state.sleepiness)}`);
  parts.push(`健康:${Math.round(state.health)}`);
  // 审计 P3-6：睡眠债与当日睡眠时长此前从不展示，是「写了从不读」的死字段
  const debtHours = Number.isFinite(state.sleepDebtHours) ? state.sleepDebtHours : 0;
  if (debtHours >= 0.5) parts.push(`睡眠债:${debtHours.toFixed(1)}h`);
  const sleptHours = Number.isFinite(state.totalSleepHours) ? state.totalSleepHours : 0;
  if (sleptHours > 0) parts.push(`今日已睡:${sleptHours.toFixed(1)}h`);
  if (state.sleepStatus !== '清醒') parts.push(`睡眠状态:${state.sleepStatus}`);
  if (state.consciousness !== '清醒') parts.push(`意识:${state.consciousness}`);
  if (state.specialStates.length) parts.push(`特殊状态:${state.specialStates.join(',')}`);
  if (state.illness.type) parts.push(`生病:${state.illness.type}(${Math.round(state.illness.severity)})`);
  if (state.injury.type) {
    const injuryDesc = state.injury.narrative || state.injury.type;
    parts.push(`受伤:${injuryDesc}(${Math.round(state.injury.severity)})`);
  }
  if (state.napStartTime > 0) parts.push('午休中');
  // 审计 P3-6：lastNapDate 写了从不读，现用于「今日已午休」展示
  else if (state.lastNapDate && state.lastNapDate === getDateKey(getGameDate())) parts.push('今日已午休');
  if (profile.special) {
    const specialLabel = profile.special;
    parts.push(`类型:${specialLabel}`);
  }
  return parts.join('，');
}

// ============================================================
// 提示词构建
// ============================================================
export function buildBodyPrompt(character) {
  if (!character || !character.bodyState) return '';
  if (!isBodyStateEngineEnabled()) return '';

  const state = character.bodyState;
  const profile = getBodyProfile(character);
  const desc = getBodyDescription(character);
  let prompt = `【身体状态】${desc}`;

  // ============================================================
  // 睡眠 / 意识 / 困倦 —— 互斥的主状态段
  // ============================================================
  const isSleeping = state.sleepStatus === '深睡' || state.sleepStatus === '浅睡';
  const isNapping = isSleeping && state.napStartTime > 0;
  const sleepiness = typeof state.sleepiness === 'number' ? state.sleepiness : 0;
  const energy = typeof state.energy === 'number' ? state.energy : 0;

  if (isNapping) {
    // ---------- 午休 ----------
    prompt += `\n\n【当前状态：午休小睡中被唤醒】
你的午休小睡被打断了。白天的小憩比夜间睡眠更容易唤醒，意识正在快速回升。

【身体感受】
· 能睁开眼，但眼神还有几分迷离，视线需要一会儿才能聚焦
· 有"我才刚睡着就被吵醒"的微妙感觉
· 身体有些发软，四肢还没完全醒过来

【行为倾向】
· 回复适中（10-30 字），比夜间被叫醒清醒得多
· 可能抱怨一句"刚睡着就被叫醒了"，但不会真的不耐烦
· 可能伴随揉眼睛、伸懒腰等恢复动作
· 很快能接住正常对话

【语气】
略带迷糊，但恢复很快。

【避免】
不要表现得完全清醒或精神饱满；不要用夜间深睡那种断断续续的表达。`;

  } else if (state.sleepStatus === '深睡') {
    // ---------- 夜间深睡 ----------
    // 审计 P3-7 说明：此分支在「单聊」路径不可达（单聊发消息前会 tryWakeUp，
    // 成功→变浅睡，失败→直接 return 拒绝），但在群聊 / 通话 / 自主对话 / 首消息
    // 等「不经过 tryWakeUp」的路径中可达。保留此分支，勿当作死代码删除。
    let depthHint;
    if (sleepiness > 90 && energy < 20) {
      depthHint = '你睡得很沉，几乎要再次滑入梦境。';
    } else if (sleepiness > 80) {
      depthHint = '你的意识仍在梦境边缘徘徊。';
    } else {
      depthHint = '你的意识勉强抓住了一点清醒，但随时会再次沉下去。';
    }

    prompt += `\n\n【当前状态：深睡中被强行叫醒】
⚠️ 你现在处于【深睡】状态，睡眠被强行中断。${depthHint}

【身体感受】
· 意识仍沉浸在梦境边缘，可能分不清现实与梦的边界
· 身体沉重，四肢几乎抬不起来
· 眼皮像被粘住，眼睛无法完全睁开
· 喉咙发干，声音沙哑低沉

【行为倾向】
· 回复极短（1-8 个字），可能只有"嗯……""让我再睡会儿……"这样含混的音节
· 说话断断续续，字与字之间有明显停顿，可能说到一半又没了声音
· 完全不想讨论任何事情，只想继续睡
· 你可能在中途再次睡着——如果用户继续发消息，你的回复可能完全无响应或只有极短的反应

【语气】
含糊不清、迟缓、可能有一丝被打扰的不悦，但意识不清所以不会真的生气。

【避免】
不要说得清楚完整、不要使用完整句子、不要表达复杂的想法、不要主动提问。`;

  } else if (state.sleepStatus === '浅睡') {
    // ---------- 夜间浅睡 ----------
    let depthHint;
    if (sleepiness > 75) {
      depthHint = '你仍在半梦半醒之间，随时可能再次沉入睡眠。';
    } else if (sleepiness > 60) {
      depthHint = '你的意识正在努力从睡眠中浮起。';
    } else {
      depthHint = '你已经能感受到周围的动静，但反应仍然很慢。';
    }

    prompt += `\n\n【当前状态：浅睡中被唤醒】
⚠️ 你现在处于【浅睡】状态，睡眠刚被打断。${depthHint}

【身体感受】
· 能听到声音但反应迟缓，需要一两秒才能明白对方在说什么
· 眼睛勉强能睁开一条缝，视野模糊
· 身体仍然沉重，动作迟缓

【行为倾向】
· 回复简短（5-20 字），带睡醒后的迟钝感
· 说话缓慢，有停顿，可能带有打哈欠或含糊的发音
· 可能问"嗯？怎么了……"，或伴随揉眼睛、撑起身体之类的动作
· 需要一两句话才能逐渐清醒

【语气】
含糊但能听懂，迟缓，逐渐恢复。

【避免】
不要说得过于清晰或充满活力；不要主动展开新话题；不要长篇大论。`;

  } else if (state.sleepStatus === '困倦') {
    // ---------- 困倦 ----------
    const tiredHint = sleepiness > 80
      ? '你的困意已经非常强烈，几乎要撑不住了。'
      : '困意正一阵阵袭来。';

    prompt += `\n\n【当前状态：强烈困倦】
你感到很困，但仍在努力保持清醒。${tiredHint}

【身体感受】
· 眼皮沉重，每眨一次眼都想保持闭着
· 思路变慢，注意力难以集中
· 可能不自觉打哈欠

【行为倾向】
· 回复比平时简短，可能省略细节或只做简短回应
· 语气平缓、缓慢，可能带哈欠声
· 思绪偶尔飘走又拉回来
· 可能提议"去休息"或"下次再聊"

【语气】
迟缓、慵懒，有一点想睡但强撑着的感觉。

【避免】
不要表现出精神饱满或过于热情。`;

  } else if (state.consciousness === '恍惚') {
    // ---------- 恍惚 ----------
    prompt += `\n\n【当前状态：意识恍惚】
你的意识很不清醒。虽然没在睡，但思维像隔着一层水雾。

【身体感受】
· 反应迟钝，周围的声音和场景有些失真
· 注意力难以聚焦，容易走神

【行为倾向】
· 回复逻辑跳跃，可能答非所问
· 可能重复对方的话或自己刚说的话
· 思路中断后可能接不上
· 语言组织不连贯

【语气】
含糊、迟缓，有恍惚感。

【避免】
不要逻辑严谨、不要长篇大论、不要过于清醒。`;

  } else if (state.consciousness === '迷糊') {
    // ---------- 迷糊（刚醒的过渡期） ----------
    prompt += `\n\n【当前状态：刚醒的迷糊】
你刚从睡眠中醒过来，意识还没有完全恢复。

【身体感受】
· 正在从睡眠过渡到清醒，需要几秒到几十秒才能完全反应
· 眼睛睁开了，但视线还没聚焦
· 身体仍有些钝，动作不灵活

【行为倾向】
· 回复比浅睡时更清楚，但仍带睡意
· 需要确认"现在是什么情况"
· 反应略慢，话说到一半可能停顿
· 逐渐恢复清晰

【语气】
刚醒的含糊，正在恢复。

【避免】
不要立刻恢复到平常的清晰状态。`;
  }

  // ============================================================
  // 疾病 / 受伤 —— 可叠加在睡眠状态之上
  // ============================================================
  if (state.illness.type) {
    const severity = typeof state.illness.severity === 'number' ? state.illness.severity : 0;
    const severityDesc = severity > 60
      ? '病情严重，身体明显虚弱'
      : severity > 30
        ? '病情中等，感到明显不适'
        : '症状轻微，但仍有不适';
    prompt += `\n\n【疾病状态】你正在生病（${state.illness.type}，${severityDesc}），请表现出虚弱、痛苦的语气。`;
  }

  if (state.injury.type) {
    const injuryDesc = state.injury.narrative || state.injury.type;
    prompt += `\n\n【受伤状态】你受伤了（${injuryDesc}），行动不便，请表现出忍耐或痛苦的语气。`;
    const severity = typeof state.injury.severity === 'number' ? state.injury.severity : 0;
    if (severity >= 60) {
      prompt += '\n伤势较重，请表现出明显的痛苦和虚弱，动作明显受限。';
    } else if (severity >= 30) {
      prompt += '\n伤势中等，动作应有所迟缓，避免剧烈活动。';
    }
    if (state.injury.expectedDurationHours > 0) {
      const hours = state.injury.expectedDurationHours;
      const durationDesc = hours < 24
        ? `约 ${Math.round(hours)} 小时`
        : `约 ${Math.round(hours / 24)} 天`;
      prompt += `\n（预计恢复时长：${durationDesc}）`;
    }
  }

  // ============================================================
  // 特殊状态（亢奋 / 萎靡）
  // ============================================================
  if (Array.isArray(state.specialStates)) {
    if (state.specialStates.includes('亢奋')) {
      prompt += `\n\n【特殊状态：亢奋】你感到亢奋，精力充沛，语气应热情、活跃。`;
    }
    if (state.specialStates.includes('萎靡')) {
      prompt += `\n\n【特殊状态：萎靡】你感到萎靡不振，语气应低沉、消极。`;
    }
  }

  // ============================================================
  // 特殊类型附加提示
  // ============================================================
  if (profile.special === 'immortal' || profile.special === 'angel') {
    prompt += '\n\n你拥有不老不死之躯，永远不会感到疲惫、睡意或生病。';
  }
  if (profile.special === 'artificial') {
    prompt += '\n\n你是人造生命，不需要睡眠，但需注意能量消耗。';
  }
  if (profile.special === 'vampire') {
    prompt += '\n\n你是血族，昼伏夜出，白天的精力明显弱于夜晚。';
  }
  if (profile.special === 'undead' || profile.special === 'spirit') {
    prompt += '\n\n你没有活人的生理需求，但行为可能迟缓或缺乏实感。';
  }
  if (profile.special === 'plant') {
    prompt += '\n\n你依赖阳光维生，白天精力充沛，夜晚则萎靡不振。';
  }

  // ============================================================
  // 睡眠债（可叠加在主状态之上，与疾病/受伤同级）
  // ============================================================
  prompt += buildSleepDebtPrompt(state, profile);

  // ============================================================
  // 梦境（审计 P3-6：dreamContent 由死字段变为真实消费）
  // ============================================================
  if (!isSleeping && state.dreamContent) {
    prompt += `\n\n【刚做的梦】你醒来前正在做一个梦：${state.dreamContent}
梦是零散、不合逻辑的，可以把它当作醒来时残留的情绪，不必当作真实发生的事。
如果梦境让你感到不安或留恋，可以自然地带入语气中；不要大段复述梦境。`;
  }

  return prompt;
}

// ============================================================
// 睡眠债提示词
// ============================================================

/**
 * 按债务比生成「缺觉」提示段。债务轻微时不注入，避免污染正常对话。
 */
export function buildSleepDebtPrompt(state, profile) {
  if (!state || typeof state.sleepDebtHours !== 'number') return '';
  const ratio = getSleepDebtRatio(state, profile);
  if (ratio < 0.5) return '';

  const hours = state.sleepDebtHours.toFixed(1);
  if (ratio >= 2) {
    return `\n\n【睡眠不足：严重缺觉】你已经欠下约 ${hours} 小时的睡眠。
【身体感受】· 太阳穴一跳一跳地疼，眼睛干涩发烫
· 注意力难以维持，听人说话要反应好几秒才跟上
· 站着都能打盹，短时间的「断片」时有发生
【行为倾向】· 回复简短、迟钝，可能说到一半忘掉要说什么
· 容易走神，可能把话题接错
· 会下意识抗拒需要动脑的事，想找个地方躺下
【语气】疲惫、含糊、反应慢。`;
  }
  if (ratio >= 1) {
    return `\n\n【睡眠不足：明显缺觉】你欠了约 ${hours} 小时的睡眠，身体在抗议。
【身体感受】· 眼皮发沉，脑子像裹了一层棉花
· 反应比平时慢半拍，容易听漏细节
【行为倾向】· 回复偏短，偶尔打哈欠或发愣
【语气】慵懒、没什么精神。`;
  }
  return `\n\n【睡眠不足：轻度缺觉】你欠了约 ${hours} 小时的睡眠，略有疲惫但不影响正常交流。`;
}

// ============================================================
// 梦境生成（审计 P3-6：dreamContent 写了从不读 → 睡醒时真实生成并注入）
// ============================================================

/** 每日每角色最多生成一次梦境 */
const DREAM_MAX_PER_DAY = 1;

/** 无 API / 生成失败时的兜底梦境（按当前情绪取用） */
const DREAM_FALLBACKS = {
  喜悦: [
    '梦见和你在一条晒得发烫的街上走，说了很多话，醒来一句都想不起来，只剩那个笑。',
    '梦见自己轻飘飘地飞过屋顶，风很暖，落地时还在笑。',
  ],
  悲伤: [
    '梦见一直在找一扇门，推开后是很久以前的一个房间，一个人也没有。',
    '梦见雨下得很大，你在伞的那头，怎么喊都听不见。',
  ],
  愤怒: [
    '梦见和谁争执，声音越来越远，最后只剩自己喘气。',
    '梦见把什么东西摔了，碎得很慢，慢得让人烦躁。',
  ],
  恐惧: [
    '梦见身后一直有脚步声，不敢回头，醒来心跳还很快。',
    '梦见从很高的地方往下看，风声灌满耳朵。',
  ],
  惊讶: [
    '梦见天空换了好几种颜色，一件接一件意外地发生，醒来有点发懵。',
    '梦见收到了一封没有署名的信，怎么也拆不开。',
  ],
  厌恶: [
    '梦见在一间闷热的屋子里待了很久，醒来只想开窗。',
    '梦见什么东西黏在手上，怎么洗都洗不掉。',
  ],
  平静: [
    '梦见一片很安静的水，没有风，也没有人说话。',
    '梦见慢慢地走一段熟悉的楼梯，走到一半就醒了。',
  ],
  default: [
    '梦见一些零散的片段：一个背影、一段路、一句听不清的话，醒来只剩一点模糊的情绪。',
    '梦见自己在等谁，等了很久，最后却忘了在等什么。',
  ],
};

/**
 * 梦境生成开关（默认关闭）。开启后每次睡醒会消耗一次 AI 调用。
 */
export function isDreamGenerationEnabled() {
  const settings = getAppState().get('settings') || {};
  return settings.dreamGeneration?.enabled === true;
}

function pickFallbackDream(character) {
  const emotion = getEmotionLabel(character.emotionState);
  const pool = DREAM_FALLBACKS[emotion] || DREAM_FALLBACKS.default;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 调用 AI 生成一段梦境。失败时返回空串，由调用方回落模板。
 */
async function requestDreamFromAI(character) {
  try {
    // proactiveChat 依赖链较重且可能反向引用本模块，动态导入避免静态循环依赖
    const { buildPersonaSystemMessage } = await import('./proactiveChat.js');
    const emotion = getEmotionLabel(character.emotionState);
    const debt = (character.bodyState?.sleepDebtHours || 0).toFixed(1);
    const prompt = `请写一段这个角色刚做的梦，30-60 字，第一人称或第三人称均可。
要求：
- 梦境是零散、不合逻辑的，只留情绪和画面，不要写成完整故事
- 与角色当前的情绪（${emotion}）和缺觉程度（欠 ${debt} 小时睡眠）相称
- 不要出现"我做了一个梦"这类前缀，直接写梦的内容
- 不要出现解释、标题或引号`;

    const response = await sendChatRequest({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: buildPersonaSystemMessage(character),
      temperature: 0.95,
      maxTokens: 120,
      stream: false,
    });
    const text = (response?.content || '').trim();
    return text ? text.slice(0, 200) : '';
  } catch (error) {
    console.warn('[BodyState] 梦境生成失败，回落模板:', error);
    return '';
  }
}

/**
 * 生成（或复用）今日梦境并写回角色。
 * @param {Object} character
 * @param {{force?: boolean}} options force 跳过每日节流
 * @returns {Promise<string>} 梦境内容；开关关闭或不该做梦时返回空串
 */
export async function generateDream(character, options = {}) {
  if (!character || !character.bodyState) return '';
  if (!isDreamGenerationEnabled() && !options.force) return '';

  const state = character.bodyState;
  ensureSleepDebtFields(state);

  const profile = getBodyProfile(character);
  if (hasNoSleepiness(profile)) return ''; // 不睡觉的类型不做梦

  const todayKey = getDateKey(getGameDate());
  if (!options.force && state.lastDreamDate === todayKey) {
    return state.dreamContent || '';
  }
  if (DREAM_MAX_PER_DAY <= 0) return '';

  const content = (await requestDreamFromAI(character)) || pickFallbackDream(character);
  state.dreamContent = content;
  state.lastDreamDate = todayKey;
  try {
    await updateCharacter(character.id, { bodyState: state }, { skipReload: true });
  } catch (error) {
    console.warn('[BodyState] 梦境写回失败:', error);
  }
  return content;
}

/**
 * 睡醒后异步生成梦境。开关关闭时完全不触发（默认关闭 → 零 API 开销）。
 */
function maybeGenerateDream(character) {
  if (!isDreamGenerationEnabled()) return;
  Promise.resolve()
    .then(() => generateDream(character))
    .catch(error => console.warn('[BodyState] 梦境生成异常:', error));
}