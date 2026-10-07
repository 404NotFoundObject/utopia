import { describe, it, expect } from 'vitest';
import {
  getModelContextWindow,
  estimateTokens,
  estimateMessagesTokens,
  computeBudget,
  getDefaultTokenBudgetSettings,
  getWorldBookBudgetRatio,
  systemMsg,
  PRIORITY,
  truncateMemoryEntries,
} from '../../../js/modules/tokenBudget.js';

describe('modules/tokenBudget', () => {
  describe('getModelContextWindow', () => {
    it('识别 OpenAI 系列', () => {
      expect(getModelContextWindow('gpt-4o')).toBe(128000);
      expect(getModelContextWindow('gpt-4o-mini')).toBe(128000);
      expect(getModelContextWindow('gpt-4-turbo')).toBe(128000);
      expect(getModelContextWindow('gpt-4')).toBe(8192);
      expect(getModelContextWindow('gpt-3.5-turbo')).toBe(16385);
    });

    it('识别 Anthropic 与 Google 系列', () => {
      expect(getModelContextWindow('claude-4-sonnet')).toBe(200000);
      expect(getModelContextWindow('claude-3-5-sonnet')).toBe(200000);
      expect(getModelContextWindow('gemini-1.5-pro')).toBe(2000000);
      expect(getModelContextWindow('gemini-2.0-flash')).toBe(1000000);
    });

    it('识别国产与开源模型', () => {
      expect(getModelContextWindow('deepseek-chat')).toBe(64000);
      expect(getModelContextWindow('qwen2.5-72b')).toBe(131072);
      expect(getModelContextWindow('qwen-turbo')).toBe(32000);
    });

    it('大小写不敏感', () => {
      expect(getModelContextWindow('GPT-4O')).toBe(128000);
      expect(getModelContextWindow('Claude-4-Opus')).toBe(200000);
    });

    it('gpt-4o 优先于 gpt-4 命中更具体的规则', () => {
      // 规则表按顺序匹配，gpt-4o 排在 gpt-4 之前
      expect(getModelContextWindow('gpt-4o')).toBe(128000);
      expect(getModelContextWindow('gpt-4')).toBe(8192);
    });

    it('未知模型回退到 8192', () => {
      expect(getModelContextWindow('some-unknown-model')).toBe(8192);
    });

    it('空值与 falsy 输入回退到 8192', () => {
      expect(getModelContextWindow('')).toBe(8192);
      expect(getModelContextWindow(null)).toBe(8192);
      expect(getModelContextWindow(undefined)).toBe(8192);
    });
  });

  describe('estimateTokens', () => {
    it('空值与非字符串返回 0', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens(undefined)).toBe(0);
      expect(estimateTokens(123)).toBe(0);
      expect(estimateTokens({})).toBe(0);
    });

    it('中文字符按 1.5 字符/token 估算', () => {
      // 2 个汉字 → (2 / 1.5) * 1.1 = 1.4667 → 向上取整 2
      expect(estimateTokens('你好')).toBe(2);
    });

    it('英文按 4 字符/token 估算', () => {
      // 5 个 ASCII → (5 / 4) * 1.1 = 1.375 → 2
      expect(estimateTokens('hello')).toBe(2);
    });

    it('长英文文本估算结果随长度单调增长', () => {
      const short = estimateTokens('a'.repeat(40));
      const long = estimateTokens('a'.repeat(400));
      expect(long).toBeGreaterThan(short);
    });

    it('中英混排按各自系数分别计算', () => {
      const mixed = estimateTokens('你好hello');
      expect(mixed).toBeGreaterThanOrEqual(estimateTokens('你好'));
      expect(mixed).toBeGreaterThanOrEqual(estimateTokens('hello'));
    });

    it('结果总是整数', () => {
      expect(Number.isInteger(estimateTokens('任意长度的一段文字 abcdef'))).toBe(true);
    });
  });

  describe('estimateMessagesTokens', () => {
    it('非数组返回 0', () => {
      expect(estimateMessagesTokens(null)).toBe(0);
      expect(estimateMessagesTokens({})).toBe(0);
    });

    it('空数组返回 0', () => {
      expect(estimateMessagesTokens([])).toBe(0);
    });

    it('每条消息固定计入 4 token 的结构开销', () => {
      const withContent = estimateMessagesTokens([{ role: 'user', content: '' }]);
      expect(withContent).toBe(4);
    });

    it('消息内容 token 会累加', () => {
      const one = estimateMessagesTokens([{ role: 'user', content: 'hello' }]);
      const two = estimateMessagesTokens([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hello' },
      ]);
      expect(two).toBeGreaterThan(one);
      expect(two - one).toBe(one);
    });

    it('content 非字符串时只计结构开销', () => {
      expect(estimateMessagesTokens([{ role: 'user', content: 123 }])).toBe(4);
    });
  });

  describe('PRIORITY', () => {
    it('包含关键优先级标签', () => {
      expect(PRIORITY.IDENTITY).toBe(100);
      expect(PRIORITY.WORLDBOOK).toBe(50);
      expect(PRIORITY.SUMMARY).toBe(35);
    });

    it('身份优先级高于世界书与摘要', () => {
      expect(PRIORITY.IDENTITY).toBeGreaterThan(PRIORITY.WORLDBOOK);
      expect(PRIORITY.WORLDBOOK).toBeGreaterThan(PRIORITY.SUMMARY);
    });

    it('全部优先级落在 0-100 区间', () => {
      for (const [key, value] of Object.entries(PRIORITY)) {
        expect(value, `${key} 应在 0-100`).toBeGreaterThanOrEqual(0);
        expect(value, `${key} 应在 0-100`).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('getDefaultTokenBudgetSettings', () => {
    it('返回默认配置结构', () => {
      const cfg = getDefaultTokenBudgetSettings();
      expect(cfg.enabled).toBe(true);
      expect(cfg.contextWindowMode).toBe('auto');
      expect(cfg.reserveForGeneration).toBe(1024);
      expect(cfg.strategy).toBe('drop_lowest');
    });

    it('配额比例之和为 1', () => {
      const { allocation } = getDefaultTokenBudgetSettings();
      const sum = allocation.system + allocation.history + allocation.memory + allocation.summary;
      expect(sum).toBeCloseTo(1, 10);
    });

    it('每次调用返回新对象，避免调用方互相污染', () => {
      const a = getDefaultTokenBudgetSettings();
      const b = getDefaultTokenBudgetSettings();
      a.allocation.system = 999;
      expect(b.allocation.system).toBe(0.4);
    });
  });

  describe('computeBudget', () => {
    it('auto 模式按模型窗口计算预算', () => {
      const budget = computeBudget('gpt-4o');
      expect(budget.contextWindow).toBe(128000);
      expect(budget.reserved).toBe(1024);
      expect(budget.available).toBe(128000 - 1024);
    });

    it('配额拆分结果与比例一致', () => {
      const budget = computeBudget('gpt-4o');
      const available = budget.available;
      expect(budget.breakdown.system).toBe(Math.floor(available * 0.4));
      expect(budget.breakdown.history).toBe(Math.floor(available * 0.4));
      expect(budget.breakdown.memory).toBe(Math.floor(available * 0.1));
      expect(budget.breakdown.summary).toBe(Math.floor(available * 0.1));
    });

    it('未知模型按 8192 窗口计算', () => {
      expect(computeBudget('unknown-model').contextWindow).toBe(8192);
    });

    it('窗口小于预留量时可用额度归零而非负数', () => {
      const budget = computeBudget('unknown-model');
      expect(budget.available).toBeGreaterThanOrEqual(0);
    });

    it('返回值携带生效配置，便于 /inspect 展示', () => {
      expect(computeBudget('gpt-4o').config.strategy).toBe('drop_lowest');
    });
  });

  describe('getWorldBookBudgetRatio', () => {
    it('未配置 settings 时返回默认值 0.3', () => {
      expect(getWorldBookBudgetRatio()).toBe(0.3);
    });
  });

  describe('systemMsg', () => {
    it('构造标准 system 消息结构', () => {
      const msg = systemMsg('内容是文本', 'myTag');
      expect(msg).toEqual({
        role: 'system',
        content: '内容是文本',
        tag: 'myTag',
        priority: PRIORITY.WORLDBOOK,
      });
    });

    it('允许显式指定优先级', () => {
      expect(systemMsg('x', 't', PRIORITY.IDENTITY).priority).toBe(100);
    });
  });

  describe('truncateMemoryEntries', () => {
    const header = '【长期记忆】以下是您之前与我的相关对话片段，供参考：';
    const entry = (i) => `[${i}] 您曾问："问题${i}"\n我回答："回答${i}"`;

    it('预算充足时原样返回', () => {
      const text = `${header}\n${entry(1)}\n${entry(2)}`;
      expect(truncateMemoryEntries(text, 10000)).toBe(text);
    });

    it('超预算时保留头部说明与靠前条目，丢弃靠后条目', () => {
      const text = `${header}\n${entry(1)}\n${entry(2)}\n${entry(3)}\n${entry(4)}\n${entry(5)}`;
      // 精确预算：头部 + [1] 完整两条 + [2] 的两条，刚好容不下 [3]
      const budget =
        estimateTokens(header) +
        estimateTokens('[1] 您曾问："问题1"') +
        estimateTokens('我回答："回答1"') +
        estimateTokens('[2] 您曾问："问题2"') +
        estimateTokens('我回答："回答2"');
      const result = truncateMemoryEntries(text, budget);

      expect(result).toContain(header);
      expect(result).toContain('[1]');
      expect(result).toContain('[2]');
      expect(result).not.toContain('[3]');
    });

    it('条目跨多行时不被切一半', () => {
      const text = `${header}\n${entry(1)}\n${entry(2)}\n${entry(3)}`;
      // 预算：头部 + 条目 1 完整（问+答），再加条目 2 的「问」行——
      // 刚好容不下条目 2 的「答」行。
      const budget =
        estimateTokens(header) +
        estimateTokens('[1] 您曾问："问题1"') +
        estimateTokens('我回答："回答1"') +
        estimateTokens('[2] 您曾问："问题2"');
      const result = truncateMemoryEntries(text, budget);

      // 条目 1 完整保留（含回答）
      expect(result).toContain('[1] 您曾问："问题1"');
      expect(result).toContain('我回答："回答1"');
      // 关键：条目 2 放不下就必须整条丢弃，不能只留「只有问没有答」的悬空片段
      expect(result).not.toContain('[2]');
      expect(result).not.toContain('回答2');
    });

    it('预算极小时退化为 token 级截断而非返回空串', () => {
      const text = `${header}\n${entry(1)}`;
      const result = truncateMemoryEntries(text, 10);
      expect(result.length).toBeGreaterThan(0);
    });

    it('空串安全返回', () => {
      expect(truncateMemoryEntries('', 100)).toBe('');
    });
  });
});
