// 复现测试：跨天感知 / 场景转场 在"时间间隙"下的真实行为
// 目的：用证据定格用户报告的"跨天不中断、1 小时也续话题"现象。
// 通过 vi.mock 控制 getGameTime，避免加载整个 time.js 依赖图。
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 可控的游戏时间（毫秒）。测试用例覆盖：凌晨消息 → 不同时长的间隔
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
const { decideTransition } = await import('../../../js/modules/transitionDecider.js');

// 一天内的"凌晨"锚点（游戏时间）：1 月 1 日 00:30
const MIDNIGHT = new Date(2026, 0, 1, 0, 30, 0).getTime();
const HOUR = 3600 * 1000;
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

describe('跨天感知 / 转场 行为复现', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('场景A：凌晨聊天，1 小时后回来 —— 应有轻量"回来"提示（活人感），而非纯续话题', async () => {
    GAME_NOW = MIDNIGHT + 1 * HOUR; // +1h
    const conv = makeConv('好呀，我也想去走走。');
    const phase = getConversationPhase(conv);
    const prompt = buildCrossDayPrompt(conv, character, { scene: 'chat' });
    // eslint-disable-next-line no-console
    console.log('[A phase]', phase.phase, 'hoursSince=', phase.hoursSince.toFixed(2));
    console.log('[A crossDayPrompt]', JSON.stringify(prompt));
    // 修复后：>=30 分钟的间隔应给出"回来/招呼"轻量提示，不再为空
    expect(phase.phase).toBe('active');
    expect(prompt).not.toBe('');
    expect(prompt).toMatch(/回来|招呼|忙什么/);
    const t = await decideTransition(conv, '今天天气真好');
    expect(t.strategy).toBe('none');
  });

  it('场景B：凌晨聊天，次日早上回来 —— 跨天应"新开场"，不再指令"自然接续"', async () => {
    GAME_NOW = new Date(2026, 0, 1, 9, 0, 0).getTime(); // 同日早上 9 点（+8.5h，<24h，同日）
    let conv = makeConv('好呀，我也想去走走。');
    let prompt = buildCrossDayPrompt(conv, character, { scene: 'chat' });
    console.log('[B-同日早上 prompt]', JSON.stringify(prompt));
    // 同日长时间间隔（~8.5h）：应提示"新的对话开场"，而非"自然接续"
    expect(prompt).not.toBe('');
    expect(prompt).toMatch(/新的对话开场|不必硬接|开启新话题/);

    // 真正的跨天：次日早上
    GAME_NOW = new Date(2026, 0, 2, 9, 0, 0).getTime(); // 1 月 2 日 09:00（+约32.5h）
    conv = makeConv('好呀，我也想去走走。');
    const r = analyzeCrossDay(conv, character, { scene: 'chat' });
    console.log('[B-次日 phase]', r.phase, 'days=', r.days, 'isCrossDay=', r.isCrossDay);
    console.log('[B-次日 prompt]', JSON.stringify(r.prompt));
    // 修复后：跨天触发且指令"新开场"，旧的"自然接续"措辞应消失
    expect(r.isCrossDay).toBe(true);
    expect(r.prompt).not.toContain('自然接续');
    expect(r.prompt).toMatch(/新的对话开场|不必硬接|开启新话题|跨天/);
    // 转场依然 none（闲聊无 scene，属预期；转场增强见后续）
    const t = await decideTransition(conv, '早啊');
    expect(t.strategy).toBe('none');
  });

  it('场景C：最后一句是用户半截话（未完成）跨天 —— 应提示"话说到一半"', async () => {
    GAME_NOW = new Date(2026, 0, 2, 9, 0, 0).getTime();
    const conv = makeConv('对了我想跟你说一件', 'user'); // 以省略号/未完成结尾
    const r = analyzeCrossDay(conv, character, { scene: 'chat' });
    console.log('[C prompt]', JSON.stringify(r.prompt));
    // 这条分支是对的（interrupted），仅用于对照：用户半截话会提示补完
    expect(r.prompt).toContain('说到一半');
  });
});
