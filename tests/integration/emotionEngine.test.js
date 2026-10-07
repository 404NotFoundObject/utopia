/**
 * 情感引擎集成测试。
 *
 * 覆盖三类关注点：
 *   1. 纯逻辑：词库意图分类、情绪标签映射（不触碰存储）
 *   2. 引擎 × 存储：时间衰减与事件驱动更新是否真正落库
 *   3. 引擎开关：关闭后引擎应完全短路，不写库、不发事件
 *
 * 隔离策略：本文件共享一个 IndexedDB 实例（由 Vitest 的按文件隔离提供），
 * 用例之间不再删库——因为 character.js 等 6 个模块会缓存绑定到具体连接的
 * stores 对象，删库会让缓存失效并抛 InvalidStateError。
 * 用例之间改用唯一角色 ID 来保证互不干扰。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getStores } from '../../js/core/db.js';
import { getAppState } from '../../js/core/state.js';
import globalEventBus from '../../js/core/eventBus.js';
import {
  getDefaultEmotionState,
  getInitialEmotionState,
  classifyUserMessage,
  updateEmotionByTime,
  handleInteraction,
  getEmotionLabel,
  getEmotionDescription,
} from '../../js/modules/emotionEngine.js';

const NEUTRAL_PERSONALITY = {
  openness: 50,
  conscientiousness: 50,
  extraversion: 50,
  agreeableness: 50,
  neuroticism: 50,
  expressiveness: 50,
};

/** 显式给出 decayFactor=1.0，让衰减计算完全确定，避免依赖性格推导 */
const FIXED_EMOTION_PROFILE = {
  emotionalSensitivity: 0.5,
  emotionalVolatility: 0.5,
  emotionalDecayFactor: 1.0,
  attachmentSpeed: 0.5,
  trustRecoveryFactor: 1.0,
};

let _charSeq = 0;

async function seedCharacter(overrides = {}) {
  const { characters } = await getStores();
  _charSeq += 1;
  const char = {
    id: `char-emotion-${_charSeq}`,
    name: '测试角色',
    createdAt: _charSeq,
    personalityParameters: { ...NEUTRAL_PERSONALITY },
    emotionProfile: { ...FIXED_EMOTION_PROFILE },
    emotionState: getInitialEmotionState(NEUTRAL_PERSONALITY),
    ...overrides,
  };
  await characters.add(char);
  return char;
}

describe('modules/emotionEngine · 集成', () => {
  beforeEach(() => {
    getAppState().set('settings', { engineFlags: { emotion: true } });
  });

  describe('getInitialEmotionState · 由性格初始化', () => {
    it('六维情绪与三类关系全部落在合法区间', () => {
      const state = getInitialEmotionState(NEUTRAL_PERSONALITY);
      for (const dim of ['valence', 'arousal', 'dominance', 'attention', 'surprise', 'energy']) {
        expect(state[dim], dim).toBeGreaterThanOrEqual(-100);
        expect(state[dim], dim).toBeLessThanOrEqual(100);
      }
      for (const rel of ['affection', 'trust', 'intimacy']) {
        expect(state[rel], rel).toBeGreaterThanOrEqual(-100);
        expect(state[rel], rel).toBeLessThanOrEqual(100);
      }
      for (const need of ['safety', 'esteem', 'belonging', 'autonomy', 'pleasure']) {
        expect(state.needs[need], need).toBeGreaterThanOrEqual(0);
        expect(state.needs[need], need).toBeLessThanOrEqual(100);
      }
    });

    it('高神经质角色初始愉悦度更低、唤醒度更高', () => {
      const calm = getInitialEmotionState({ ...NEUTRAL_PERSONALITY, neuroticism: 10 });
      const nervous = getInitialEmotionState({ ...NEUTRAL_PERSONALITY, neuroticism: 90 });
      expect(nervous.valence).toBeLessThan(calm.valence);
      expect(nervous.arousal).toBeGreaterThan(calm.arousal);
    });

    it('高宜人性角色初始好感更高', () => {
      const cold = getInitialEmotionState({ ...NEUTRAL_PERSONALITY, agreeableness: 10 });
      const warm = getInitialEmotionState({ ...NEUTRAL_PERSONALITY, agreeableness: 90 });
      expect(warm.affection).toBeGreaterThan(cold.affection);
    });

    it('默认状态与初值状态字段集合一致', () => {
      const def = getDefaultEmotionState();
      const init = getInitialEmotionState(NEUTRAL_PERSONALITY);
      expect(Object.keys(init).sort()).toEqual(Object.keys(def).sort());
    });
  });

  describe('classifyUserMessage · 意图分类', () => {
    it('返回 type / intensity / confidence 三元组', async () => {
      const result = await classifyUserMessage('你真棒');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('intensity');
      expect(result).toHaveProperty('confidence');
      expect(result.intensity).toBeGreaterThan(0);
      expect(result.intensity).toBeLessThanOrEqual(1);
    });

    it.each([
      ['你长得真漂亮', 'praise'],
      ['你真是个笨蛋', 'criticism'],
      ['谢谢你一直照顾我，注意身体多休息', 'care'],
      ['哈哈哈哈哈笑死我了', 'funny'],
      ['我爱你，好想你', 'intimate'],
      ['对不起，是我错了', 'apology'],
    ])('「%s」被识别为 %s', async (text, expectedType) => {
      const { type } = await classifyUserMessage(text);
      expect(type).toBe(expectedType);
    });

    it('无任何关键词时归为 neutral', async () => {
      const result = await classifyUserMessage('zzzzz');
      expect(result.type).toBe('neutral');
      expect(result.confidence).toBe(0);
    });

    it('置信度随命中强度提升', async () => {
      const weak = await classifyUserMessage('漂亮');
      const strong = await classifyUserMessage('漂亮 好看 棒 厉害 聪明');
      expect(strong.confidence).toBeGreaterThan(weak.confidence);
    });

    it('intensity 随命中强度提升且有上限', async () => {
      const weak = await classifyUserMessage('漂亮');
      const strong = await classifyUserMessage('漂亮 好看 棒 厉害 聪明 温柔 体贴 可爱 迷人');
      expect(strong.intensity).toBeGreaterThan(weak.intensity);
      expect(strong.intensity).toBeLessThanOrEqual(1);
    });

    it('非法正则不会让分类崩溃', async () => {
      await expect(classifyUserMessage('特殊字符 )(*&^%$#@!')).resolves.toBeDefined();
    });
  });

  describe('否定与施事', () => {
    it.each([
      ['我不喜欢你', 'rejection'],
      ['不爱你', 'rejection'],
      ['他喜欢你', 'rival_affection'],
      ['他爱你', 'rival_affection'],
    ])('「%s」判为 %s，而不是亲密', async (text, expected) => {
      const result = await classifyUserMessage(text);
      expect(result.type).toBe(expected);
      expect(result.type).not.toBe('intimate');
    });

    it('正面表达仍然正确识别为亲密', async () => {
      expect((await classifyUserMessage('我爱你')).type).toBe('intimate');
      expect((await classifyUserMessage('我很喜欢你')).type).toBe('intimate');
    });

    it('否定例外词不会造成误判', async () => {
      expect((await classifyUserMessage('特别喜欢你')).type).toBe('intimate');
      expect((await classifyUserMessage('你不错')).type).toBe('praise');
    });

    it('双重否定回到正面', async () => {
      expect((await classifyUserMessage('我没有不喜欢你')).type).toBe('intimate');
    });
  });

  describe('事件类别的影响向量', () => {
    it('拒绝显著拉低亲密与好感', async () => {
      const char = await seedCharacter();
      const beforeIntimacy = char.emotionState.intimacy;
      const beforeAffection = char.emotionState.affection;

      await handleInteraction(char, 'rejection', 1);

      expect(char.emotionState.intimacy).toBeLessThan(beforeIntimacy);
      expect(char.emotionState.affection).toBeLessThan(beforeAffection);
    });

    it('第三方示好抬升唤醒并降低安全感', async () => {
      const char = await seedCharacter();
      const beforeArousal = char.emotionState.arousal;
      const beforeSafety = char.emotionState.needs.safety;

      await handleInteraction(char, 'rival_affection', 1);

      expect(char.emotionState.arousal).toBeGreaterThan(beforeArousal);
      expect(char.emotionState.needs.safety).toBeLessThan(beforeSafety);
    });

    it('安抚澄清提升安全感并降低唤醒', async () => {
      const char = await seedCharacter();
      const beforeSafety = char.emotionState.needs.safety;
      const beforeArousal = char.emotionState.arousal;

      await handleInteraction(char, 'reassurance', 1);

      expect(char.emotionState.needs.safety).toBeGreaterThan(beforeSafety);
      expect(char.emotionState.arousal).toBeLessThan(beforeArousal);
    });

    it('感谢提升尊严需求', async () => {
      const char = await seedCharacter();
      const beforeEsteem = char.emotionState.needs.esteem;
      await handleInteraction(char, 'gratitude', 1);
      expect(char.emotionState.needs.esteem).toBeGreaterThan(beforeEsteem);
    });

    it('调侃提升愉悦与亲密，但不拉低好感', async () => {
      const char = await seedCharacter();
      const beforePleasure = char.emotionState.needs.pleasure;
      const beforeIntimacy = char.emotionState.intimacy;
      const beforeAffection = char.emotionState.affection;

      await handleInteraction(char, 'teasing', 1);

      expect(char.emotionState.needs.pleasure).toBeGreaterThan(beforePleasure);
      expect(char.emotionState.intimacy).toBeGreaterThan(beforeIntimacy);
      expect(char.emotionState.affection).toBeGreaterThan(beforeAffection);
    });

    it('抱怨带来的负面远弱于拒绝（量级区分合理）', async () => {
      const byRejection = await seedCharacter();
      await handleInteraction(byRejection, 'rejection', 1);
      const rejectionDrop = -15 - byRejection.emotionState.affection;

      const byComplaint = await seedCharacter();
      await handleInteraction(byComplaint, 'complaint', 1);
      const complaintDrop = -15 - byComplaint.emotionState.affection;

      expect(complaintDrop).toBeLessThan(rejectionDrop);
    });

    it('新类别不会落到 default 分支被当成轻微正向', async () => {
      const char = await seedCharacter();
      const before = char.emotionState.valence;

      await handleInteraction(char, 'rejection', 1);

      expect(char.emotionState.valence).toBeLessThan(before - 20);
    });

    it('六维与关系值在所有新类别下都保持在合法区间', async () => {
      const char = await seedCharacter();
      for (const type of ['rejection', 'rival_affection', 'reassurance', 'gratitude', 'complaint', 'teasing']) {
        await handleInteraction(char, type, 1);
      }
      for (const dim of ['valence', 'arousal', 'dominance', 'attention', 'surprise', 'energy']) {
        expect(char.emotionState[dim], dim).toBeGreaterThanOrEqual(-100);
        expect(char.emotionState[dim], dim).toBeLessThanOrEqual(100);
      }
      for (const rel of ['affection', 'trust', 'intimacy']) {
        expect(char.emotionState[rel], rel).toBeGreaterThanOrEqual(-100);
        expect(char.emotionState[rel], rel).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('updateEmotionByTime · 时间衰减落库', () => {
    it('情绪强度向中性回归', async () => {
      const char = await seedCharacter();
      const before = { ...char.emotionState };

      await updateEmotionByTime(char, 10);

      expect(Math.abs(char.emotionState.valence)).toBeLessThan(Math.abs(before.valence));
      expect(Math.abs(char.emotionState.arousal)).toBeLessThan(Math.abs(before.arousal));
    });

    it('衰减量符合 EMOTION_DECAY_RATE 与性格因子', async () => {
      const char = await seedCharacter();
      const before = char.emotionState.valence;

      await updateEmotionByTime(char, 10);

      // decayFactor = 1 - 0.5 * 0.3 = 0.85；decayMultiplier = 1.0
      // 一阶线性衰减解析解：新值 = 旧值 * exp(-0.02 * 10 * 0.85)
      const k = 0.02 * 10 * 0.85;
      const expected = before * Math.exp(-k);
      expect(char.emotionState.valence).toBeCloseTo(expected, 6);
    });

    it('高倍速（大 hours）下不符号翻转，收敛到 0', async () => {
      const char = await seedCharacter();
      // 给一个明确的非零值，确保可观察
      char.emotionState.valence = 80;
      char.emotionState.arousal = -80;

      // 8x 倍速关闭 3 天 ≈ 576 游戏小时，旧实现单步欧拉系数 ≈ 9.8 会翻转符号
      await updateEmotionByTime(char, 576);

      // 解析解永远向 0 收敛，绝不跨过零点
      expect(char.emotionState.valence).toBeGreaterThanOrEqual(0);
      expect(char.emotionState.arousal).toBeLessThanOrEqual(0);
      expect(Math.abs(char.emotionState.valence)).toBeLessThan(80);
      expect(Math.abs(char.emotionState.arousal)).toBeLessThan(80);
    });

    it('affection 在大 hours 下不符号翻转（A-4）', async () => {
      const char = await seedCharacter();
      // 小的正 affection：旧线性欧拉在 hours > ~1600 时会翻负
      char.emotionState.affection = 2;

      await updateEmotionByTime(char, 576);

      // 解析解向 0 渐近收敛，永远不跨过零点
      expect(char.emotionState.affection).toBeGreaterThanOrEqual(0);
      expect(char.emotionState.affection).toBeLessThan(2);
    });

    it('affection 负值（厌恶）也向 0 收敛，不跨零', async () => {
      const char = await seedCharacter();
      char.emotionState.affection = -5;

      await updateEmotionByTime(char, 576);

      expect(char.emotionState.affection).toBeLessThanOrEqual(0);
      expect(char.emotionState.affection).toBeGreaterThan(-5);
    });

    it('时间跨度为 0 时不产生变化', async () => {
      const char = await seedCharacter();
      const before = { ...char.emotionState };
      await updateEmotionByTime(char, 0);
      expect(char.emotionState.valence).toBeCloseTo(before.valence, 10);
    });

    it('需求值随时间下降且不低于 0', async () => {
      const char = await seedCharacter();
      const before = { ...char.emotionState.needs };

      await updateEmotionByTime(char, 200);

      for (const key of Object.keys(before)) {
        expect(char.emotionState.needs[key]).toBeLessThanOrEqual(before[key]);
        expect(char.emotionState.needs[key]).toBeGreaterThanOrEqual(0);
      }
    });

    it('状态被真正写入数据库', async () => {
      const char = await seedCharacter();
      await updateEmotionByTime(char, 10);

      const { characters } = await getStores();
      const persisted = await characters.get(char.id);
      expect(persisted.emotionState.valence).toBeCloseTo(char.emotionState.valence, 6);
    });

    it('发出 emotion:updated 事件并携带角色 id', async () => {
      const char = await seedCharacter();
      const listener = vi.fn();
      globalEventBus.on('emotion:updated', listener);

      await updateEmotionByTime(char, 5);

      // 全局事件总线是「粘性」的：historySize=10 时，新订阅者会立刻收到
      // 最近一次同类型事件。因此不能断言"只调用一次"，只能断言目标角色的事件确实到达。
      const received = listener.mock.calls.map(args => args[0]);
      expect(received.some(e => e.characterId === char.id)).toBe(true);
      globalEventBus.off('emotion:updated', listener);
    });

    it('角色缺少 emotionState 时静默跳过', async () => {
      const char = await seedCharacter({ emotionState: undefined });
      await expect(updateEmotionByTime(char, 10)).resolves.toBeUndefined();
    });

    it('角色为 null 时静默跳过', async () => {
      await expect(updateEmotionByTime(null, 10)).resolves.toBeUndefined();
    });
  });

  describe('handleInteraction · 事件驱动', () => {
    it('被夸奖提升愉悦度', async () => {
      const char = await seedCharacter();
      const before = char.emotionState.valence;

      await handleInteraction(char, 'praise', 1.0);

      expect(char.emotionState.valence).toBeGreaterThan(before);
    });

    it('被批评降低愉悦度', async () => {
      const char = await seedCharacter();
      const before = char.emotionState.valence;

      await handleInteraction(char, 'criticism', 1.0);

      expect(char.emotionState.valence).toBeLessThan(before);
    });

    it('强度越大情绪变化越剧烈', async () => {
      const weak = await seedCharacter({ id: 'weak' });
      await handleInteraction(weak, 'praise', 0.2);
      const weakDelta = weak.emotionState.valence - getInitialEmotionState(NEUTRAL_PERSONALITY).valence;

      const strong = await seedCharacter({ id: 'strong' });
      await handleInteraction(strong, 'praise', 1.0);
      const strongDelta = strong.emotionState.valence - getInitialEmotionState(NEUTRAL_PERSONALITY).valence;

      expect(Math.abs(strongDelta)).toBeGreaterThan(Math.abs(weakDelta));
    });

    it('六维情绪保持在 -100 ~ 100 内', async () => {
      const char = await seedCharacter();
      await handleInteraction(char, 'praise', 1.0);
      await handleInteraction(char, 'intimate', 1.0);
      await handleInteraction(char, 'insult', 1.0);

      for (const dim of ['valence', 'arousal', 'dominance', 'attention', 'surprise', 'energy']) {
        expect(char.emotionState[dim], dim).toBeGreaterThanOrEqual(-100);
        expect(char.emotionState[dim], dim).toBeLessThanOrEqual(100);
      }
    });

    it('变化结果被写入数据库', async () => {
      const char = await seedCharacter();
      await handleInteraction(char, 'praise', 1.0);

      const { characters } = await getStores();
      const persisted = await characters.get(char.id);
      expect(persisted.emotionState.valence).toBeCloseTo(char.emotionState.valence, 6);
    });

    it('未知事件类型不抛错', async () => {
      const char = await seedCharacter();
      await expect(handleInteraction(char, 'not-an-event', 0.5)).resolves.toBeUndefined();
    });

    it('proactive_share 轻微提升愉悦与归属，量级弱于 praise', async () => {
      const byShare = await seedCharacter();
      const shareBefore = byShare.emotionState.valence;
      const shareBelongingBefore = byShare.emotionState.needs.belonging;
      await handleInteraction(byShare, 'proactive_share', 1);

      const byPraise = await seedCharacter();
      const praiseBefore = byPraise.emotionState.valence;
      await handleInteraction(byPraise, 'praise', 1);

      // 主动分享是轻微正向：愉悦与归属都上升，但幅度弱于「被夸奖」
      expect(byShare.emotionState.valence).toBeGreaterThan(shareBefore);
      expect(byShare.emotionState.needs.belonging).toBeGreaterThan(shareBelongingBefore);
      const shareDelta = byShare.emotionState.valence - shareBefore;
      const praiseDelta = byPraise.emotionState.valence - praiseBefore;
      expect(shareDelta).toBeLessThan(praiseDelta);
    });
  });

  describe('引擎开关', () => {
    it('emotion 开关关闭后时间衰减不生效', async () => {
      const char = await seedCharacter();
      const before = char.emotionState.valence;
      getAppState().set('settings', { engineFlags: { emotion: false } });

      await updateEmotionByTime(char, 10);

      expect(char.emotionState.valence).toBe(before);
    });

    it('emotion 开关关闭后事件驱动不生效', async () => {
      const char = await seedCharacter();
      const before = char.emotionState.valence;
      getAppState().set('settings', { engineFlags: { emotion: false } });

      await handleInteraction(char, 'praise', 1.0);

      expect(char.emotionState.valence).toBe(before);
    });

    it('开关关闭时不发出 emotion:updated 事件', async () => {
      const char = await seedCharacter();
      getAppState().set('settings', { engineFlags: { emotion: false } });
      const listener = vi.fn();
      globalEventBus.on('emotion:updated', listener);

      await updateEmotionByTime(char, 10);

      // 粘性总线会回放历史事件，因此按角色 id 过滤，只断言本角色没有事件。
      const received = listener.mock.calls.map(args => args[0]);
      expect(received.filter(e => e.characterId === char.id)).toHaveLength(0);
      globalEventBus.off('emotion:updated', listener);
    });
  });

  describe('情绪标签映射', () => {
    it('空状态返回中性', () => {
      expect(getEmotionLabel(null)).toBe('中性');
    });

    it('高愉悦高唤醒高支配映射为兴奋', () => {
      expect(getEmotionLabel({
        valence: 80, arousal: 60, dominance: 50, attention: 50, surprise: 0, energy: 60,
        affection: 0, trust: 0, intimacy: 0, needs: { esteem: 50, safety: 50, belonging: 50 },
      })).toBe('兴奋');
    });

    it('低愉悦高唤醒高支配映射为愤怒', () => {
      expect(getEmotionLabel({
        valence: -80, arousal: 80, dominance: 50, attention: 50, surprise: 0, energy: 0,
        affection: 0, trust: 0, intimacy: 0, needs: { esteem: 50, safety: 50, belonging: 50 },
      })).toBe('愤怒');
    });

    it('全零状态落到中性', () => {
      expect(getEmotionLabel({
        valence: 0, arousal: 0, dominance: 0, attention: 0, surprise: 0, energy: 0,
        affection: 0, trust: 0, intimacy: 0, needs: { esteem: 50, safety: 50, belonging: 50 },
      })).toBe('中性');
    });

    it('getEmotionDescription 在无状态时返回平稳文案', () => {
      expect(getEmotionDescription(null)).toBe('情绪平稳');
    });

    it('getEmotionDescription 包含六维数值', () => {
      const desc = getEmotionDescription({ emotionState: getDefaultEmotionState() });
      expect(desc).toContain('愉悦');
      expect(desc).toContain('唤醒');
      expect(desc).toContain('支配');
    });
  });
});
