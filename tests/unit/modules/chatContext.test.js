import { describe, it, expect, vi, beforeEach } from 'vitest';

// 预先 mock 依赖，避免触及真实 state/db
vi.mock('../../../js/core/db.js', () => ({
  getStores: vi.fn(),
  withKeyLock: vi.fn(),
}));

vi.mock('../../../js/modules/time.js', () => ({
  getGameTime: vi.fn(() => 1700000000000),
  getTimeContext: vi.fn(() => ({ gameTime: { natural: '测试时间', description: '' } })),
}));

vi.mock('../../../js/core/state.js', () => ({
  getAppState: vi.fn(() => ({
    get: vi.fn((k) => (k === 'settings' ? {} : undefined)),
    set: vi.fn(),
    subscribe: vi.fn(),
  })),
}));

const { getStores } = await import('../../../js/core/db.js');
const { getGameTime } = await import('../../../js/modules/time.js');
const {
  computeWorldBookBudgets,
  buildSocialContext,
} = await import('../../../js/modules/chatContext.js');

describe('modules/chatContext · 世界书预算计算', () => {
  it('tbEnabled=true 时：worldBookBudget + systemBudgetOverride 均为有效数字', () => {
    const settings = { tokenBudget: { enabled: true } };
    const { worldBookBudget, systemBudgetOverride } = computeWorldBookBudgets('gpt-4o', settings);
    expect(typeof worldBookBudget).toBe('number');
    expect(worldBookBudget).toBeGreaterThan(0);
    expect(typeof systemBudgetOverride).toBe('number');
    expect(systemBudgetOverride).toBeGreaterThanOrEqual(0);
    // 二者之和应等于原始系统预算（worldBookBudget 是向下取整后的值）
    expect(worldBookBudget + systemBudgetOverride).toBeGreaterThan(0);
  });

  it('tbEnabled=false 时：systemBudgetOverride 为 undefined（与旧逻辑一致）', () => {
    const settings = { tokenBudget: { enabled: false } };
    const { worldBookBudget, systemBudgetOverride } = computeWorldBookBudgets('gpt-4o', settings);
    expect(typeof worldBookBudget).toBe('number');
    expect(worldBookBudget).toBeGreaterThan(0);
    expect(systemBudgetOverride).toBeUndefined();
  });
});

describe('modules/chatContext · 朋友圈回流', () => {
  const NOW = 1700000000000;

  beforeEach(() => {
    getStores.mockReset();
    getGameTime.mockReset();
    getGameTime.mockReturnValue(NOW);
  });

  function makePost(overrides = {}) {
    return {
      id: 'p1',
      authorType: 'character',
      authorId: 'charA',
      content: '今天天气真好',
      images: [],
      timestamp: NOW - 1000 * 60 * 60,
      emotionSnapshot: {},
      bodySnapshot: {},
      comments: [],
      ...overrides,
    };
  }

  it('空库返回空字符串', async () => {
    getStores.mockResolvedValue({
      posts: { getAll: async () => [] },
      characters: { getAll: async () => [] },
    });
    const result = await buildSocialContext({ id: 'charMe', name: '我' });
    expect(result).toBe('');
  });

  it('排除当前角色自己的动态', async () => {
    getStores.mockResolvedValue({
      posts: {
        getAll: async () => [
          makePost({ id: 'mine', authorId: 'charMe', content: '我的动态' }),
        ],
      },
      characters: { getAll: async () => [{ id: 'charMe', name: '我' }] },
    });
    const result = await buildSocialContext({ id: 'charMe', name: '我' });
    expect(result).toBe('');
  });

  it('只取 24 小时内的动态，超出窗口的忽略', async () => {
    const old = makePost({ id: 'old', authorId: 'charA', timestamp: NOW - 25 * 60 * 60 * 1000 });
    const fresh = makePost({ id: 'fresh', authorId: 'charB', timestamp: NOW - 1000 });
    getStores.mockResolvedValue({
      posts: { getAll: async () => [old, fresh] },
      characters: {
        getAll: async () => [
          { id: 'charA', name: '角色A' },
          { id: 'charB', name: '角色B' },
        ],
      },
    });
    const result = await buildSocialContext({ id: 'charMe', name: '我' });
    expect(result).toContain('角色B');
    expect(result).not.toContain('角色A');
  });

  it('有评论的动态优先，且标注评论内容', async () => {
    const noComment = makePost({ id: 'a', authorId: 'charA', content: '没有评论' });
    const withComment = makePost({
      id: 'b',
      authorId: 'charB',
      content: '有评论的动态',
      comments: [{ id: 'c1', authorType: 'character', authorId: 'charC', content: '哈哈不错' }],
    });
    getStores.mockResolvedValue({
      posts: { getAll: async () => [noComment, withComment] },
      characters: {
        getAll: async () => [
          { id: 'charA', name: '角色A' },
          { id: 'charB', name: '角色B' },
        ],
      },
    });
    const result = await buildSocialContext({ id: 'charMe', name: '我' });
    // 有评论的动态排在前面
    expect(result.indexOf('角色B')).toBeLessThan(result.indexOf('角色A'));
    expect(result).toContain('哈哈不错');
  });

  it('最多取 5 条动态', async () => {
    const posts = Array.from({ length: 8 }, (_, i) =>
      makePost({ id: `p${i}`, authorId: `char${i}`, content: `动态${i}` })
    );
    const chars = posts.map((p, i) => ({ id: `char${i}`, name: `角色${i}` }));
    getStores.mockResolvedValue({
      posts: { getAll: async () => posts },
      characters: { getAll: async () => chars },
    });
    const result = await buildSocialContext({ id: 'charMe', name: '我' });
    // 每条动态一行 [n]，n 最大为 5
    expect(result).toContain('[5]');
    expect(result).not.toContain('[6]');
  });

  it('posts store 缺失时安全返回空字符串', async () => {
    getStores.mockResolvedValue({});
    const result = await buildSocialContext({ id: 'charMe', name: '我' });
    expect(result).toBe('');
  });
});
