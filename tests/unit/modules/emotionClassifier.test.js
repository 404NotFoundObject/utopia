import { describe, it, expect, vi } from 'vitest';
import {
  classifyByRules,
  classifyEmotion,
  splitClauses,
  resolveHitType,
  hasStructuralVerdict,
  isRuleConfident,
  fuseScores,
  needsArbitration,
} from '../../../js/modules/emotionClassifier.js';

/** 便捷断言：只关心类别 */
function typeOf(text) {
  return classifyByRules(text).type;
}

describe('modules/emotionClassifier · 规则层', () => {
  // 这组用例守住否定与施事的结构判定：只看「词在不在串里」会把
  // 「我不喜欢你」和「他喜欢你」都判成亲密。
  describe('否定与施事的易错用例', () => {
    it('我不喜欢你 → 拒绝疏离（而非亲密）', () => {
      expect(typeOf('我不喜欢你')).toBe('rejection');
    });

    it('不爱你 → 拒绝疏离（而非亲密）', () => {
      expect(typeOf('不爱你')).toBe('rejection');
    });

    it('他喜欢你 → 第三方示好（而非亲密）', () => {
      expect(typeOf('他喜欢你')).toBe('rival_affection');
    });

    it('他爱你 → 第三方示好（而非亲密）', () => {
      expect(typeOf('他爱你')).toBe('rival_affection');
    });

    it('三种否定/第三方写法都不会落到 intimate', () => {
      for (const text of ['我不喜欢你', '不爱你', '他喜欢你', '他爱你']) {
        expect(classifyByRules(text).type, text).not.toBe('intimate');
      }
    });
  });

  describe('施受关系判定', () => {
    it('我喜欢你 → 亲密', () => {
      expect(typeOf('我喜欢你')).toBe('intimate');
    });

    it('我爱你 → 亲密', () => {
      expect(typeOf('我爱你')).toBe('intimate');
    });

    it('我很喜欢你 → 亲密', () => {
      expect(typeOf('我很喜欢你')).toBe('intimate');
    });

    it('我喜欢他 → 第三方示好（情感流向别处）', () => {
      expect(typeOf('我喜欢他')).toBe('rival_affection');
    });

    it('他不喜欢你 → 归为转述，不污染亲密', () => {
      expect(typeOf('他不喜欢你')).toBe('gossip');
    });

    it('我喜欢他，不喜欢你 → 不会误判为亲密', () => {
      const r = classifyByRules('我喜欢他，不喜欢你');
      expect(['rival_affection', 'rejection', 'gossip']).toContain(r.type);
    });
  });

  describe('形容词谓语不能被误认为施事', () => {
    // 「你很笨」里的「你」是被评价的对象，不是施事。
    // 若把前置代词一律当施事，会判成「角色在评价用户」而错失一次真实批评。
    it('你很笨 → 批评', () => {
      expect(typeOf('你很笨')).toBe('criticism');
    });

    it('你真的很笨 → 批评', () => {
      expect(typeOf('你真的很笨')).toBe('criticism');
    });

    it('你很漂亮 → 夸奖', () => {
      expect(typeOf('你很漂亮')).toBe('praise');
    });

    it('他真笨 → 吐槽第三方，不是批评角色', () => {
      expect(typeOf('他真笨')).toBe('gossip');
    });
  });

  describe('否定例外词', () => {
    // 未加保护时「特别」里的「别」会被当成否定，「不错」里的「不」也是。
    it('特别喜欢你 → 亲密（「别」不构成否定）', () => {
      expect(typeOf('特别喜欢你')).toBe('intimate');
    });

    it('不错 → 夸奖（「不」不构成否定）', () => {
      expect(typeOf('不错')).toBe('praise');
    });

    it('你不错啊 → 夸奖', () => {
      expect(typeOf('你不错啊')).toBe('praise');
    });

    it('我忍不住想你了 → 亲密（「不住」不构成否定）', () => {
      expect(typeOf('我忍不住想你了')).toBe('intimate');
    });

    it('我对你真是佩服得不得了 → 不会被判为否定', () => {
      expect(classifyByRules('我对你真是佩服得不得了').type).toBe('praise');
    });
  });

  describe('双重否定', () => {
    it('我没有不喜欢你 → 亲密（两个否定抵消）', () => {
      expect(typeOf('我没有不喜欢你')).toBe('intimate');
    });

    it('我不是不爱你 → 亲密', () => {
      expect(typeOf('我不是不爱你')).toBe('intimate');
    });

    it('单个否定仍然生效', () => {
      expect(typeOf('我不是爱你')).toBe('rejection');
    });
  });

  describe('扩展类别', () => {
    it.each([
      ['谢谢你一直陪着我', 'gratitude'],
      ['烦死了', 'complaint'],
      ['真的很累', 'complaint'],
      ['逗你玩的', 'teasing'],
      ['我没有生你的气', 'reassurance'],
      ['我们分手吧', 'rejection'],
      ['听说你最近很忙', 'gossip'],
      ['能帮我一下吗', 'request'],
      ['你必须照我说的做', 'command'],
    ])('「%s」→ %s', (text, expected) => {
      expect(typeOf(text)).toBe(expected);
    });
  });

  describe('子句切分与权重', () => {
    it('按标点切分', () => {
      const clauses = splitClauses('你好啊！最近怎么样？');
      expect(clauses.map(c => c.text)).toEqual(['你好啊', '最近怎么样']);
    });

    it('按转折连词切分', () => {
      const clauses = splitClauses('虽然你很笨但是我喜欢你');
      expect(clauses.length).toBeGreaterThan(1);
    });

    it('靠后的子句权重更高', () => {
      const clauses = splitClauses('第一句，第二句，第三句');
      expect(clauses[0].weight).toBeLessThan(clauses[2].weight);
      expect(clauses[2].weight).toBe(1);
    });

    it('单句权重为 1', () => {
      expect(splitClauses('只有一句话')[0].weight).toBe(1);
    });

    it('转折后句主导判定', () => {
      expect(typeOf('你很笨，但是我喜欢你')).toBe('intimate');
    });

    it('后句的否定能压过前句的肯定', () => {
      expect(typeOf('我喜欢你，但是我不爱你了')).toBe('rejection');
    });
  });

  describe('极性冲突检测', () => {
    it('正负并存时标记为矛盾并削弱强度', () => {
      const r = classifyByRules('我喜欢你，但是我不爱你了');
      expect(r.ambivalent).toBe(true);
      expect(r.positiveScore).toBeGreaterThan(0);
      expect(r.negativeScore).toBeGreaterThan(0);
    });

    it('单一极性的句子不会被标记为矛盾', () => {
      expect(classifyByRules('我真的好喜欢你').ambivalent).toBe(false);
    });

    it('矛盾时强度低于同等单一情绪的强度', () => {
      const ambivalent = classifyByRules('我喜欢你，但是我不爱你了');
      const pure = classifyByRules('我真的好喜欢好喜欢你');
      expect(ambivalent.intensity).toBeLessThan(pure.intensity);
    });
  });

  describe('置信度语义', () => {
    it('置信度归一化到 0~1', () => {
      for (const text of ['我喜欢你', '你很笨', '听说你最近很忙', '好烦']) {
        const c = classifyByRules(text).confidence;
        expect(c, text).toBeGreaterThanOrEqual(0);
        expect(c, text).toBeLessThanOrEqual(1);
      }
    });

    it('证据越充分置信度越高', () => {
      const weak = classifyByRules('不错');
      const strong = classifyByRules('你真漂亮，特别好看，你太好看了');
      expect(strong.confidence).toBeGreaterThan(weak.confidence);
    });

    it('跨类别的混合表达会拉低置信度', () => {
      // 同一句里既有夸奖又有亲密时前两名得分接近，置信度应当下降 ——
      // 置信度表达的是「前两名之间的差距」，不是「命中了多少词」。
      const mixed = classifyByRules('你真的很漂亮，特别好看，我很喜欢');
      const pure = classifyByRules('你真漂亮，特别好看，你太好看了');
      expect(mixed.confidence).toBeLessThan(pure.confidence);
    });

    it('单一类别独占时 margin 高', () => {
      expect(classifyByRules('我爱你').margin).toBe(1);
    });
  });

  describe('中性兜底', () => {
    it.each(['', '   ', 'zzzzz', '今天天气还行', null, undefined, 123])(
      '「%s」不报错', (text) => {
        expect(() => classifyByRules(text)).not.toThrow();
      },
    );

    it('无任何信号时返回 neutral 且强度为 0', () => {
      const r = classifyByRules('zzzzz');
      expect(r.type).toBe('neutral');
      expect(r.intensity).toBe(0);
      expect(r.confidence).toBe(0);
    });
  });

  describe('弱词机制', () => {
    it('弱词不能单独触发类别', () => {
      // 「美」是 praise 的弱词，单独出现不应判为夸奖
      expect(classifyByRules('今天真美').type).toBe('neutral');
    });

    it('弱词在同子句内强词命中后才计入', () => {
      const withWeak = classifyByRules('你真是漂亮又美');
      const withoutWeak = classifyByRules('你真是漂亮');
      expect(withWeak.type).toBe('praise');
      expect(withWeak.score).toBeGreaterThan(withoutWeak.score);
    });

    it('弱词不会跨子句被启用', () => {
      // 「美」与强词「漂亮」分处不同子句时，弱词不应被启用
      const acrossClause = classifyByRules('你真是漂亮，美');
      const single = classifyByRules('你真是漂亮');
      expect(acrossClause.score).toBeLessThanOrEqual(single.score);
    });
  });

  describe('debug 模式', () => {
    it('输出子句级判定过程', () => {
      const r = classifyByRules('我不喜欢你', { debug: true });
      expect(Array.isArray(r.clauses)).toBe(true);
      expect(r.clauses.length).toBeGreaterThan(0);
      const hit = r.clauses[0].hits[0];
      expect(hit).toHaveProperty('word');
      expect(hit).toHaveProperty('negated');
      expect(hit).toHaveProperty('agent');
      expect(hit).toHaveProperty('target');
      expect(hit).toHaveProperty('reason');
    });

    it('标注否定判定', () => {
      const r = classifyByRules('我不喜欢你', { debug: true });
      expect(r.clauses[0].hits.some(h => h.negated)).toBe(true);
    });

    it('标注第三方施事', () => {
      const r = classifyByRules('他喜欢你', { debug: true });
      expect(r.clauses[0].hits.some(h => h.agent === 'third')).toBe(true);
    });
  });

  describe('结构裁定与置信判定', () => {
    it('否定属于结构性裁定', () => {
      expect(hasStructuralVerdict(classifyByRules('我不喜欢你', { debug: true }))).toBe(true);
    });

    it('第三方施事属于结构性裁定', () => {
      expect(hasStructuralVerdict(classifyByRules('他喜欢你', { debug: true }))).toBe(true);
    });

    it('普通命中不属于结构性裁定', () => {
      expect(hasStructuralVerdict(classifyByRules('你很笨', { debug: true }))).toBe(false);
    });

    it('单一类别强命中时规则层足够确定', () => {
      expect(isRuleConfident(classifyByRules('我很喜欢你'))).toBe(true);
    });

    it('neutral 不算确定', () => {
      expect(isRuleConfident(classifyByRules('zzzzz'))).toBe(false);
    });
  });

  describe('resolveHitType 单独可测', () => {
    it('第三方施事 + 正向 → rival_affection', () => {
      const out = resolveHitType({
        type: 'intimate', negated: false, agent: 'third', target: 'character',
      });
      expect(out.resolvedType).toBe('rival_affection');
    });

    it('否定 + 无对偶 → 标记 polarityFlip', () => {
      const out = resolveHitType({
        type: 'gossip', negated: true, agent: 'user', target: 'character',
      });
      expect(out.polarityFlip).toBe(true);
    });
  });

  // ============================================================
  // 融合层
  // ============================================================

  describe('fuseScores 权重自适应', () => {
    it('规则层证据充分时由规则层主导', () => {
      const rule = classifyByRules('我很喜欢你');
      const fusion = fuseScores(rule, null);
      expect(fusion.ruleWeight).toBeGreaterThan(0.6);
    });

    it('规则层无证据时把话语权交给语义层', () => {
      const rule = classifyByRules('zzzzz');
      const fusion = fuseScores(rule, [{ type: 'complaint', score: 0.8 }]);
      expect(fusion.ruleWeight).toBeLessThanOrEqual(0.35);
      expect(fusion.fused.complaint).toBeGreaterThan(0);
    });

    it('语义相似度低于下限时映射为 0', () => {
      const rule = classifyByRules('zzzzz');
      const fusion = fuseScores(rule, [{ type: 'praise', score: 0.4 }]);
      expect(fusion.semNorm.praise).toBe(0);
    });

    it('语义相似度达到上限时映射为 1', () => {
      const rule = classifyByRules('zzzzz');
      const fusion = fuseScores(rule, [{ type: 'praise', score: 0.9 }]);
      expect(fusion.semNorm.praise).toBe(1);
    });
  });

  describe('needsArbitration 触发条件', () => {
    it('高置信且不矛盾时不触发', () => {
      expect(needsArbitration({ type: 'intimate', margin: 0.9, ambivalent: false })).toBe(false);
    });

    it('前两名差距过小时触发', () => {
      expect(needsArbitration({ type: 'intimate', margin: 0.1, ambivalent: false })).toBe(true);
    });

    it('极性矛盾时触发', () => {
      expect(needsArbitration({ type: 'intimate', margin: 0.9, ambivalent: true })).toBe(true);
    });

    it('neutral 不触发（避免对「嗯」「好的」发起请求）', () => {
      expect(needsArbitration({ type: 'neutral', margin: 1, ambivalent: false })).toBe(false);
    });
  });

  describe('classifyEmotion · 三层级联', () => {
    it('结构性裁定：否定不再询问下层', async () => {
      const llmArbiter = vi.fn(async () => ({ type: 'intimate' }));
      const r = await classifyEmotion('我不喜欢你', {
        semanticMode: 'off', useLLMArbiter: true, llmArbiter,
      });
      expect(r.type).toBe('rejection');
      expect(r.arbitration).toBe('structural');
      expect(llmArbiter).not.toHaveBeenCalled();
    });

    it('结构性裁定：第三方示好同样短路', async () => {
      const r = await classifyEmotion('他喜欢你', { semanticMode: 'off' });
      expect(r.type).toBe('rival_affection');
      expect(r.arbitration).toBe('structural');
    });

    it('规则层证据充分时不调用 LLM', async () => {
      const llmArbiter = vi.fn();
      await classifyEmotion('我很喜欢你', {
        semanticMode: 'off', useLLMArbiter: true, llmArbiter,
      });
      expect(llmArbiter).not.toHaveBeenCalled();
    });

    it('结构性裁定优先于 LLM 仲裁，即使结果本身矛盾', async () => {
      // 这句话含否定（结构性）且极性矛盾，但规则层结论明确（rejection 领先），
      // 应当直接采纳 —— 理由充分时不该再付出一次请求。
      const llmArbiter = vi.fn(async () => ({ type: 'intimate' }));
      const r = await classifyEmotion('我喜欢你，但是我不爱你了', {
        semanticMode: 'off', useLLMArbiter: true, llmArbiter,
      });
      expect(r.type).toBe('rejection');
      expect(r.arbitration).toBe('structural');
      expect(llmArbiter).not.toHaveBeenCalled();
    });

    it('证据矛盾时调用 LLM 仲裁并采纳其结论', async () => {
      // 这句没有否定，但正负情绪并存（感谢 + 抱怨）→ 触发仲裁
      const llmArbiter = vi.fn(async () => ({ type: 'complaint', intensity: 0.8 }));
      const r = await classifyEmotion('谢谢你，不过你真的好烦', {
        semanticMode: 'off', useLLMArbiter: true, llmArbiter,
      });
      expect(llmArbiter).toHaveBeenCalledTimes(1);
      expect(r.type).toBe('complaint');
      expect(r.layer).toBe('llm');
      expect(r.intensity).toBe(0.8);
    });

    it('LLM 返回非法类别时不采纳，回落到融合结果', async () => {
      const llmArbiter = vi.fn(async () => ({ type: 'not-a-real-type' }));
      const r = await classifyEmotion('谢谢你，不过你真的好烦', {
        semanticMode: 'off', useLLMArbiter: true, llmArbiter,
      });
      expect(r.type).not.toBe('not-a-real-type');
      expect(['complaint', 'gratitude']).toContain(r.type);
    });

    it('LLM 抛错时不影响主流程', async () => {
      const llmArbiter = vi.fn(async () => { throw new Error('network down'); });
      await expect(
        classifyEmotion('谢谢你，不过你真的好烦', {
          semanticMode: 'off', useLLMArbiter: true, llmArbiter,
        }),
      ).resolves.toBeDefined();
    });

    it('未开启仲裁时不调用 LLM', async () => {
      const llmArbiter = vi.fn();
      await classifyEmotion('谢谢你，不过你真的好烦', {
        semanticMode: 'off', useLLMArbiter: false, llmArbiter,
      });
      expect(llmArbiter).not.toHaveBeenCalled();
    });

    it('语义层不可用时优雅降级，不影响规则层结论', async () => {
      const r = await classifyEmotion('你很笨', { semanticMode: 'always' });
      expect(r.type).toBe('criticism');
      expect(r.layer).toBe('rule');
    });

    it('返回结构保持向后兼容：type 与 intensity 必存', async () => {
      const r = await classifyEmotion('我爱你');
      expect(typeof r.type).toBe('string');
      expect(typeof r.intensity).toBe('number');
      expect(r.intensity).toBeGreaterThan(0);
      expect(r.intensity).toBeLessThanOrEqual(1);
    });

    it('neutral 输入不报错', async () => {
      const r = await classifyEmotion('zzzzz');
      expect(r.type).toBe('neutral');
      expect(r.intensity).toBe(0);
    });

    it('debug 模式输出完整判定链路', async () => {
      const r = await classifyEmotion('我不喜欢你', { semanticMode: 'off', debug: true });
      expect(r.clauses.length).toBeGreaterThan(0);
      expect(r.trace).toBeDefined();
      expect(r.trace.rule).toBeDefined();
      expect(r.trace.decision).toBeTruthy();
    });
  });
});
