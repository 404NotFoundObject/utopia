/**
 * 朋友圈调度持久化（审计 A-3）。
 *
 * 原缺陷：_writeSchedule 用 time_state.add(schedule)（无主键），而 time_state
 * 的 keyPath 是 'id'，add 不注入主键 → DataError 被 catch 吞掉 → get('social_schedule')
 * 永远 undefined → 关标签页丢调度。
 *
 * 本测试验证：publishPostByUser 触发调度后，调度能真正写入并读回。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getStores, deleteDatabase } from '../../js/core/db.js';
import { getAppState } from '../../js/core/state.js';
import { publishPostByUser } from '../../js/modules/social.js';

describe('modules/social · 调度持久化（A-3）', () => {
  beforeEach(async () => {
    await deleteDatabase();
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
