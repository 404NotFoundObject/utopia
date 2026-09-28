import { describe, it, expect } from 'vitest';
import {
  SCENE_REGISTRY,
  getSceneDef,
  getAllSceneTypes,
  getSceneReframeHint,
  isReframable,
  isSensitive,
  buildPersonaBrief,
  getToneHint,
} from '../../../js/modules/sceneRegistry.js';

describe('modules/sceneRegistry', () => {
  describe('注册表结构完整性', () => {
    it('每个场景都具备必需字段', () => {
      for (const [key, def] of Object.entries(SCENE_REGISTRY)) {
        expect(def.label, `${key}.label`).toBeTruthy();
        expect(typeof def.maxDuration, `${key}.maxDuration`).toBe('number');
        expect(typeof def.staleThreshold, `${key}.staleThreshold`).toBe('number');
        expect(def, `${key}.reframeMode`).toHaveProperty('reframeMode');
      }
    });

    it('过期阈值不早于最大时长', () => {
      for (const [key, def] of Object.entries(SCENE_REGISTRY)) {
        expect(def.staleThreshold, `${key} 的 staleThreshold 应 >= maxDuration`)
          .toBeGreaterThanOrEqual(def.maxDuration);
      }
    });

    it('敏感场景必须禁止 reframe', () => {
      for (const [key, def] of Object.entries(SCENE_REGISTRY)) {
        if (def.sensitivity === 'high') {
          expect(def.reframeMode, `${key} 为敏感场景，reframeMode 应为 null`).toBeNull();
        }
      }
    });

    it('可 reframe 的场景必须提供 reframeHints', () => {
      for (const [key, def] of Object.entries(SCENE_REGISTRY)) {
        if (def.reframeMode !== null) {
          expect(Object.keys(def.reframeHints).length, `${key} 缺少 reframeHints`)
            .toBeGreaterThan(0);
        }
      }
    });
  });

  describe('getSceneDef', () => {
    it('返回已知场景的定义', () => {
      expect(getSceneDef('meal').label).toBe('吃饭');
      expect(getSceneDef('movie').label).toBe('看电影');
    });

    it('未知类型回退到 unknown 定义而不是抛错', () => {
      expect(getSceneDef('nonexistent')).toBe(SCENE_REGISTRY.unknown);
    });
  });

  describe('getAllSceneTypes', () => {
    it('排除 chat 与 unknown 两个兜底场景', () => {
      const types = getAllSceneTypes();
      expect(types).not.toContain('chat');
      expect(types).not.toContain('unknown');
    });

    it('返回全部业务场景', () => {
      const types = getAllSceneTypes();
      for (const expected of ['meal', 'movie', 'sleep', 'work', 'study', 'intimate', 'conflict']) {
        expect(types).toContain(expected);
      }
    });
  });

  describe('getSceneReframeHint', () => {
    it('时间跨度低于最小阈值时返回 null', () => {
      expect(getSceneReframeHint('meal', 1)).toBeNull();
    });

    it('落在区间内时返回该档位的提示', () => {
      const hint = getSceneReframeHint('meal', 5);
      expect(hint).toBe(SCENE_REGISTRY.meal.reframeHints[3]);
    });

    it('取不超过时间跨度的最大档位', () => {
      // 30 小时同时满足 3 / 8 / 24 三档，应取 24
      expect(getSceneReframeHint('meal', 30)).toBe(SCENE_REGISTRY.meal.reframeHints[24]);
    });

    it('恰好等于档位阈值时命中该档', () => {
      expect(getSceneReframeHint('meal', 3)).toBe(SCENE_REGISTRY.meal.reframeHints[3]);
      expect(getSceneReframeHint('meal', 8)).toBe(SCENE_REGISTRY.meal.reframeHints[8]);
    });

    it('不可 reframe 的场景（reframeMode 为 null）返回 null', () => {
      expect(getSceneReframeHint('intimate', 100)).toBeNull();
      expect(getSceneReframeHint('conflict', 100)).toBeNull();
    });

    it('未知场景返回 null', () => {
      expect(getSceneReframeHint('nonexistent', 100)).toBeNull();
    });
  });

  describe('isReframable / isSensitive', () => {
    it('普通场景可 reframe 且不敏感', () => {
      expect(isReframable('meal')).toBe(true);
      expect(isSensitive('meal')).toBe(false);
    });

    it('亲密与争执场景既敏感又不可 reframe', () => {
      for (const type of ['intimate', 'conflict']) {
        expect(isSensitive(type), `${type} 应为敏感场景`).toBe(true);
        expect(isReframable(type), `${type} 不应可 reframe`).toBe(false);
      }
    });

    it('未知场景不敏感且不可 reframe', () => {
      expect(isSensitive('nonexistent')).toBe(false);
      expect(isReframable('nonexistent')).toBe(false);
    });
  });

  describe('buildPersonaBrief', () => {
    it('角色为空时返回空字符串', () => {
      expect(buildPersonaBrief(null)).toBe('');
      expect(buildPersonaBrief(undefined)).toBe('');
    });

    it('至少包含名称行', () => {
      expect(buildPersonaBrief({ name: '凌川' })).toBe('名称：凌川');
    });

    it('缺少名称时使用占位文案', () => {
      expect(buildPersonaBrief({})).toContain('未知角色');
    });

    it('拼接描述 / 性格 / 关系三段', () => {
      const brief = buildPersonaBrief({
        name: '柳如烟',
        description: '咖啡馆店员',
        personality: '迷糊',
        relationship: '朋友',
      });
      expect(brief).toContain('名称：柳如烟');
      expect(brief).toContain('描述：咖啡馆店员');
      expect(brief).toContain('性格：迷糊');
      expect(brief).toContain('与用户关系：朋友');
    });

    it('超长字段截断到 100 字符并加省略号', () => {
      const brief = buildPersonaBrief({ name: 'A', description: 'x'.repeat(200) });
      expect(brief).toContain('x'.repeat(100) + '...');
      expect(brief).not.toContain('x'.repeat(101));
    });
  });

  describe('getToneHint', () => {
    it('无性格参数时返回中性方向', () => {
      expect(getToneHint({})).toContain('自然平和');
    });

    it('高外向 + 高宜人 → 活泼温暖', () => {
      const hint = getToneHint({
        personalityParameters: { extraversion: 80, agreeableness: 80, neuroticism: 50 },
      });
      expect(hint).toContain('活泼+温暖');
    });

    it('高外向 + 低宜人 → 外向毒舌', () => {
      const hint = getToneHint({
        personalityParameters: { extraversion: 80, agreeableness: 20, neuroticism: 50 },
      });
      expect(hint).toContain('外向+毒舌');
    });

    it('低外向 + 高宜人 → 内敛温柔', () => {
      const hint = getToneHint({
        personalityParameters: { extraversion: 20, agreeableness: 80, neuroticism: 50 },
      });
      expect(hint).toContain('内敛+温柔');
    });

    it('高神经质追加情绪敏感提示', () => {
      const hint = getToneHint({
        personalityParameters: { extraversion: 50, agreeableness: 50, neuroticism: 80 },
      });
      expect(hint).toContain('情绪敏感');
    });

    it('低神经质追加情绪稳定提示', () => {
      const hint = getToneHint({
        personalityParameters: { extraversion: 50, agreeableness: 50, neuroticism: 10 },
      });
      expect(hint).toContain('情绪稳定');
    });

    it('角色为 null 时不抛错', () => {
      expect(() => getToneHint(null)).not.toThrow();
      expect(getToneHint(null)).toContain('自然平和');
    });
  });
});
