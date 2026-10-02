/**
 * 朋友圈调度持久化（审计 A-3）。
 *
 * 原缺陷：_writeSchedule 用 time_state.add(schedule)（无主键），而 time_state
 * 的 keyPath 是 'id'，add 不注入主键 → DataError 被 catch 吞掉 → get('social_schedule')
 * 永远 undefined → 关标签页丢调度。
 *
 * 本测试验证：publishPostByUser 触发调度后，调度能真正写入并读回。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getStores } from '../../js/core/db.js';
import { getAppState } from '../../js/core/state.js';
import { publishPostByUser, checkAutoPost } from '../../js/modules/social.js';

describe('modules/social · 调度持久化（A-3）', () => {
  beforeEach(async () => {
    getAppState().set('settings', {});
  });

  it('发布动态后调度任务被写入 time_state 并能读回', async () => {
    const post = await publishPostByUser({ name: '用户' }, '今天天气不错');

    // scheduleSocialTask 内部是 _readSchedule().then(...) 异步链，等待其完成
    await new Promise(r => setTimeout(r, 50));

    const { time_state } = await getStores();
    const schedule = await time_state.get('social_schedule');

    expect(schedule).toBeDefined();
    expect(Array.isArray(schedule.tasks)).toBe(true);
    // 至少包含一条针对该动态的 generateComments 任务
    const related = schedule.tasks.filter(t => t.type === 'generateComments' && t.payload.postId === post.id);
    expect(related.length).toBeGreaterThan(0);
  });
});

describe('modules/social · 自动发帖全局每日上限（B-4）', () => {
  it('多角色场景下全局当日发帖总数不超过 maxPerDay', async () => {
    // 关闭随机性：概率恒 1，确保每个符合条件的角色都会尝试发帖
    getAppState().set('settings', {
      social: {
        enabled: true,
        maxPostsPerDay: 2,
        maxPostsPerCharacter: 10,
        autoPostProbability: 1,
      },
    });

    // 预置 4 个角色（各自都能触发发帖），用唯一 ID 避免与其它用例污染
    const stores = await getStores();
    const uniq = `b4-${Date.now()}-`;
    const fullEmotion = {
      valence: 0, arousal: 0, dominance: 0, attention: 0, surprise: 0, energy: 0,
      needs: { safety: 70, esteem: 60, belonging: 50, autonomy: 50, pleasure: 50 },
      affection: 0, trust: 0, intimacy: 0, lastUpdate: 0,
    };
    const characters = [
      { id: `${uniq}1`, name: 'A', emotionState: { ...fullEmotion } },
      { id: `${uniq}2`, name: 'B', emotionState: { ...fullEmotion } },
      { id: `${uniq}3`, name: 'C', emotionState: { ...fullEmotion } },
      { id: `${uniq}4`, name: 'D', emotionState: { ...fullEmotion } },
    ];
    for (const c of characters) await stores.characters.add(c);

    // 拦截 AI 生成，避免真实网络请求（publishPostByCharacter 内部会调 generatePostContent）
    const api = await import('../../js/core/api.js');
    const genSpy = vi.spyOn(api, 'sendChatRequest').mockResolvedValue({ content: '测试动态内容' });

    // 把游戏时间固定在白天（6-22 点之间），避免夜间跳过
    const time = await import('../../js/modules/time.js');
    vi.spyOn(time, 'getGameTime').mockReturnValue(new Date('2026-10-02T10:00:00').getTime());

    await checkAutoPost();

    // 全局上限 2：即使 4 个角色都可发帖，最终帖子数也不得超过 2
    const posts = await stores.posts.getAll();
    const charPosts = posts.filter(p => p.authorType === 'character' && p.authorId.startsWith(uniq));
    expect(charPosts.length).toBeLessThanOrEqual(2);

    genSpy.mockRestore();
  });
});
