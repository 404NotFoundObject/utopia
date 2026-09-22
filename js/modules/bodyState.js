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

// ---------- 常量（基础速率，被 profile 因子缩放） ----------
const ENERGY_DECAY_RATE = 2;
const SLEEPINESS_INCREASE_RATE = 3;
const HEALTH_DECAY_RATE = 0.5;
const RECOVERY_RATE_SLEEP = 8;
const RECOVERY_RATE_REST = 3;
const MIN_SLEEP_HOURS = 6;

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
    totalSleepHours: 0,
    sleepQuality: 1.0,
    dreamContent: '',
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
function getTimePeriod() {
  const date = getGameDate();
  const hour = date.getHours();
  if (hour >= 6 && hour < 8) return '清晨';
  if (hour >= 8 && hour < 12) return '上午';
  if (hour >= 12 && hour < 14) return '午间';
  if (hour >= 14 && hour < 18) return '下午';
  if (hour >= 18 && hour < 20) return '傍晚';
  if (hour >= 20 && hour < 23) return '夜晚';
  if (hour >= 23 || hour < 6) return '深夜';
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

/**
 * 处理午休状态转换。
 */
function processNapping(state, profile, gameDate, gameNow) {
  // ---- 兼容老角色 bodyState：懒补齐缺失字段 ----
  if (state.napStartTime === undefined) state.napStartTime = 0;
  if (state.lastNapDecideDate === undefined) state.lastNapDecideDate = null;
  if (state.lastNapDate === undefined) state.lastNapDate = null;

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
    state.totalSleepHours += napElapsedHours;
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

// ============================================================
// 时间驱动更新（核心：参数化 + 昼夜节律 + 特殊类型 + 午休）
// ============================================================
export async function updateBodyByTime(character, hours) {
  if (!character || !character.bodyState) return;
  if (!isBodyStateEngineEnabled()) return;

  const state = character.bodyState;
  const personality = character.personalityParameters || {};
  const neuroticism = (personality.neuroticism || 50) / 100;
  const extraversion = (personality.extraversion || 50) / 100;
  const agreeableness = (personality.agreeableness || 50) / 100;
  const conscientiousness = (personality.conscientiousness || 50) / 100;

  // ★ 读取个性化 profile
  const profile = getBodyProfile(character);
  const gameDate = getGameDate();
  const circadian = getCircadianMultiplier(gameDate.getHours(), profile);

  const period = getTimePeriod();

  // ============================================================
  // ★ 特殊类型：完全锁定状态
  // ============================================================
  if (isImmortalLike(profile)) {
    state.energy = Math.max(state.energy, 90);
    state.sleepiness = 0;
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
  // ★ 午休逻辑
  // ============================================================
  const gameNow = getGameTime();
  const napAction = processNapping(state, profile, gameDate, gameNow);
  if (napAction) {
    console.log(`[BodyState] ${character.name || character.id} 午休${napAction === 'nap-start' ? '开始' : '结束'}`);
  }

  const isSleeping = (state.sleepStatus === '浅睡' || state.sleepStatus === '深睡');

  // ============================================================
  // 精力
  // ============================================================
  let energyChange = 0;
  if (isSleeping) {
    const quality = state.sleepQuality;
    energyChange = RECOVERY_RATE_SLEEP * quality * hours
      * profile.energyRecoveryFactor
      * (1 + state.health / 200);
  } else {
    let baseConsume = ENERGY_DECAY_RATE * hours
      * profile.energyDecayFactor
      * circadian
      * (1 - conscientiousness * 0.1);
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
      let baseIncrease = SLEEPINESS_INCREASE_RATE * hours
        * profile.sleepinessRateFactor
        / Math.max(0.5, circadian)
        * (1 - conscientiousness * 0.1);
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
      state.lastWakeTime = getGameTime();
      state.totalSleepHours += hours;
    }
  } else {
    const sleepinessThreshold = 80 - (profile.sleepNeedHours - 7) * 3;
    if (state.sleepiness > sleepinessThreshold) {
      state.sleepStatus = '困倦';
    } else if (state.sleepiness > 50 && (period === '深夜' || period === '午间')) {
      state.sleepStatus = '困倦';
    } else {
      state.sleepStatus = '清醒';
    }
    if (state.energy < 10 && state.sleepiness > 90) {
      state.sleepStatus = '深睡';
      state.consciousness = '昏厥';
      state.lastWakeTime = getGameTime();
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
    let baseHealthDecay = HEALTH_DECAY_RATE * hours * (1 + neuroticism * 0.5);
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
  if (!state.illness.type && state.health < 50) {
    const resistanceFactor = 2 - profile.illnessResistance * 2;
    const illnessChance = Math.min(1, 0.01 * hours * (1 + neuroticism) * resistanceFactor);
    if (Math.random() < illnessChance) {
      const illnesses = ['感冒', '发烧', '胃炎', '头痛'];
      const type = illnesses[Math.floor(Math.random() * illnesses.length)];
      state.illness.type = type;
      state.illness.severity = Math.min(80, 20 + Math.random() * 40);
      state.illness.startTime = getGameTime();
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

  state.lastUpdate = getGameTime();
  await updateCharacter(character.id, { bodyState: state }, { skipReload: true });

  globalEventBus.emit('body:updated', {
    characterId: character.id,
    state: state,
    timestamp: Date.now(),
  });
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
  base += Math.min(callCount, 5) * 0.08;
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
        state.specialStates.push('萎靡');
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
  if (state.sleepStatus !== '清醒') parts.push(`睡眠状态:${state.sleepStatus}`);
  if (state.consciousness !== '清醒') parts.push(`意识:${state.consciousness}`);
  if (state.specialStates.length) parts.push(`特殊状态:${state.specialStates.join(',')}`);
  if (state.illness.type) parts.push(`生病:${state.illness.type}(${Math.round(state.illness.severity)})`);
  if (state.injury.type) {
    const injuryDesc = state.injury.narrative || state.injury.type;
    parts.push(`受伤:${injuryDesc}(${Math.round(state.injury.severity)})`);
  }
  if (state.napStartTime > 0) parts.push('午休中');
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

  return prompt;
}