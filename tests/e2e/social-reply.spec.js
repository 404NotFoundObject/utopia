import { test, expect } from '@playwright/test';

/**
 * 朋友圈回复链路（端到端）。
 *
 * 守住三个曾在实机反馈中出问题的行为：
 *   1. 用户回复角色评论后，「回复对象名称」必须出现在回复行（A 回复 B: 内容）
 *   2. 回复必须真正落库，并带上 replyToAuthorType / replyToAuthorId
 *   3. 必须调度角色接话任务（此前 hasCharacterReply 守卫会把后续接话全部掐断，
 *      表现为「角色只肯回一次」）
 *
 * 数据直接注入 IndexedDB，绕过 AI 生成（评论由角色发起需要真实 API），
 * 只验证「用户侧交互 → 落库 → 调度」这条确定性链路。
 */

const CHAR_ID = 'e2e-social-char';
const POST_ID = 'e2e-social-post';
const COMMENT_ID = 'e2e-social-comment';

/** 注入一个角色 + 一条用户帖子 + 一条角色评论 */
async function seedData(page) {
  await page.evaluate(async ({ charId, postId, commentId }) => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('UtopiaDB');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const put = (store, obj) => new Promise((res, rej) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).put(obj);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });

    const now = Date.now();
    await put('characters', {
      id: charId,
      name: '林晚',
      avatar: '',
      description: '深夜电台主播',
      personality: '温柔',
      createdAt: now,
      updatedAt: now,
      emotionState: { affection: 50, trust: 50 },
      bodyState: { energy: 70, sleepiness: 20, health: 90, sleepStatus: '清醒' },
    });

    await put('posts', {
      id: postId,
      authorType: 'user',
      authorId: 'user',
      content: '今天心情不错，出来走走。',
      images: [],
      likes: [],
      timestamp: now - 3600_000,
      comments: [{
        id: commentId,
        authorType: 'character',
        authorId: charId,
        content: '去哪儿玩啦？',
        timestamp: now - 1800_000,
        replies: [],
      }],
    });
  }, { charId: CHAR_ID, postId: POST_ID, commentId: COMMENT_ID });
}

test.describe('朋友圈回复链路', () => {
  test('用户回复角色评论：显示回复对象、落库带对象字段、并调度角色接话', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.__utopiaReady === true, null, { timeout: 30_000 });

    await seedData(page);
    // 重新加载让启动流程把注入的角色读进内存状态（渲染昵称需要）
    await page.reload();
    await page.waitForFunction(() => window.__utopiaReady === true, null, { timeout: 30_000 });

    // 打开朋友圈
    await page.locator('#socialBtn').click();
    const feed = page.locator('.social-feed');
    await expect(feed).toBeVisible();

    // 1) 帖子与评论按微信格式渲染：「昵称: 内容」，并与点赞行同处灰底容器
    await expect(feed.locator('.social-comment-row')).toContainText('林晚: 去哪儿玩啦？');
    await expect(feed.locator('.social-comment-bar')).toBeVisible();
    await expect(feed.locator('.social-more-btn')).toBeVisible();

    // 2) 点击评论行进入回复输入，占位提示回复对象
    await feed.locator('.social-comment-row').click();
    const input = page.locator('.social-comment-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', '回复 林晚');

    // 3) 发送回复
    await input.fill('就在附近转转，你呢？');
    await page.locator('.social-comment-send-btn').click();

    // 4) 界面显示「用户 回复 林晚: …」（回复对象名称）
    await expect(page.locator('.social-reply').first()).toContainText('用户 回复 林晚: 就在附近转转，你呢？');

    // 5) 落库字段正确 + 已调度角色接话
    const result = await page.evaluate(async ({ postId }) => {
      const db = await new Promise((res) => {
        const req = indexedDB.open('UtopiaDB');
        req.onsuccess = () => res(req.result);
      });
      const get = (store, key) => new Promise((res) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = () => res(req.result);
      });
      const post = await get('posts', postId);
      const schedule = await get('time_state', 'social_schedule');
      const reply = post?.comments?.[0]?.replies?.[0];
      return {
        reply: reply ? {
          authorType: reply.authorType,
          content: reply.content,
          replyToAuthorType: reply.replyToAuthorType,
          replyToAuthorId: reply.replyToAuthorId,
        } : null,
        replyTasks: (schedule?.tasks || [])
          .filter(t => t.type === 'generateReply' && t.payload?.postId === postId)
          .map(t => t.payload.replierId),
      };
    }, { postId: POST_ID });

    expect(result.reply, '回复未落库').not.toBeNull();
    expect(result.reply.authorType).toBe('user');
    expect(result.reply.content).toBe('就在附近转转，你呢？');
    expect(result.reply.replyToAuthorType).toBe('character');
    expect(result.reply.replyToAuthorId).toBe(CHAR_ID);
    expect(result.replyTasks, '未调度角色接话').toContain(CHAR_ID);
  });
});
