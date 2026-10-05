/**
 * js/modules/bodyState 单元测试：睡眠债建模与梦境生成（审计 P3-6 / P3-8）。
 *
 * 背景：
 * - P3-6：totalSleepHours / dreamContent / lastNapDate 三个字段「写了从不读」。
 *   totalSleepHours 改为「当日已睡」并被债务结算与身体描述消费；
 *   dreamContent 由睡醒时的梦境生成写入；lastNapDate 用于「今日已午休」展示。
 * - P3-8：FAQ 承诺「长期不睡会生病」，但代码里生病只看 health < 50，
 *   熬几个通宵也毫无影响。现在睡眠债过重会独立触发生病判定。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  now: new Date('2026-10-02T08:00:00').getTime(),
  settings: {
    engineFlags: { bodyState: true },
    dreamGeneration: { enabled: false, maxPerDay: 1 },
  },
  profile: {
    special: null,
    sleepNeedHours: 8,
    constitution: 0.5,
    illnessResistance: 0.5,
    injuryResistance: 0.5,
    recoverySpeed: 1,
    energyDecayFactor: 1,
    energyRecoveryFactor: 1,
    sleepinessRateFactor: 1,
    allowNapping: false,
    napTendency: 0.3,
    wakeEase: 0.5,
  },
}));

vi.mock('../../../js/core/db.js', () => ({ getStores: vi.fn() }));
vi.mock('../../../js/core/state.js', () => ({
  getAppState: () => ({ get: key => (key === 'settings' ? mocks.settings : null) }),
}));
vi.mock('../../../js/modules/time.js', () => ({
  getGameTime: () => mocks.now,
  getGameDate: () => new Date(mocks.now),
}));
vi.mock('../../../js/modules/character.js', () => ({ updateCharacter: vi.fn(async () => {}) }));
vi.mock('../../../js/modules/emotionEngine.js', () => ({ getEmotionLabel: () => '平静' }));
vi.mock('../../../js/modules/profileDefaults.js', () => ({
  getBodyProfile: () => mocks.profile,
  getCircadianMultiplier: () => 1,
}));
vi.mock('../../../js/core/eventBus.js', () => ({ default: { emit: vi.fn() } }));
vi.mock('../../../js/core/api.js', () => ({ sendChatRequest: vi.fn() }));
// generateDream 内部动态导入 proactiveChat（避免静态循环依赖），需同样打桩
vi.mock('../../../js/modules/proactiveChat.js', () => ({
  buildPersonaSystemMessage: () => '角色人设',
}));

import {
  updateBodyByTime,
  generateDream,
  buildSleepDebtPrompt,
  buildBodyPrompt,
  getBodyDescription,
  getDefaultBodyState,
} from '../../../js/modules/bodyState.js';
import { sendChatRequest } from '../../../js/core/api.js';

const PERSONALITY = {
  neuroticism: 50,
  extraversion: 50,
  agreeableness: 50,
  conscientiousness: 50,
};

function makeCharacter(bodyOverrides = {}, overrides = {}) {
  return {
    id: 'char-1',
    name: '测试角色',
    gender: 'female',
    personalityParameters: { ...PERSONALITY },
    emotionState: {},
    bodyState: {
      ...getDefaultBodyState(),
      energy: 80,
      sleepiness: 30,
      health: 80,
      ...bodyOverrides,
    },
    ...overrides,
  };
}

describe('modules/bodyState · 睡眠债（审计 P3-6 / P3-8）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.now = new Date('2026-10-02T08:00:00').getTime();
    mocks.settings = { engineFlags: { bodyState: true }, dreamGeneration: { enabled: false } };
    mocks.profile = {
      special: null,
      sleepNeedHours: 8,
      constitution: 0.5,
      illnessResistance: 0.5,
      injuryResistance: 0.5,
      recoverySpeed: 1,
      energyDecayFactor: 1,
      energyRecoveryFactor: 1,
      sleepinessRateFactor: 1,
      allowNapping: false,
      napTendency: 0.3,
      wakeEase: 0.5,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('清醒时按「每日需求摊到 24 小时」的速率累积债务', async () => {
    // 只推进 6 小时：睡意还够不到就寝阈值，角色全程清醒，可纯粹检验累积速率。
    const char = makeCharacter({ sleepStatus: '清醒' });
    await updateBodyByTime(char, 6);
    // need=8 → 清醒 6h 欠 8 × 6/24 = 2h
    expect(char.bodyState.sleepDebtHours).toBeCloseTo(2, 5);
    expect(char.bodyState.sleepStatus).not.toBe('浅睡');
    expect(char.bodyState.sleepStatus).not.toBe('深睡');
  });

  it('睡满需求时长可把债务还清，且不会变成负数', async () => {
    const char = makeCharacter({
      sleepStatus: '深睡',
      sleepiness: 90,
      sleepDebtHours: 8,
      sleepQuality: 1,
    });
    await updateBodyByTime(char, 8);
    expect(char.bodyState.sleepDebtHours).toBeCloseTo(0, 5);
    expect(char.bodyState.totalSleepHours).toBeCloseTo(8, 5);
  });

  it('债务有上限，长期不睡也不会无限累积', async () => {
    // sleepinessRateFactor = 0 → 睡意永不上升，角色无法自然入睡，
    // 以此构造「持续清醒」的极端场景来检验上限。
    mocks.profile.sleepinessRateFactor = 0;
    const char = makeCharacter({ sleepStatus: '清醒' });
    await updateBodyByTime(char, 24 * 30);
    // 上限 = 每日需求 × 3 = 24h
    expect(char.bodyState.sleepDebtHours).toBeCloseTo(24, 5);
  });

  it('无睡意类型（人造生命/不死之身）不产生睡眠债', async () => {
    mocks.profile.special = 'artificial';
    const char = makeCharacter({ sleepStatus: '清醒' });
    await updateBodyByTime(char, 48);
    expect(char.bodyState.sleepDebtHours).toBe(0);
  });

  it('老角色缺少睡眠债字段时懒补齐，不会写出 NaN', async () => {
    const char = makeCharacter({ sleepStatus: '清醒' });
    delete char.bodyState.sleepDebtHours;
    delete char.bodyState.totalSleepHours;
    await updateBodyByTime(char, 12);
    expect(Number.isFinite(char.bodyState.sleepDebtHours)).toBe(true);
    expect(Number.isFinite(char.bodyState.totalSleepHours)).toBe(true);
  });

  it('totalSleepHours 是「当日已睡」，跨游戏日后归零', async () => {
    const char = makeCharacter({
      sleepStatus: '清醒',
      totalSleepHours: 7,
      sleepLedgerDate: '2026-9-1', // 昨日（getDateKey 用 getMonth()，0 基）
    });
    await updateBodyByTime(char, 1);
    expect(char.bodyState.totalSleepHours).toBe(0);
    expect(char.bodyState.sleepLedgerDate).toBe('2026-9-2');
  });

  it('睡眠债会放大健康衰减', async () => {
    const fresh = makeCharacter({ sleepStatus: '清醒', health: 80, sleepDebtHours: 0 });
    const tired = makeCharacter({ sleepStatus: '清醒', health: 80, sleepDebtHours: 8 });
    await updateBodyByTime(fresh, 10);
    await updateBodyByTime(tired, 10);
    // 债务比 1.0 → 健康衰减 ×(1 + 1×0.5)
    expect(80 - tired.bodyState.health).toBeGreaterThan(80 - fresh.bodyState.health);
  });

  it('睡眠债会放大睡意增速', async () => {
    const fresh = makeCharacter({ sleepStatus: '清醒', sleepiness: 10, sleepDebtHours: 0 });
    const tired = makeCharacter({ sleepStatus: '清醒', sleepiness: 10, sleepDebtHours: 16 });
    await updateBodyByTime(fresh, 2);
    await updateBodyByTime(tired, 2);
    expect(tired.bodyState.sleepiness).toBeGreaterThan(fresh.bodyState.sleepiness);
  });
});

describe('modules/bodyState · 睡眠债致生病（审计 P3-8）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings = { engineFlags: { bodyState: true } };
    mocks.profile = { special: null, sleepNeedHours: 8, constitution: 0.5, illnessResistance: 0.5, injuryResistance: 0.5, recoverySpeed: 1, energyDecayFactor: 1, energyRecoveryFactor: 1, sleepinessRateFactor: 1, allowNapping: false, napTendency: 0.3, wakeEase: 0.5 };
    // 让概率判定必然命中
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('健康值很高但欠觉严重时也会生病（此前只看 health<50）', async () => {
    const char = makeCharacter({ sleepStatus: '清醒', health: 90, sleepDebtHours: 12 });
    await updateBodyByTime(char, 1);
    expect(char.bodyState.illness.type).toBeTruthy();
    // 缺觉致病的病因池不含胃炎
    expect(['感冒', '发烧', '头痛']).toContain(char.bodyState.illness.type);
  });

  it('不欠觉且健康值正常时不会生病', async () => {
    const char = makeCharacter({ sleepStatus: '清醒', health: 90, sleepDebtHours: 0 });
    await updateBodyByTime(char, 1);
    expect(char.bodyState.illness.type).toBeFalsy();
  });

  it('债务未达阈值（比值 < 1.5）时不触发缺觉致病', async () => {
    const char = makeCharacter({ sleepStatus: '清醒', health: 90, sleepDebtHours: 8 });
    await updateBodyByTime(char, 1);
    expect(char.bodyState.illness.type).toBeFalsy();
  });
});

describe('modules/bodyState · 长离线分段推进（审计 S-1 / S-2）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.now = new Date('2026-10-02T08:00:00').getTime();
    mocks.settings = { engineFlags: { bodyState: true }, dreamGeneration: { enabled: false } };
    mocks.profile = {
      special: null,
      sleepNeedHours: 8,
      constitution: 0.5,
      illnessResistance: 0.5,
      injuryResistance: 0.5,
      recoverySpeed: 1,
      energyDecayFactor: 1,
      energyRecoveryFactor: 1,
      sleepinessRateFactor: 1,
      allowNapping: false,
      napTendency: 0.3,
      wakeEase: 0.5,
    };
    // random() = 1 → 不触发失眠、不触发随机致病，只观察睡/醒与债务演化
    vi.spyOn(Math, 'random').mockReturnValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('睡意到位就自然入睡，「困倦」不再是死胡同', async () => {
    const char = makeCharacter({ sleepStatus: '清醒', sleepiness: 100, energy: 80 });
    await updateBodyByTime(char, 1);
    // 白天的就寝阈值 = 80 - (8-7)*3 = 77，睡意 100 已经越过
    expect(char.bodyState.sleepStatus).toBe('浅睡');
  });

  it('夜间到点就寝：睡意阈值比白天低', async () => {
    mocks.now = new Date('2026-10-02T21:00:00').getTime();
    const char = makeCharacter({ sleepStatus: '清醒', sleepiness: 65, energy: 60 });
    await updateBodyByTime(char, 1);
    // 21:00 属「夜晚」，阈值降到 60；白天 65 还够不到 77
    expect(char.bodyState.sleepStatus).toBe('浅睡');
  });

  it('离线 3 天：期间真的入睡又醒来，而不是整段算作清醒', async () => {
    const char = makeCharacter({ sleepStatus: '清醒' });
    const startTs = char.bodyState.lastWakeTime;

    await updateBodyByTime(char, 72);

    // lastWakeTime 只在「浅睡 → 清醒」时被改写：它前进了就证明中途睡过并醒来
    expect(char.bodyState.lastWakeTime).toBeGreaterThan(startTs);
    // 夜间会自然入睡还债，债务不该顶到缺觉致病线（need=8 → 阈值 12h）
    expect(char.bodyState.sleepDebtHours).toBeLessThan(12);
    // 也没被拖到力竭昏厥
    expect(char.bodyState.energy).toBeGreaterThan(10);
  });

  it('离线 3 天：从睡眠态进入也不会整段算作睡觉', async () => {
    const char = makeCharacter({
      sleepStatus: '深睡',
      sleepiness: 90,
      sleepDebtHours: 8,
      sleepQuality: 1,
    });
    const startTs = char.bodyState.lastWakeTime;

    await updateBodyByTime(char, 72);

    expect(char.bodyState.lastWakeTime).toBeGreaterThan(startTs);
    // 睡够了就该起来活动，而不是锁死在深睡
    expect(char.bodyState.sleepStatus).not.toBe('深睡');
  });

  it('离线 3 天不会再凭空致病（债务根本没到阈值）', async () => {
    // random() = 0 → 只要概率 > 0 就必定命中，用来放大「凭空生病」
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // neuroticism = 0 → 关掉失眠门控，保证角色能正常入睡（否则测的是失眠不是债务）
    const char = makeCharacter(
      { sleepStatus: '清醒' },
      { personalityParameters: { ...PERSONALITY, neuroticism: 0 } },
    );

    await updateBodyByTime(char, 72);

    expect(char.bodyState.sleepDebtHours).toBeLessThan(12);
    expect(char.bodyState.illness.type).toBeFalsy();
  });
});

describe('modules/bodyState · 提示词与描述', () => {
  beforeEach(() => {
    mocks.settings = { engineFlags: { bodyState: true } };
    mocks.profile = { special: null, sleepNeedHours: 8, constitution: 0.5, illnessResistance: 0.5, injuryResistance: 0.5, recoverySpeed: 1, energyDecayFactor: 1, energyRecoveryFactor: 1, sleepinessRateFactor: 1, allowNapping: false, napTendency: 0.3, wakeEase: 0.5 };
  });

  it('债务轻微时不注入提示，避免污染正常对话', () => {
    expect(buildSleepDebtPrompt({ sleepDebtHours: 2 }, { sleepNeedHours: 8 })).toBe('');
  });

  it('债务分级提示：明显缺觉 / 严重缺觉', () => {
    const mid = buildSleepDebtPrompt({ sleepDebtHours: 8 }, { sleepNeedHours: 8 });
    const severe = buildSleepDebtPrompt({ sleepDebtHours: 20 }, { sleepNeedHours: 8 });
    expect(mid).toContain('明显缺觉');
    expect(severe).toContain('严重缺觉');
  });

  it('buildBodyPrompt 会带上睡眠债段落', () => {
    const char = makeCharacter({ sleepStatus: '清醒', sleepDebtHours: 16 });
    const prompt = buildBodyPrompt(char);
    expect(prompt).toContain('睡眠不足');
  });

  it('身体描述展示睡眠债、当日已睡与今日已午休', () => {
    const todayKey = '2026-9-2';
    const char = makeCharacter({
      sleepDebtHours: 6.25,
      totalSleepHours: 2.5,
      lastNapDate: todayKey,
    });
    const desc = getBodyDescription(char);
    expect(desc).toContain('睡眠债:6.3h');
    expect(desc).toContain('今日已睡:2.5h');
    expect(desc).toContain('今日已午休');
  });
});

describe('modules/bodyState · 梦境生成（审计 P3-6）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.now = new Date('2026-10-02T08:00:00').getTime();
    mocks.profile = { special: null, sleepNeedHours: 8, constitution: 0.5, illnessResistance: 0.5, injuryResistance: 0.5, recoverySpeed: 1, energyDecayFactor: 1, energyRecoveryFactor: 1, sleepinessRateFactor: 1, allowNapping: false, napTendency: 0.3, wakeEase: 0.5 };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('开关关闭时不做任何 AI 调用（默认行为零开销）', async () => {
    mocks.settings = { engineFlags: { bodyState: true }, dreamGeneration: { enabled: false } };
    const char = makeCharacter();
    const dream = await generateDream(char);
    expect(dream).toBe('');
    expect(sendChatRequest).not.toHaveBeenCalled();
  });

  it('开关开启时调用 AI 并写入 dreamContent', async () => {
    mocks.settings = { engineFlags: { bodyState: true }, dreamGeneration: { enabled: true } };
    sendChatRequest.mockResolvedValue({ content: '  梦见一只猫蹲在窗台上  ' });
    const char = makeCharacter();

    const dream = await generateDream(char);
    expect(sendChatRequest).toHaveBeenCalledTimes(1);
    expect(dream).toBe('梦见一只猫蹲在窗台上');
    expect(char.bodyState.dreamContent).toBe('梦见一只猫蹲在窗台上');
  });

  it('AI 失败时回落本地模板，不把失败写成空梦', async () => {
    mocks.settings = { engineFlags: { bodyState: true }, dreamGeneration: { enabled: true } };
    sendChatRequest.mockRejectedValue(new Error('API 不可达'));
    const char = makeCharacter();

    const dream = await generateDream(char);
    expect(dream).toBeTruthy();
    expect(char.bodyState.dreamContent).toBe(dream);
  });

  it('同一游戏日只生成一次（节流）', async () => {
    mocks.settings = { engineFlags: { bodyState: true }, dreamGeneration: { enabled: true } };
    sendChatRequest.mockResolvedValue({ content: '第一个梦' });
    const char = makeCharacter();

    await generateDream(char);
    const second = await generateDream(char);
    expect(sendChatRequest).toHaveBeenCalledTimes(1);
    expect(second).toBe('第一个梦');
  });

  it('无睡意类型不做梦', async () => {
    mocks.settings = { engineFlags: { bodyState: true }, dreamGeneration: { enabled: true } };
    mocks.profile.special = 'artificial';
    const char = makeCharacter();
    const dream = await generateDream(char);
    expect(dream).toBe('');
    expect(sendChatRequest).not.toHaveBeenCalled();
  });
});
