import { describe, it, expect } from 'vitest';
import {
  SPECIAL_TYPES,
  getDefaultBodyProfile,
  getDefaultEmotionProfile,
  getSpecialTypeList,
  normalizeBodyProfile,
  normalizeEmotionProfile,
  getBodyProfile,
  getEmotionProfile,
  deriveBodyProfileFromPersonality,
  deriveEmotionProfileFromPersonality,
  getCircadianMultiplier,
} from '../../../js/modules/profileDefaults.js';

describe('modules/profileDefaults', () => {
  describe('默认值', () => {
    it('bodyProfile 默认值与预期一致', () => {
      const p = getDefaultBodyProfile();
      expect(p.chronotype).toBe('neutral');
      expect(p.circadianEnabled).toBe(true);
      expect(p.sleepNeedHours).toBe(7);
      expect(p.allowNapping).toBe(false);
      expect(p.special).toBeNull();
    });

    it('emotionProfile 默认值为中性 0.5 / 1.0', () => {
      const p = getDefaultEmotionProfile();
      expect(p.emotionalSensitivity).toBe(0.5);
      expect(p.emotionalVolatility).toBe(0.5);
      expect(p.emotionalDecayFactor).toBe(1.0);
    });

    it('每次调用返回新对象', () => {
      const a = getDefaultBodyProfile();
      a.sleepNeedHours = 99;
      expect(getDefaultBodyProfile().sleepNeedHours).toBe(7);
    });
  });

  describe('normalizeBodyProfile', () => {
    it('空输入返回默认值', () => {
      expect(normalizeBodyProfile(null)).toEqual(getDefaultBodyProfile());
      expect(normalizeBodyProfile(undefined)).toEqual(getDefaultBodyProfile());
    });

    it('非法 chronotype 回退到默认值', () => {
      expect(normalizeBodyProfile({ chronotype: 'invalid' }).chronotype).toBe('neutral');
    });

    it('合法 chronotype 被保留', () => {
      for (const c of ['morning', 'neutral', 'evening', 'none']) {
        expect(normalizeBodyProfile({ chronotype: c }).chronotype).toBe(c);
      }
    });

    it('非布尔值的 circadianEnabled 回退到默认值', () => {
      expect(normalizeBodyProfile({ circadianEnabled: 'yes' }).circadianEnabled).toBe(true);
      expect(normalizeBodyProfile({ circadianEnabled: false }).circadianEnabled).toBe(false);
    });

    it('未知的 special 类型被清空为 null', () => {
      expect(normalizeBodyProfile({ special: 'not-a-type' }).special).toBeNull();
    });

    it('已知的 special 类型被保留', () => {
      const first = getSpecialTypeList()[0];
      expect(normalizeBodyProfile({ special: first.id }).special).toBe(first.id);
    });

    it('数值字段被裁剪到合法区间', () => {
      const p = normalizeBodyProfile({ sleepNeedHours: 999, napTendency: -5 });
      expect(p.sleepNeedHours).toBeLessThanOrEqual(14);
      expect(p.napTendency).toBeGreaterThanOrEqual(0);
    });

    it('缺失字段由默认值补齐，输出字段集合稳定', () => {
      const keys = Object.keys(normalizeBodyProfile({}));
      expect(keys.sort()).toEqual(Object.keys(getDefaultBodyProfile()).sort());
    });
  });

  describe('normalizeEmotionProfile', () => {
    it('空输入返回默认值', () => {
      expect(normalizeEmotionProfile(null)).toEqual(getDefaultEmotionProfile());
    });

    it('输出字段集合稳定', () => {
      expect(Object.keys(normalizeEmotionProfile({})).sort())
        .toEqual(Object.keys(getDefaultEmotionProfile()).sort());
    });

    it('数值被裁剪到合法区间', () => {
      const p = normalizeEmotionProfile({ emotionalSensitivity: 100 });
      expect(p.emotionalSensitivity).toBeLessThanOrEqual(2);
    });
  });

  describe('getSpecialTypeList', () => {
    it('返回 id / label 结构且非空', () => {
      const list = getSpecialTypeList();
      expect(list.length).toBeGreaterThan(0);
      for (const item of list) {
        expect(item.id).toBeTruthy();
        expect(item.label).toBeTruthy();
        expect(SPECIAL_TYPES[item.id]).toBeDefined();
      }
    });
  });

  describe('getBodyProfile', () => {
    it('角色为空时返回默认 profile', () => {
      expect(getBodyProfile(null)).toEqual(getDefaultBodyProfile());
    });

    it('优先采用角色显式提供的 bodyProfile', () => {
      const p = getBodyProfile({ bodyProfile: { sleepNeedHours: 9 } });
      expect(p.sleepNeedHours).toBe(9);
    });

    it('无 bodyProfile 时从性格推导，结果结构完整', () => {
      const keys = Object.keys(getBodyProfile({ personalityParameters: { conscientiousness: 80 } }));
      expect(keys.sort()).toEqual(Object.keys(getDefaultBodyProfile()).sort());
    });
  });

  describe('getEmotionProfile', () => {
    it('角色为空时返回默认 profile', () => {
      expect(getEmotionProfile(null)).toEqual(getDefaultEmotionProfile());
    });

    it('优先采用角色显式提供的 emotionProfile', () => {
      const p = getEmotionProfile({ emotionProfile: { emotionalSensitivity: 0.9 } });
      expect(p.emotionalSensitivity).toBe(0.9);
    });
  });

  describe('性格推导', () => {
    it('高尽责性推导出更长的睡眠需求或更强的精力恢复', () => {
      const low = deriveBodyProfileFromPersonality({ conscientiousness: 10 });
      const high = deriveBodyProfileFromPersonality({ conscientiousness: 90 });
      expect(low).not.toEqual(high);
    });

    it('推导结果中的数值均落在合法区间', () => {
      const p = deriveBodyProfileFromPersonality({
        openness: 100, conscientiousness: 100, extraversion: 100,
        agreeableness: 0, neuroticism: 100, expressiveness: 100,
      });
      for (const [key, value] of Object.entries(p)) {
        if (typeof value === 'number') {
          expect(Number.isFinite(value), `${key} 应为有限数`).toBe(true);
          expect(value, `${key} 不应为负`).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('情绪 profile 推导对极端性格保持有界', () => {
      const p = deriveEmotionProfileFromPersonality({ neuroticism: 100, agreeableness: 0 });
      expect(p.emotionalSensitivity).toBeGreaterThan(0);
      expect(p.emotionalSensitivity).toBeLessThanOrEqual(2);
    });
  });

  describe('getCircadianMultiplier', () => {
    it('profile 为空时返回中性 1.0', () => {
      expect(getCircadianMultiplier(12, null)).toBe(1.0);
    });

    it('关闭昼夜节律时返回 1.0', () => {
      expect(getCircadianMultiplier(12, { circadianEnabled: false })).toBe(1.0);
    });

    it('chronotype 为 none 时返回 1.0', () => {
      expect(getCircadianMultiplier(12, { chronotype: 'none', circadianEnabled: true })).toBe(1.0);
    });

    it('早起鸟在 8:00 达到峰值 1.3', () => {
      expect(getCircadianMultiplier(8, { chronotype: 'morning' })).toBeCloseTo(1.3, 5);
    });

    it('早起鸟在 20:00 降到谷值 0.7', () => {
      expect(getCircadianMultiplier(20, { chronotype: 'morning' })).toBeCloseTo(0.7, 5);
    });

    it('夜猫子在 22:00 达到峰值 1.3', () => {
      expect(getCircadianMultiplier(22, { chronotype: 'evening' })).toBeCloseTo(1.3, 5);
    });

    it('中性型在 14:00 达到峰值 1.2', () => {
      expect(getCircadianMultiplier(14, { chronotype: 'neutral' })).toBeCloseTo(1.2, 5);
    });

    it('结果始终落在 0.1 ~ 2.0 区间', () => {
      for (const chronotype of ['morning', 'neutral', 'evening']) {
        for (let hour = 0; hour < 24; hour++) {
          const v = getCircadianMultiplier(hour, { chronotype });
          expect(v).toBeGreaterThanOrEqual(0.1);
          expect(v).toBeLessThanOrEqual(2.0);
        }
      }
    });

    it('吸血鬼在夜间获得加成、白天被削弱', () => {
      const night = getCircadianMultiplier(22, { chronotype: 'neutral', special: 'vampire' });
      const day = getCircadianMultiplier(10, { chronotype: 'neutral', special: 'vampire' });
      const baseline = getCircadianMultiplier(22, { chronotype: 'neutral' });
      expect(night).toBeGreaterThan(baseline);
      expect(day).toBeLessThan(getCircadianMultiplier(10, { chronotype: 'neutral' }));
    });

    it('植物型在正午获得加成', () => {
      const noon = getCircadianMultiplier(12, { chronotype: 'neutral', special: 'plant' });
      const base = getCircadianMultiplier(12, { chronotype: 'neutral' });
      expect(noon).toBeGreaterThan(base);
    });
  });
});
