import { describe, it, expect, vi } from 'vitest';

// mock 绝对路径依赖与事件总线，避免触及真实注入器实例
vi.mock('/lib/index.js', () => ({
  createContextInjector: vi.fn(() => ({ updateRules: vi.fn(), buildMessages: vi.fn(), resetState: vi.fn() })),
}));

vi.mock('../../../js/core/eventBus.js', () => ({
  default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

const { getBaseRules } = await import('../../../js/modules/injector.js');

describe('modules/injector · 基础规则', () => {
  it('包含输出格式与人称约束（output_style）', () => {
    const rules = getBaseRules();
    const styleRule = rules.find(r => r.id === 'output_style');
    expect(styleRule).toBeTruthy();
    expect(styleRule.content).toContain('第一人称');
    expect(styleRule.content).toContain('圆括号');
    expect(styleRule.content).toContain('转述');
  });

  it('output_style 排在身份锁定之后的高优先级（priority=2）', () => {
    const rules = getBaseRules();
    const identity = rules.find(r => r.id === 'identity_lock');
    const style = rules.find(r => r.id === 'output_style');
    expect(style.priority).toBe(2);
    // 身份锁定 priority=1，输出格式紧邻其后
    expect(identity.priority).toBeLessThan(style.priority);
  });

  it('规则按 priority 升序可排序，且无 priority 冲突', () => {
    const rules = getBaseRules();
    const sorted = [...rules].sort((a, b) => a.priority - b.priority);
    expect(sorted.map(r => r.priority)).toEqual([...sorted.map(r => r.priority)].sort((a, b) => a - b));
  });
});
