// 集成测试：crossDayAwareness 接入 timePerception 后的"细腻时间感知"行为
// 验证：闲聊 / 无场景情况下，长间隔 / 跨天能给出
//   "过去多久 + 时段变换 + 时间变换后的正确反应（转场）"
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 可控游戏时间。沿用 crossDayRepro 的 mock 方式，避免加载整个 time.js 依赖图。
let GAME_NOW = Date.now();
vi.mock('../../../js/modules/time.js', () => ({
  getGameTime: () => GAME_NOW,
  getGameDate: () => new Date(GAME_NOW),
  getTimeSpeed: () => 1,
  isTimePaused: () => false,
  getPeriod: () => '深夜',
}));

const { buildCrossDayPrompt, analyzeCrossDay } = await import('../../../js/modules/crossDayAwareness.js');
const { getConversationPhase } = await import('../../../js/modules/conversationState.js');

const H = 3600 * 1000;
const DAY = 24 * H;
// 锚点：凌晨 00:30（深夜）
const MIDNIGHT = new Date(2026, 0, 1, 0, 30, 0).getTime();
const character = { id: 'c1', name: '小狐' };

function makeConv(lastContent, lastRole = 'assistant') {
  const ts = lastRole === 'assistant' ? MIDNIGHT + 1000 : MIDNIGHT;
  return {
    id: 'conv1',
    messages: [
      { role: 'user', content: '我们去散步吧', timestamp: MIDNIGHT - 1000 },
      { role: lastRole, content: lastContent, timestamp: ts },
    ],
    convState: undefined,
  };
}

describe('细腻时间感知 · 时段变换', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('深夜聊天 → 同日上午回来：应感知"从深夜到上午"的时段变换并新开场', async () => {
    // 同日上午 09:00（+8.5h，<24h，未跨天）
    GAME_NOW = new Date(2026, 0, 1, 9, 0, 0).getTime();
    const conv = makeConv('好呀，我也想去走走。');
    const phase = getConversationPhase(conv);
    const prompt = buildCrossDayPrompt(conv, character, { scene: 'chat' });
    console.log('[时段变换 prompt]', JSON.stringify(prompt));
    // 未跨天，按 SAME_DAY_LONG 处理
    expect(phase.phase).toBe('paused');
    // 时段变换被点出
    expect(prompt).toContain('深夜');
    expect(prompt).toContain('上午');
    // 新开场方向（关键词来自 buildTimeChangePrompt）
    expect(prompt).toMatch(/新的对话开场|不必硬接|开启新话题/);
    expect(prompt).not.toContain('自然接续');
  });

  it('深夜聊天 → 跨多天回来：应感知"好几天没见"', async () => {
    GAME_NOW = MIDNIGHT + 3 * DAY + 10 * H; // 3 天后上午
    const conv = makeConv('好呀，我也想去走走。');
    const r = analyzeCrossDay(conv, character, { scene: 'chat' });
    console.log('[跨多天 prompt]', JSON.stringify(r.prompt));
    expect(r.isCrossDay).toBe(true);
    expect(r.days).toBe(3);
    expect(r.prompt).toContain('好几天没见');
  });

  it('深夜聊天 → 很久没见（>6天）：应感知"好久不见"', async () => {
    GAME_NOW = MIDNIGHT + 10 * DAY;
    const conv = makeConv('好呀，我也想去走走。');
    const r = analyzeCrossDay(conv, character, { scene: 'chat' });
    console.log('[好久不见 prompt]', JSON.stringify(r.prompt));
    expect(r.days).toBe(10);
    expect(r.prompt).toContain('好久不见');
  });
});

describe('细腻时间感知 · ACTIVE 长间隔含时段', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('深夜聊天 → 1 小时后回来：ACTIVE 且带"回来"提示，并标注时段', async () => {
    GAME_NOW = MIDNIGHT + 1 * H; // +1h，仍在深夜
    const conv = makeConv('好呀，我也想去走走。');
    const phase = getConversationPhase(conv);
    const prompt = buildCrossDayPrompt(conv, character, { scene: 'chat' });
    console.log('[ACTIVE+1h prompt]', JSON.stringify(prompt));
    expect(phase.phase).toBe('active');
    expect(prompt).toMatch(/回来|招呼|忙什么/);
    // 精确到"过去多久"（分钟级）
    expect(prompt).toContain('分钟前');
  });

  it('傍晚聊天 → 同夜短间隔回来（1.5h）：时段从夜晚变深夜且仍是轻招呼', async () => {
    // 22:00 夜晚 → 23:30 深夜（同日内 1.5h）
    const from = new Date(2026, 0, 1, 22, 0, 0).getTime();
    GAME_NOW = new Date(2026, 0, 1, 23, 30, 0).getTime();
    const conv = {
      id: 'conv2',
      messages: [
        { role: 'user', content: '在干嘛', timestamp: from - 1000 },
        { role: 'assistant', content: '在看电影', timestamp: from },
      ],
      convState: undefined,
    };
    const phase = getConversationPhase(conv);
    const prompt = buildCrossDayPrompt(conv, character, { scene: 'chat' });
    console.log('[同夜变换 prompt]', JSON.stringify(prompt));
    expect(phase.phase).toBe('active');
    expect(prompt).toMatch(/回来|招呼|忙什么/);
    // 时段变换：夜晚 → 深夜
    expect(prompt).toContain('夜晚');
    expect(prompt).toContain('深夜');
  });
});

describe('细腻时间感知 · 群聊分支', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('群聊跨天：应点出"昨天哪段 + 现在哪段"并可切换语境', async () => {
    GAME_NOW = new Date(2026, 0, 2, 21, 0, 0).getTime(); // 次日夜晚
    const conv = {
      id: 'g1',
      messages: [
        { role: 'user', content: '晚安', timestamp: MIDNIGHT },
        { role: 'assistant', content: '晚安~', timestamp: MIDNIGHT + 1000 },
      ],
      convState: undefined,
    };
    const prompt = buildCrossDayPrompt(conv, character, { scene: 'group' });
    console.log('[群聊跨天 prompt]', JSON.stringify(prompt));
    expect(prompt).toContain('昨天');
    expect(prompt).toContain('深夜'); // fromPeriod
    expect(prompt).toContain('夜晚'); // toPeriod（现在 21:00）
  });
});
