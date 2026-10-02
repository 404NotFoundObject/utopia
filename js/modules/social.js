// js/modules/social.js - 朋友圈核心逻辑
import { getStores, withKeyLock } from '../core/db.js';
import { generateUUID } from '../core/utils.js';
import { getAppState } from '../core/state.js';
import { getGameTime, getGameDate } from './time.js';
import { sendChatRequest } from '../core/api.js';
import { searchMemories } from './memory.js';
import { getEmotionLabel } from './emotionEngine.js';
import { getBodyDescription } from './bodyState.js';
import { buildPersonaSystemMessage } from './proactiveChat.js';

let _stores = null;
async function getS() {
  if (!_stores) _stores = await getStores();
  return _stores;
}

// ---------- 持久化调度（P2-5：评论/回复的延时任务不再依赖内存 setTimeout，关标签页可重建） ----------
const SOCIAL_SCHEDULE_KEY = 'social_schedule';

async function _readSchedule() {
  const stores = await getS();
  const raw = await stores.time_state.get(SOCIAL_SCHEDULE_KEY);
  return (raw && Array.isArray(raw.tasks)) ? raw : { tasks: [] };
}

async function _writeSchedule(schedule) {
  const stores = await getS();
  // time_state 的 keyPath 是 'id'，而 add() 不注入主键（store.add(data) 无 id 会抛 DataError）。
  // 统一用 update()（内部 put({...data, id}) 会正确写入主键），add/update 两种情形都覆盖。
  await stores.time_state.update(SOCIAL_SCHEDULE_KEY, { tasks: schedule.tasks });

  // 写后读回验证：调度持久化失败会表现为「关标签页丢调度」，必须显式上报而非静默吞掉。
  try {
    const readBack = await stores.time_state.get(SOCIAL_SCHEDULE_KEY);
    if (!readBack || !Array.isArray(readBack.tasks)) {
      console.warn('[Social] 调度写后读回异常：未读到 tasks 数组');
    }
  } catch (err) {
    console.warn('[Social] 调度写后读回验证失败:', err);
  }
}

async function _removeScheduleTask(taskId) {
  const schedule = await _readSchedule();
  schedule.tasks = schedule.tasks.filter(t => t.id !== taskId);
  await _writeSchedule(schedule);
}

/**
 * 调度一个社交延时任务（生成评论 / 生成回复）。任务先持久化到 time_state，
 * 再在内存里 setTimeout 执行；执行完成后从持久化表移除。这样即使关掉标签页，
 * 下次启动 rebuildSocialSchedule 也能捡回未完成的任务。
 */
function scheduleSocialTask(type, payload, delayMs) {
  const id = generateUUID();
  const dueAt = Date.now() + delayMs;
  _readSchedule().then((schedule) => {
    schedule.tasks.push({ id, type, payload, dueAt });
    return _writeSchedule(schedule);
  }).catch(err => console.warn('[Social] 持久化调度写入失败（降级为纯内存）:', err));

  const run = async () => {
    try {
      if (type === 'generateComments') {
        await generateCommentsForPost(payload.postId);
      } else if (type === 'generateReply') {
        await generateReplyForComment(payload.postId, payload.commentId);
      }
    } catch (err) {
      console.error('[Social] 调度任务执行失败:', err);
    } finally {
      _removeScheduleTask(id).catch(() => {});
    }
  };

  setTimeout(run, delayMs);
  return id;
}

/**
 * 启动时重建社交调度：捡回上次会话遗留的未完成延时任务。
 * 已到期的立即执行，未到期的按剩余时间补 setTimeout。
 */
export async function rebuildSocialSchedule() {
  const schedule = await _readSchedule().catch(() => ({ tasks: [] }));
  if (!schedule.tasks.length) return;
  const now = Date.now();
  for (const task of schedule.tasks) {
    if (!task || !task.type || !task.payload) continue;
    const delay = Math.max(0, (task.dueAt || now) - now);
    const run = async () => {
      try {
        if (task.type === 'generateComments') {
          await generateCommentsForPost(task.payload.postId);
        } else if (task.type === 'generateReply') {
          await generateReplyForComment(task.payload.postId, task.payload.commentId);
        }
      } catch (err) {
        console.error('[Social] 重建调度任务执行失败:', err);
      } finally {
        _removeScheduleTask(task.id).catch(() => {});
      }
    };
    setTimeout(run, delay);
  }
  console.log(`[Social] 已重建 ${schedule.tasks.length} 个未完成调度任务`);
}

// ---------- 生成帖子内容（纯生成，不写 DB） ----------
export async function generatePostContent(character, retries = 2) {
  console.log('[Social] 开始生成帖子内容，角色:', character?.name);
  try {
    const memories = await searchMemories(character.id, '最近', 3);
    const memoryText = memories.length
      ? memories.map(m => m.userMessage + ' → ' + m.assistantMessage).join('\n')
      : '无近期记忆';
    const emotion = getEmotionLabel(character.emotionState);
    const body = getBodyDescription(character);
    const time = getGameDate().toLocaleString();

    const prompt = `请以你的角色身份，发布一条朋友圈动态（约20-50字），内容应符合你的人设与当前状态：
- 当前情绪：${emotion}
- 身体状态：${body}
- 当前时间：${time}
- 近期记忆：${memoryText}
直接输出动态内容，不要添加任何前缀或解释。`;

    const fallbackPrompt = `请以你的角色身份，发一句符合人设的朋友圈动态（20-50字）。直接输出内容。`;

    // 角色人设来自 buildPersonaSystemMessage（名称/描述/性格/关系/称呼/性别/系统提示），
    // 作为 systemPrompt 注入，避免只用可能为空的 character.personality 字段导致泛泛文案。
    const systemPrompt = buildPersonaSystemMessage(character);

    for (let attempt = 0; attempt < retries; attempt++) {
      const currentPrompt = attempt === 0 ? prompt : fallbackPrompt;
      const maxTokens = 200 + attempt * 50;
      console.log(`[Social] 生成帖子尝试 ${attempt+1}/${retries}，maxTokens=${maxTokens}`);
      try {
        const response = await sendChatRequest({
          messages: [{ role: 'user', content: currentPrompt }],
          systemPrompt,
          temperature: 0.8,
          maxTokens: maxTokens,
          stream: false,
        });
        const content = response.content?.trim();
        if (content && content.length > 0) {
          console.log('[Social] 生成帖子内容:', content);
          return content;
        }
        console.warn(`[Social] 尝试 ${attempt+1} 返回空，重试...`);
      } catch (e) {
        console.error(`[Social] 尝试 ${attempt+1} 失败:`, e);
        if (attempt === retries - 1) break;
      }
    }
  } catch (e) {
    console.error('[Social] 生成帖子异常:', e);
  }
  console.warn('[Social] 使用默认帖子内容');
  return '今天心情不错，发条动态。';
}

// ---------- 角色发布（新建，无冲突） ----------
export async function publishPostByCharacter(character) {
  console.log('[Social] 角色发帖开始:', character?.name);
  const stores = await getS();
  const content = await generatePostContent(character);
  const post = {
    id: generateUUID(),
    authorType: 'character',
    authorId: character.id,
    content,
    images: [],
    timestamp: getGameTime(),
    emotionSnapshot: character.emotionState,
    bodySnapshot: character.bodyState,
    comments: [],
  };
  await stores.posts.add(post);
  console.log('[Social] 帖子已保存:', post.id);

  // 情感回路闭合（审计 B-6）：角色发帖是自主动作，做一次轻微的「主动分享」情感演化。
  // 朋友圈是角色之间的社交（非与用户互动），影响用更低的强度，避免喧宾夺主。
  try {
    const { handleInteraction } = await import('./emotionEngine.js');
    await handleInteraction(character, 'proactive_share', 0.2);
  } catch (e) {
    console.warn('[Social] 发帖情感更新失败:', e);
  }

  scheduleSocialTask('generateComments', { postId: post.id }, 2 * 60 * 1000);
  return post;
}

// ---------- 用户发布（新建，无冲突） ----------
export async function publishPostByUser(user, content) {
  const stores = await getS();
  const post = {
    id: generateUUID(),
    authorType: 'user',
    authorId: 'user',
    content,
    images: [],
    timestamp: getGameTime(),
    emotionSnapshot: {},
    bodySnapshot: {},
    comments: [],
  };
  await stores.posts.add(post);
  scheduleSocialTask('generateComments', { postId: post.id }, 2 * 60 * 1000);
  return post;
}

// ---------- 生成评论（纯生成，不写 DB） ----------
export async function generateComment(character, post) {
  const stores = await getS();
  const author = post.authorType === 'character' ? await stores.characters.get(post.authorId) : null;
  const authorName = author ? author.name : '用户';
  const prompt = `请以你的角色身份，对好友“${authorName}”的这条动态发表一条评论（约10-30字），内容应符合你的人设与当前状态。
动态内容：${post.content}
你的情绪：${getEmotionLabel(character.emotionState)}
你的状态：${getBodyDescription(character)}
直接输出评论内容，不要添加任何前缀。`;
  const systemPrompt = buildPersonaSystemMessage(character);
  try {
    const response = await sendChatRequest({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt,
      temperature: 0.7,
      maxTokens: 150,
      stream: false,
    });
    return response.content?.trim() || '哈哈哈，有趣！';
  } catch (e) {
    console.error('生成评论失败:', e);
    return '哈哈哈，有趣！';
  }
}

// ---------- 生成回复（含重试与加锁） ----------
export async function generateReplyForComment(postId, commentId, userReplyContent = null, retries = 2) {
  return withKeyLock('post', postId, async () => {
    const stores = await getS();
    const post = await stores.posts.get(postId);
    if (!post) return;
    const comment = post.comments.find(c => c.id === commentId);
    if (!comment) return;

    const hasCharacterReply = Array.isArray(comment.replies)
      && comment.replies.some(r => r.authorType === 'character');
    if (hasCharacterReply && !userReplyContent) return;

    const author = await stores.characters.get(post.authorId);
    if (!author) return;

    const commentAuthor = comment.authorType === 'character'
      ? await stores.characters.get(comment.authorId)
      : null;
    const commentAuthorName = commentAuthor ? commentAuthor.name : '用户';

    // ---------- 用户手动回复：写入后 1 分钟触发 AI 回复 ----------
    if (userReplyContent) {
      const reply = {
        id: generateUUID(),
        authorType: 'user',
        authorId: 'user',
        content: userReplyContent,
        timestamp: getGameTime(),
      };
      if (!comment.replies) comment.replies = [];
      comment.replies.push(reply);
      await stores.posts.update(postId, post);

      if (post.authorType === 'character') {
        scheduleSocialTask('generateReply', { postId, commentId: comment.id }, 1 * 60 * 1000);
      }
      return;
    }

    // ---------- AI 生成回复 ----------
    const prompt = `请以你的角色身份，回复好友“${commentAuthorName}”对你动态的评论（约10-30字），内容应符合你的人设和当前状态。
动态内容：${post.content}
评论内容：${comment.content}
你的情绪：${getEmotionLabel(author.emotionState)}
你的状态：${getBodyDescription(author)}
直接输出回复内容，不要添加任何前缀。`;

    const fallbackPrompt = `请以你的角色身份，回复好友“${commentAuthorName}”的评论（10-30字）。直接输出回复内容。`;

    const systemPrompt = buildPersonaSystemMessage(author);

    for (let attempt = 0; attempt < retries; attempt++) {
      const currentPrompt = attempt === 0 ? prompt : fallbackPrompt;
      const maxTokens = 150 + attempt * 50;
      console.log(`[Social] 生成回复尝试 ${attempt+1}/${retries}，maxTokens=${maxTokens}`);
      try {
        const response = await sendChatRequest({
          messages: [{ role: 'user', content: currentPrompt }],
          systemPrompt,
          temperature: attempt === 0 ? 0.7 : 0.9,
          maxTokens: maxTokens,
          stream: false,
        });
        let content = response.content?.trim();
        if (content && content.length > 0) {
          if (comment.replies && comment.replies.some(r => r.content === content && r.authorType === 'character')) {
            console.warn('[Social] 重复回复，跳过');
            return;
          }
          const reply = {
            id: generateUUID(),
            authorType: 'character',
            authorId: author.id,
            content,
            timestamp: getGameTime(),
          };
          if (!comment.replies) comment.replies = [];
          comment.replies.push(reply);
          await stores.posts.update(postId, post);
          console.log('[Social] 回复已生成:', content);
          return;
        }
        console.warn(`[Social] 尝试 ${attempt+1} 回复为空，重试...`);
      } catch (e) {
        console.error(`[Social] 尝试 ${attempt+1} 失败:`, e);
        if (attempt === retries - 1) break;
      }
    }

    // 兜底回复
    const defaultReply = '嗯嗯，好的。';
    if (!comment.replies || !comment.replies.some(r => r.content === defaultReply)) {
      const reply = {
        id: generateUUID(),
        authorType: 'character',
        authorId: author.id,
        content: defaultReply,
        timestamp: getGameTime(),
      };
      if (!comment.replies) comment.replies = [];
      comment.replies.push(reply);
      await stores.posts.update(postId, post);
    }
  });
}

// ---------- 为帖子生成评论（加锁） ----------
export async function generateCommentsForPost(postId) {
  return withKeyLock('post', postId, async () => {
    const stores = await getS();
    const post = await stores.posts.get(postId);
    if (!post) return;

    const allCharacters = await stores.characters.getAll();
    let candidates = allCharacters.filter(c => c.id !== post.authorId);
    // 审计修复：候选为空（例如只有 1 个角色时）直接返回，避免空评论
    if (candidates.length === 0) return;
    // 评论数 1~2 个（旧实现 num=Math.floor(Math.random()*3) 有 1/3 概率为 0，
    // 导致角色从不对帖子评论）。改为至少 1 个，最多不超过候选数。
    const num = Math.min(candidates.length, 1 + Math.floor(Math.random() * 2));
    const selected = candidates.sort(() => Math.random() - 0.5).slice(0, num);

    let hasNewComment = false;
    for (const char of selected) {
      const comment = await generateComment(char, post);
      if (comment) {
        post.comments.push({
          id: generateUUID(),
          authorType: 'character',
          authorId: char.id,
          content: comment,
          timestamp: getGameTime(),
          replyTo: null,
          replies: [],
        });
        hasNewComment = true;
      }
    }

    if (post.authorType === 'character' && hasNewComment) {
      for (const comment of post.comments) {
        if (!comment.replies || comment.replies.length === 0) {
          scheduleSocialTask('generateReply', { postId: post.id, commentId: comment.id }, 3 * 60 * 1000);
        }
      }
    }

    if (hasNewComment) {
      await stores.posts.update(postId, post);
    }
  });
}

// ---------- 用户评论帖子（加锁） ----------
export async function userCommentPost(postId, content, replyToCommentId = null) {
  // 分支 1：回复评论 —— 直接调用 generateReplyForComment（它自己会加锁），
  //        避免外层再套一层锁导致同一 postId 死锁
  if (replyToCommentId) {
    const stores = await getS();
    const post = await stores.posts.get(postId);
    if (!post) return;
    const parentComment = post.comments.find(c => c.id === replyToCommentId);
    if (!parentComment) return;
    await generateReplyForComment(postId, parentComment.id, content);
    return;
  }

  // 分支 2：新评论 —— 加锁
  return withKeyLock('post', postId, async () => {
    const stores = await getS();
    const post = await stores.posts.get(postId);
    if (!post) return;

    const comment = {
      id: generateUUID(),
      authorType: 'user',
      authorId: 'user',
      content,
      timestamp: getGameTime(),
      replyTo: null,
      replies: [],
    };
    post.comments.push(comment);
    await stores.posts.update(postId, post);

    if (post.authorType === 'character') {
      scheduleSocialTask('generateReply', { postId, commentId: comment.id }, 1 * 60 * 1000);
    }
  });
}

// ---------- 获取所有帖子（纯读） ----------
export async function getAllPosts() {
  const stores = await getS();
  const posts = await stores.posts.getAll();
  return posts.sort((a, b) => b.timestamp - a.timestamp);
}

// ---------- 删除帖子（加锁） ----------
export async function deletePost(postId) {
  return withKeyLock('post', postId, async () => {
    const stores = await getS();
    await stores.posts.delete(postId);
  });
}

// ---------- 删除角色关联的所有朋友圈数据 ----------
export async function deleteCharacterSocialData(characterId) {
  const stores = await getS();
  const allPosts = await stores.posts.getAll();

  // 第一步：清理其他帖子中该角色的评论和回复
  for (const p of allPosts) {
    if (p.authorId === characterId) continue;

    let needUpdate = false;
    p.comments = p.comments.filter(c => {
      if (c.authorId === characterId) {
        needUpdate = true;
        return false;
      }
      if (c.replies) {
        const before = c.replies.length;
        c.replies = c.replies.filter(r => r.authorId !== characterId);
        if (c.replies.length !== before) needUpdate = true;
      }
      return true;
    });

    if (needUpdate) {
      const postId = p.id;
      await withKeyLock('post', postId, async () => {
        // 锁内重读，避免与其他写冲突
        const fresh = await stores.posts.get(postId);
        if (!fresh) return;
        fresh.comments = fresh.comments.filter(c => {
          if (c.authorId === characterId) return false;
          if (c.replies) {
            c.replies = c.replies.filter(r => r.authorId !== characterId);
          }
          return true;
        });
        await stores.posts.update(postId, fresh);
      });
    }
  }

  // 第二步：删除该角色发的所有帖子
  const postsToDelete = allPosts.filter(p => p.authorId === characterId);
  for (const p of postsToDelete) {
    await withKeyLock('post', p.id, async () => {
      await stores.posts.delete(p.id);
    });
  }
}

// ---------- 定时检查自动发帖（新建，无冲突） ----------
export async function checkAutoPost() {
  const settings = getAppState().get('settings');
  const socialCfg = settings?.social || {};
  // 开关：默认开启以保持既有行为，但允许用户在设置里关闭
  if (socialCfg.enabled === false) return;

  const stores = await getS();
  const allCharacters = await stores.characters.getAll();

  // 总量/单角色每日上限：基于「当日游戏日期」统计已自动发帖数
  const today = getGameDate();
  const isSameDay = (ts) => {
    try { return new Date(ts).toDateString() === new Date(today).toDateString(); } catch (_) { return false; }
  };
  const todayPosts = (await stores.posts.getAll())
    .filter(p => p.authorType === 'character' && isSameDay(p.timestamp));
  const totalToday = todayPosts.length;
  const maxPerDay = toFiniteNumber(socialCfg.maxPostsPerDay) ?? 5;
  const maxPerChar = toFiniteNumber(socialCfg.maxPostsPerCharacter) ?? 2;
  if (totalToday >= maxPerDay) return;

  const baseProbability = toFiniteNumber(socialCfg.autoPostProbability) ?? 0.01;
  const charCounts = new Map();
  for (const p of todayPosts) {
    charCounts.set(p.authorId, (charCounts.get(p.authorId) || 0) + 1);
  }

  // 全局当日总数（跨角色累加），随每次发帖递增。审计 B-4：旧实现用
  // `totalToday + n`（n 是单角色计数）判断上限，多角色时各自越过 maxPerDay。
  let globalToday = totalToday;

  for (const char of allCharacters) {
    if (globalToday >= maxPerDay) break;
    const hour = new Date(getGameTime()).getHours();
    if (hour >= 22 || hour < 6) continue;
    if ((charCounts.get(char.id) || 0) >= maxPerChar) continue;
    const valence = char.emotionState?.valence || 0;
    const probability = baseProbability * (1 + valence / 100);
    if (Math.random() < probability) {
      await publishPostByCharacter(char);
      charCounts.set(char.id, (charCounts.get(char.id) || 0) + 1);
      globalToday += 1;
    }
  }
}

function toFiniteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}