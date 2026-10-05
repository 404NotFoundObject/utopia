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
import { publishPostByUser, checkAutoPost, userCommentPost, getAllPosts, generateReplyForComment, togglePostLike } from '../../js/modules/social.js';

// AI 回复路径会调用身体描述与情绪标签，隔离其副作用（写库/依赖完整角色结构）
vi.mock('../../js/modules/bodyState.js', () => ({
  getBodyDescription: vi.fn(() => '状态良好'),
}));
vi.mock('../../js/modules/emotionEngine.js', () => ({
  getEmotionLabel: vi.fn(() => '平静'),
  handleInteraction: vi.fn(async () => {}),
}));

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

describe('modules/social · 用户回复自己帖子下的角色评论', () => {
  it('回复内容必须落库（旧实现被帖子作者早退静默丢弃）', async () => {
    const stores = await getStores();
    const uniq = `reply-${Date.now()}-`;

    // 1. 用户发一条帖子（authorType='user'，authorId='user'）
    const post = await publishPostByUser({ name: '用户' }, '我的动态');

    // 2. 手动塞入一条角色评论（模拟角色已评论）
    const charId = `${uniq}char`;
    await stores.characters.add({ id: charId, name: '小樱', emotionState: null });
    post.comments.push({
      id: `${uniq}comment`,
      authorType: 'character',
      authorId: charId,
      content: '好棒！',
      timestamp: Date.now(),
      replyTo: null,
      replies: [],
    });
    await stores.posts.update(post.id, post);

    // 3. 用户回复这条角色评论
    await userCommentPost(post.id, '谢谢夸奖！', `${uniq}comment`);

    // 4. 关键断言：回复必须真的写进库里
    const fresh = await stores.posts.get(post.id);
    const comment = fresh.comments.find(c => c.id === `${uniq}comment`);
    expect(comment.replies).toBeDefined();
    const userReply = comment.replies.find(r => r.authorType === 'user');
    expect(userReply).toBeDefined();
    expect(userReply.content).toBe('谢谢夸奖！');

    // 5. 并且应调度「该评论的角色作者」接话（payload 带 replierId）
    await new Promise(r => setTimeout(r, 50));
    const { time_state } = await getStores();
    const schedule = await time_state.get('social_schedule');
    const replyTask = (schedule?.tasks || []).find(
      t => t.type === 'generateReply' && t.payload?.commentId === `${uniq}comment`
    );
    expect(replyTask).toBeDefined();
    expect(replyTask.payload.replierId).toBe(charId);

    await stores.posts.delete(post.id);
  });
});

describe('modules/social · 多轮对话（回复链路修复）', () => {
  function makeEmotion() {
    return {
      valence: 0, arousal: 0, dominance: 0, attention: 0, surprise: 0, energy: 0,
      needs: {}, affection: 0, trust: 0, intimacy: 0, lastUpdate: 0,
    };
  }

  it('角色已回复过后，用户再次回复仍能触发该角色接话（旧守卫掐断后续轮次）', async () => {
    const stores = await getStores();
    const uniq = `chain-${Date.now()}-`;
    const charId = `${uniq}char`;
    await stores.characters.add({ id: charId, name: '小樱', emotionState: makeEmotion() });

    const post = await publishPostByUser({ name: '用户' }, '我的动态');
    post.comments.push({
      id: `${uniq}comment`,
      authorType: 'character',
      authorId: charId,
      content: '好棒！',
      timestamp: Date.now(),
      replies: [],
    });
    await stores.posts.update(post.id, post);

    const api = await import('../../js/core/api.js');
    const genSpy = vi.spyOn(api, 'sendChatRequest').mockResolvedValue({ content: '第二次回复' });

    // 第一轮：评论下已有一条角色回复（模拟上一轮接话完成）
    const fresh1 = await stores.posts.get(post.id);
    fresh1.comments[0].replies.push({
      id: `${uniq}r1`, authorType: 'character', authorId: charId,
      content: '第一轮回复', timestamp: Date.now(),
    });
    await stores.posts.update(post.id, fresh1);

    // 第二轮：用户再回复 → 模拟调度执行 generateReplyForComment（replierId 显式指定）
    await userCommentPost(post.id, '再说一句', `${uniq}comment`);
    await generateReplyForComment(post.id, `${uniq}comment`, null, 2, charId);

    const fresh2 = await stores.posts.get(post.id);
    const charReplies = fresh2.comments[0].replies.filter(r => r.authorType === 'character');
    // 关键断言：角色必须回复了第二次（旧实现被 hasCharacterReply 守卫直接 return）
    expect(charReplies.length).toBeGreaterThanOrEqual(2);
    // 且角色回复带「回复对象=用户」字段，供 UI 展示 "A 回复 B"
    const lastReply = charReplies[charReplies.length - 1];
    expect(lastReply.replyToAuthorType).toBe('user');
    expect(lastReply.replyToAuthorId).toBe('user');

    genSpy.mockRestore();
    await stores.posts.delete(post.id);
  });

  it('用户「回复某条回复」：落库带回复对象，并由该回复的角色作者接话', async () => {
    const stores = await getStores();
    const uniq = `r2r-${Date.now()}-`;
    const charA = `${uniq}a`;
    await stores.characters.add({ id: charA, name: '阿A', emotionState: makeEmotion() });

    const post = await publishPostByUser({ name: '用户' }, '我的动态');
    post.comments.push({
      id: `${uniq}comment`,
      authorType: 'character',
      authorId: charA,
      content: '评论区',
      timestamp: Date.now(),
      replies: [{
        id: `${uniq}reply`,
        authorType: 'character',
        authorId: charA,
        content: '我是回复',
        timestamp: Date.now(),
      }],
    });
    await stores.posts.update(post.id, post);

    // 用户回复「某条回复」（第 4 参为 replyToReplyId）
    await userCommentPost(post.id, '专门回复这条', `${uniq}comment`, `${uniq}reply`);

    const fresh = await stores.posts.get(post.id);
    const userReply = fresh.comments[0].replies.find(r => r.authorType === 'user');
    expect(userReply).toBeDefined();
    expect(userReply.replyToAuthorType).toBe('character');
    expect(userReply.replyToAuthorId).toBe(charA);

    // 调度任务由「被回复的角色」接话
    await new Promise(r => setTimeout(r, 50));
    const { time_state } = await getStores();
    const schedule = await time_state.get('social_schedule');
    const task = (schedule?.tasks || []).find(
      t => t.type === 'generateReply' && t.payload?.commentId === `${uniq}comment` && t.payload?.replyToReplyId === `${uniq}reply`
    );
    expect(task).toBeDefined();
    expect(task.payload.replierId).toBe(charA);

    await stores.posts.delete(post.id);
  });
});

describe('modules/social · 用户点赞 togglePostLike', () => {
  it('点赞/取消点赞正确切换且持久化', async () => {
    const stores = await getStores();
    const post = await publishPostByUser({ name: '用户' }, '点赞测试');

    const liked = await togglePostLike(post.id);
    expect(liked).toBe(true);
    let fresh = await stores.posts.get(post.id);
    expect(fresh.likes.filter(l => l.authorType === 'user').length).toBe(1);

    const unliked = await togglePostLike(post.id);
    expect(unliked).toBe(false);
    fresh = await stores.posts.get(post.id);
    expect(fresh.likes.filter(l => l.authorType === 'user').length).toBe(0);

    await stores.posts.delete(post.id);
  });
});

describe('modules/social · 生成失败不落机械兜底文案', () => {
  it('generateComment：AI 失败返回 null，不再返回「哈哈哈，有趣！」', async () => {
    const api = await import('../../js/core/api.js');
    const spy = vi.spyOn(api, 'sendChatRequest').mockRejectedValue(new Error('API down'));
    const { generateComment } = await import('../../js/modules/social.js');

    const char = { id: `gc-${Date.now()}`, name: '评论角色', emotionState: {}, bodyState: {} };
    const result = await generateComment(char, { authorType: 'user', authorId: 'user', content: '一条动态' });

    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2); // 重试 2 次后放弃
    spy.mockRestore();
  });

  it('publishPostByCharacter：生成失败返回 null 且不写库', async () => {
    const api = await import('../../js/core/api.js');
    const spy = vi.spyOn(api, 'sendChatRequest').mockRejectedValue(new Error('API down'));
    const stores = await getStores();
    const uniq = `fb-${Date.now()}`;
    await stores.characters.add({ id: uniq, name: '发帖角色', emotionState: {} });
    const char = await stores.characters.get(uniq);

    const { publishPostByCharacter } = await import('../../js/modules/social.js');
    const result = await publishPostByCharacter(char);

    expect(result).toBeNull();
    const posts = await stores.posts.getAll();
    expect(posts.filter(p => p.authorId === uniq)).toHaveLength(0);
    spy.mockRestore();
  });

  it('generateComment：AI 返回空内容也返回 null（空串与空白不落库）', async () => {
    const api = await import('../../js/core/api.js');
    const spy = vi.spyOn(api, 'sendChatRequest').mockResolvedValue({ content: '   ' });
    const { generateComment } = await import('../../js/modules/social.js');

    const char = { id: `ge-${Date.now()}`, name: '空回复角色', emotionState: {}, bodyState: {} };
    const result = await generateComment(char, { authorType: 'user', authorId: 'user', content: '一条动态' });

    expect(result).toBeNull();
    spy.mockRestore();
  });
});
