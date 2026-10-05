import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `/status 字段 值` 的命令接线测试。
 *
 * 单测（statusFields.test.js）已覆盖纯计算；这里补「命令 → 写库」这一段，
 * 确认参数解析、分支路由、以及交给 updateCharacter 的 patch 是对的。
 * 只 mock 状态源与写库，其余走真实实现。
 */

const character = {
  id: 'c1',
  name: '小测试',
  emotionState: {
    valence: 10,
    arousal: 0,
    dominance: 0,
    affection: 20,
    trust: 5,
    intimacy: 5,
    energy: 0,
    needs: { safety: 70, esteem: 60, belonging: 50, autonomy: 50, pleasure: 50 },
    lastUpdate: 1,
  },
  bodyState: {
    energy: 80,
    sleepiness: 30,
    health: 95,
    illness: { type: null, severity: 0 },
    injury: { type: null, severity: 0 },
    lastUpdate: 2,
  },
};

const updateCharacter = vi.fn(async (id, patch) => ({ ...character, ...patch }));

vi.mock('../../js/modules/character.js', () => ({
  getCurrentCharacter: () => character,
  updateCharacter: (...args) => updateCharacter(...args),
  // commandEngine 还从该模块导入其它函数，补最小 stub
  getCharacters: async () => [character],
}));

vi.mock('../../js/core/state.js', () => ({
  getAppState: () => ({
    get: (key) => (key === 'currentMode' ? 'chat' : null),
    set: () => {},
  }),
}));

// vi.mock 会被提升到文件顶部，静态 import 同样命中 mock，无需动态导入
import { executeCommand } from '../../js/modules/commandEngine.js';

beforeEach(() => {
  updateCharacter.mockClear();
});

describe('/status 写入分支', () => {
  it('设绝对值：写回的 patch 是完整子对象且值正确', async () => {
    const res = await executeCommand('/status health 90', {});
    expect(res.result.console).toContain('90');
    expect(updateCharacter).toHaveBeenCalledTimes(1);

    const [id, patch] = updateCharacter.mock.calls[0];
    expect(id).toBe('c1');
    expect(patch.bodyState.health).toBe(90);
    // 深合并：兄弟字段必须在，否则整个 bodyState 会被冲掉
    expect(patch.bodyState.energy).toBe(80);
    expect(patch.bodyState.illness).toEqual({ type: null, severity: 0 });
    expect(patch.emotionState).toBeUndefined();
  });

  it('相对增减：+5 走相对计算', async () => {
    await executeCommand('/status health +5', {});
    const [, patch] = updateCharacter.mock.calls[0];
    expect(patch.bodyState.health).toBe(100); // 95 + 5
  });

  it('情感字段写 emotionState，不动 bodyState', async () => {
    await executeCommand('/status affection 66', {});
    const [, patch] = updateCharacter.mock.calls[0];
    expect(patch.emotionState.affection).toBe(66);
    expect(patch.emotionState.valence).toBe(10);
    expect(patch.bodyState).toBeUndefined();
  });

  it('同名消歧：裸名 energy 改体力，emotion.energy 改情感能量', async () => {
    await executeCommand('/status energy 50', {});
    expect(updateCharacter.mock.calls[0][1].bodyState.energy).toBe(50);

    updateCharacter.mockClear();
    await executeCommand('/status emotion.energy -20', {});
    const [, patch] = updateCharacter.mock.calls[0];
    expect(patch.emotionState.energy).toBe(-20);
    expect(patch.bodyState).toBeUndefined();
  });

  it('未知字段报错且不写库', async () => {
    const res = await executeCommand('/status lastUpdate 123', {});
    expect(res.result.console).toContain('未知字段');
    expect(updateCharacter).not.toHaveBeenCalled();
  });

  it('只给字段不给值：显示当前值与用法，不写库', async () => {
    const res = await executeCommand('/status health', {});
    expect(res.result.console).toContain('95');
    expect(res.result.console).toContain('用法');
    expect(updateCharacter).not.toHaveBeenCalled();
  });

  it('非数值报错且不写库', async () => {
    const res = await executeCommand('/status health abc', {});
    expect(res.result.consoleType).toBe('error');
    expect(updateCharacter).not.toHaveBeenCalled();
  });

  it('/status fields 列出可改字段', async () => {
    const res = await executeCommand('/status fields', {});
    expect(res.result.console).toContain('health');
    expect(res.result.console).toContain('affection');
    expect(res.result.console).toContain('safety');
    expect(updateCharacter).not.toHaveBeenCalled();
  });

  it('不带参数仍是查看（不触发写入）', async () => {
    const res = await executeCommand('/status', {});
    expect(res.result.console).toContain('小测试');
    expect(updateCharacter).not.toHaveBeenCalled();
  });
});
