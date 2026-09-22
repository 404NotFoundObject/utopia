// js/modules/profileDefaults.js - 身体/情感个性化参数与默认推导
//
// 职责：
//   1. 定义 bodyProfile / emotionProfile 的默认结构和 clamp 范围
//   2. 从 6 维性格参数推导合理的默认 profile
//   3. 定义特殊类型注册表（10 种：不死、天使、人造、赛博格、亡灵、
//      灵体、吸血鬼、恶魔、兽族、植物）
//   4. 提供昼夜节律乘数计算
//   5. 提供带缓存的安全读取入口 getBodyProfile / getEmotionProfile
//
// 设计原则：
//   - profile 直接挂在 character 对象上；缺失时即时推导
//   - 所有派生参数均有 clamp 范围，避免极端值导致行为异常
//   - 特殊类型通过 overrides 覆盖字段；UI 上会提示哪些字段被覆盖
//   - 不缓存推导结果（成本极低），保证用户编辑后立即生效
//
// ============================================================
// 通用工具
// ============================================================

function toFiniteNumber(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function clampNum(v, min, max, fallback) {
  const n = toFiniteNumber(v);
  if (n === null) return fallback;
  return Math.min(max, Math.max(min, n));
}

const RANGES = {
  // bodyProfile
  sleepNeedHours:        [0, 14],
  napTendency:           [0, 1],
  energyDecayFactor:     [0, 3],
  energyRecoveryFactor:  [0, 3],
  sleepinessRateFactor:  [0, 3],
  wakeEase:              [0, 1],
  constitution:          [0, 1],
  illnessResistance:     [0, 1],
  injuryResistance:      [0, 1],
  recoverySpeed:         [0, 3],
  // emotionProfile
  emotionalSensitivity:  [0, 1],
  emotionalVolatility:   [0, 1],
  emotionalDecayFactor:  [0, 3],
  attachmentSpeed:       [0, 1],
  trustRecoveryFactor:   [0, 3],
};

function clampField(v, rangeKey, fallback) {
  const [min, max] = RANGES[rangeKey] || [0, 1];
  return clampNum(v, min, max, fallback);
}

// ============================================================
// 默认值
// ============================================================

export function getDefaultBodyProfile() {
  return {
    chronotype: 'neutral',           // 'morning' | 'neutral' | 'evening' | 'none'
    circadianEnabled: true,
    sleepNeedHours: 7,
    allowNapping: false,
    napTendency: 0.3,
    energyDecayFactor: 1.0,
    energyRecoveryFactor: 1.0,
    sleepinessRateFactor: 1.0,
    wakeEase: 0.5,
    constitution: 0.5,
    illnessResistance: 0.5,
    injuryResistance: 0.5,
    recoverySpeed: 1.0,
    special: null,                    // 特殊类型 id（见 SPECIAL_TYPES）
  };
}

export function getDefaultEmotionProfile() {
  return {
    emotionalSensitivity: 0.5,
    emotionalVolatility: 0.5,
    emotionalDecayFactor: 1.0,
    attachmentSpeed: 0.5,
    trustRecoveryFactor: 1.0,
  };
}

// ============================================================
// 特殊类型注册表
// ============================================================
//
// 每个特殊类型通过 overrides 覆盖 profile 字段。
// 未被覆盖的字段保持用户在 UI 上设置的值。
//
// 语义约定：
//   - immortal / angel：精力不衰减、不生病、不受伤、无睡意
//   - artificial：无睡意但精力消耗快、易损坏
//   - undead / spirit：不疲惫但体能有限
//   - vampire / demon：夜行性、夜间加成
//   - plant：光合作用节律
// ============================================================

export const SPECIAL_TYPES = {
  immortal: {
    label: '不死之身',
    emoji: '✨',
    description: '修仙者、神灵、永生者——不受时间与病痛影响',
    overrides: {
      circadianEnabled: false,
      sleepNeedHours: 0,
      energyDecayFactor: 0,
      sleepinessRateFactor: 0,
      energyRecoveryFactor: 2.0,
      wakeEase: 1.0,
      illnessResistance: 1.0,
      injuryResistance: 1.0,
    },
  },

  angel: {
    label: '天使/神族',
    emoji: '👼',
    description: '天使、神明、圣灵——不老、精力恒定',
    overrides: {
      circadianEnabled: false,
      sleepNeedHours: 0,
      energyDecayFactor: 0.1,
      sleepinessRateFactor: 0,
      wakeEase: 1.0,
      illnessResistance: 1.0,
      injuryResistance: 0.9,
      recoverySpeed: 2.0,
    },
  },

  artificial: {
    label: '人造生命',
    emoji: '🤖',
    description: '机器人、仿生人、AI实体——不眠但需定期充能',
    overrides: {
      circadianEnabled: false,
      sleepNeedHours: 0,
      energyDecayFactor: 1.5,
      sleepinessRateFactor: 0,
      wakeEase: 1.0,
      illnessResistance: 1.0,
      injuryResistance: 0.3,
      recoverySpeed: 0.5,
    },
  },

  cyborg: {
    label: '赛博格',
    emoji: '🦾',
    description: '机械化改造者——少量睡眠、恢复极快',
    overrides: {
      sleepNeedHours: 3,
      energyRecoveryFactor: 2.0,
      wakeEase: 0.8,
      illnessResistance: 0.8,
      injuryResistance: 0.5,
      recoverySpeed: 1.5,
    },
  },

  undead: {
    label: '亡灵',
    emoji: '💀',
    description: '僵尸、骷髅、游魂——不会疲惫但动作迟缓',
    overrides: {
      circadianEnabled: false,
      sleepNeedHours: 0,
      energyDecayFactor: 0.1,
      sleepinessRateFactor: 0,
      wakeEase: 1.0,
      illnessResistance: 1.0,
      injuryResistance: 0.8,
    },
  },

  spirit: {
    label: '灵体',
    emoji: '👻',
    description: '鬼魂、幽灵、精魂——无实体，不受物理影响',
    overrides: {
      circadianEnabled: false,
      sleepNeedHours: 0,
      energyDecayFactor: 0.5,
      sleepinessRateFactor: 0,
      wakeEase: 1.0,
      illnessResistance: 1.0,
      injuryResistance: 1.0,
    },
  },

  vampire: {
    label: '吸血鬼',
    emoji: '🧛',
    description: '血族——昼伏夜出、不老、需吸血维生',
    overrides: {
      chronotype: 'evening',
      circadianEnabled: true,
      sleepNeedHours: 5,
      energyDecayFactor: 0.8,
      energyRecoveryFactor: 1.3,
      illnessResistance: 0.9,
      injuryResistance: 0.7,
    },
  },

  demon: {
    label: '恶魔/魔族',
    emoji: '😈',
    description: '恶魔、魔女、堕落者——夜行、体力超群',
    overrides: {
      chronotype: 'evening',
      circadianEnabled: true,
      constitution: 0.9,
      energyRecoveryFactor: 1.5,
      illnessResistance: 0.9,
      injuryResistance: 0.8,
    },
  },

  beast: {
    label: '兽族',
    emoji: '🐺',
    description: '兽人、狼人、兽娘——体能优异、感官敏锐',
    overrides: {
      constitution: 0.9,
      energyDecayFactor: 0.7,
      energyRecoveryFactor: 1.4,
      illnessResistance: 0.8,
      injuryResistance: 0.7,
      recoverySpeed: 1.3,
    },
  },

  plant: {
    label: '植物/树妖',
    emoji: '🌳',
    description: '树精、花妖、木灵——需光合作用、日夜节律强烈',
    overrides: {
      chronotype: 'neutral',
      circadianEnabled: true,
      sleepNeedHours: 8,
      energyDecayFactor: 0.9,
      energyRecoveryFactor: 1.2,
      illnessResistance: 0.6,
      injuryResistance: 0.4,
    },
  },
};

export function getSpecialTypeList() {
  return Object.entries(SPECIAL_TYPES).map(([id, def]) => ({
    id,
    label: def.label,
    emoji: def.emoji,
    description: def.description,
  }));
}

// ============================================================
// 从 6 维性格推导默认 profile
// ============================================================

export function deriveBodyProfileFromPersonality(personality) {
  const p = personality || {};
  const neuroticism = clampNum(p.neuroticism, 0, 100, 50) / 100;
  const extraversion = clampNum(p.extraversion, 0, 100, 50) / 100;
  const agreeableness = clampNum(p.agreeableness, 0, 100, 50) / 100;
  const conscientiousness = clampNum(p.conscientiousness, 0, 100, 50) / 100;

  const constitution = clampNum(
    0.5 + (1 - neuroticism) * 0.3 + conscientiousness * 0.2,
    0, 1, 0.5
  );
  const illnessResistance = clampNum(
    constitution * 0.7 + (1 - neuroticism) * 0.3,
    0, 1, 0.5
  );
  const injuryResistance = clampNum(
    0.4 + (1 - neuroticism) * 0.3 + extraversion * 0.2,
    0, 1, 0.5
  );
  const energyDecayFactor = clampNum(
    1.2 - extraversion * 0.3 - conscientiousness * 0.2,
    0.3, 2.0, 1.0
  );
  const energyRecoveryFactor = clampNum(
    0.8 + (1 - neuroticism) * 0.3 + conscientiousness * 0.2,
    0.3, 2.0, 1.0
  );
  const sleepinessRateFactor = clampNum(
    1.0 - extraversion * 0.2,
    0.4, 1.8, 1.0
  );
  const wakeEase = clampNum(
    0.3 + extraversion * 0.3 + (1 - neuroticism) * 0.2,
    0, 1, 0.5
  );

  return {
    chronotype: 'neutral',
    circadianEnabled: true,
    sleepNeedHours: 7,
    allowNapping: false,
    napTendency: 0.3,
    energyDecayFactor,
    energyRecoveryFactor,
    sleepinessRateFactor,
    wakeEase,
    constitution,
    illnessResistance,
    injuryResistance,
    recoverySpeed: clampNum(0.5 + constitution, 0.3, 2.0, 1.0),
    special: null,
  };
}

export function deriveEmotionProfileFromPersonality(personality) {
  const p = personality || {};
  const neuroticism = clampNum(p.neuroticism, 0, 100, 50) / 100;
  const extraversion = clampNum(p.extraversion, 0, 100, 50) / 100;
  const agreeableness = clampNum(p.agreeableness, 0, 100, 50) / 100;
  const openness = clampNum(p.openness, 0, 100, 50) / 100;
  const expressiveness = clampNum(p.expressiveness, 0, 100, 50) / 100;

  return {
    emotionalSensitivity: clampNum(
      neuroticism * 0.6 + openness * 0.4,
      0, 1, 0.5
    ),
    emotionalVolatility: clampNum(
      neuroticism * 0.7 + expressiveness * 0.3,
      0, 1, 0.5
    ),
    emotionalDecayFactor: clampNum(
      1.5 - neuroticism,
      0.3, 2.5, 1.0
    ),
    attachmentSpeed: clampNum(
      0.3 + agreeableness * 0.5 + extraversion * 0.2,
      0, 1, 0.5
    ),
    trustRecoveryFactor: clampNum(
      0.5 + agreeableness * 0.5,
      0.3, 2.0, 1.0
    ),
  };
}

// ============================================================
// 归一化（补齐缺失字段 + clamp）
// ============================================================

export function normalizeBodyProfile(raw) {
  const d = getDefaultBodyProfile();
  const r = raw || {};
  return {
    chronotype: ['morning', 'neutral', 'evening', 'none'].includes(r.chronotype)
      ? r.chronotype : d.chronotype,
    circadianEnabled: typeof r.circadianEnabled === 'boolean'
      ? r.circadianEnabled : d.circadianEnabled,
    sleepNeedHours: clampField(r.sleepNeedHours, 'sleepNeedHours', d.sleepNeedHours),
    allowNapping: typeof r.allowNapping === 'boolean' ? r.allowNapping : d.allowNapping,
    napTendency: clampField(r.napTendency, 'napTendency', d.napTendency),
    energyDecayFactor: clampField(r.energyDecayFactor, 'energyDecayFactor', d.energyDecayFactor),
    energyRecoveryFactor: clampField(r.energyRecoveryFactor, 'energyRecoveryFactor', d.energyRecoveryFactor),
    sleepinessRateFactor: clampField(r.sleepinessRateFactor, 'sleepinessRateFactor', d.sleepinessRateFactor),
    wakeEase: clampField(r.wakeEase, 'wakeEase', d.wakeEase),
    constitution: clampField(r.constitution, 'constitution', d.constitution),
    illnessResistance: clampField(r.illnessResistance, 'illnessResistance', d.illnessResistance),
    injuryResistance: clampField(r.injuryResistance, 'injuryResistance', d.injuryResistance),
    recoverySpeed: clampField(r.recoverySpeed, 'recoverySpeed', d.recoverySpeed),
    special: (r.special && SPECIAL_TYPES[r.special]) ? r.special : null,
  };
}

export function normalizeEmotionProfile(raw) {
  const d = getDefaultEmotionProfile();
  const r = raw || {};
  return {
    emotionalSensitivity: clampField(r.emotionalSensitivity, 'emotionalSensitivity', d.emotionalSensitivity),
    emotionalVolatility: clampField(r.emotionalVolatility, 'emotionalVolatility', d.emotionalVolatility),
    emotionalDecayFactor: clampField(r.emotionalDecayFactor, 'emotionalDecayFactor', d.emotionalDecayFactor),
    attachmentSpeed: clampField(r.attachmentSpeed, 'attachmentSpeed', d.attachmentSpeed),
    trustRecoveryFactor: clampField(r.trustRecoveryFactor, 'trustRecoveryFactor', d.trustRecoveryFactor),
  };
}

// ============================================================
// 安全读取入口（含特殊类型 overrides 合并）
// ============================================================

/**
 * 获取角色的有效 bodyProfile
 *
 * 步骤：
 *   1. 若 character.bodyProfile 存在 → normalize
 *   2. 否则从性格推导
 *   3. 合并 special overrides
 *
 * @param {Object} character
 * @returns {Object} 完整的 bodyProfile
 */
export function getBodyProfile(character) {
  if (!character) return getDefaultBodyProfile();

  let profile;
  if (character.bodyProfile) {
    profile = normalizeBodyProfile(character.bodyProfile);
  } else {
    profile = normalizeBodyProfile(
      deriveBodyProfileFromPersonality(character.personalityParameters)
    );
  }

  if (profile.special && SPECIAL_TYPES[profile.special]) {
    profile = { ...profile, ...SPECIAL_TYPES[profile.special].overrides };
  }

  return profile;
}

export function getEmotionProfile(character) {
  if (!character) return getDefaultEmotionProfile();

  if (character.emotionProfile) {
    return normalizeEmotionProfile(character.emotionProfile);
  }
  return normalizeEmotionProfile(
    deriveEmotionProfileFromPersonality(character.personalityParameters)
  );
}

// ============================================================
// 昼夜节律乘数
// ============================================================

/**
 * 计算某时刻的昼夜节律乘数（精力/睡意的时段修正系数）
 *
 * 返回值语义：
 *   > 1.0 → 精力旺盛、睡意积攒慢
 *   = 1.0 → 中性
 *   < 1.0 → 精力低、睡意积攒快
 *
 * @param {number} hour - 当前小时（0-23，来自游戏时间）
 * @param {Object} profile - bodyProfile
 * @returns {number} 0.1 ~ 2.0
 */
export function getCircadianMultiplier(hour, profile) {
  if (!profile || profile.circadianEnabled === false) return 1.0;

  const chronotype = profile.chronotype || 'neutral';
  const special = profile.special;

  if (chronotype === 'none') return 1.0;

  let base;
  switch (chronotype) {
    case 'morning':
      // 8:00 峰值 1.3，20:00 谷值 0.7
      base = 1.0 + 0.3 * Math.cos((hour - 8) * Math.PI / 12);
      break;
    case 'evening':
      // 22:00 峰值 1.3，10:00 谷值 0.7
      base = 1.0 + 0.3 * Math.cos((hour - 22) * Math.PI / 12);
      break;
    case 'neutral':
    default:
      // 14:00 峰值 1.2，2:00 谷值 0.8
      base = 1.0 + 0.2 * Math.cos((hour - 14) * Math.PI / 12);
      break;
  }

  // 特殊类型附加修正
  if (special === 'vampire' || special === 'demon') {
    if (hour >= 20 || hour < 5) base *= 1.3;
    else if (hour >= 8 && hour < 16) base *= 0.7;
  }

  if (special === 'plant') {
    if (hour >= 10 && hour < 16) base *= 1.4;
    else if (hour >= 20 || hour < 6) base *= 0.6;
  }

  return Math.max(0.1, Math.min(2.0, base));
}