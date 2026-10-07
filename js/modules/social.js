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

// ---------- 持久化调度（评论/回复的延时任务不依赖内存 setTimeout，关标签页可重建） ----------
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
        await generateReplyForComment(payload.postId, payload.commentId, null, 2, payload.replierId || null, payload.replyToReplyId || null);
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
          await generateReplyForComment(task.payload.postId, task.payload.commentId, null, 2, task.payload.replierId || null, task.payload.replyToReplyId || null);
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
  // 重试耗尽：返回 null 让调用方跳过本次发帖。
  // 历史上这里会返回「今天心情不错，发条动态。」这类机械文案，
  // 用户一眼识破是预设的，比没有动态更伤沉浸感。
  console.warn('[Social] 生成帖子失败，本次跳过');
  return null;
}

// ---------- 角色发布（新建，无冲突） ----------
// 生成失败时返回 null（调用方跳过），不落机械兜底文案。
export async function publishPostByCharacter(character) {
  console.log('[Social] 角色发帖开始:', character?.name);
  const stores = await getS();
  const content = await generatePostContent(character);
  if (!content) return null;
  const post = {
    id: generateUUID(),
    authorType: 'character',
    authorId: character.id,
    content,
    images: [],
    likes: [],
    timestamp: getGameTime(),
    emotionSnapshot: character.emotionState,
    bodySnapshot: character.bodyState,
    comments: [],
  };
  await stores.posts.add(post);
  console.log('[Social] 帖子已保存:', post.id);

  // 情感回路闭合：角色发帖是自主动作，做一次轻微的「主动分享」情感演化。
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
    likes: [],
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
// 返回值：成功为评论文本；失败/空回复返回 null（调用方跳过，绝不落
// 机械的预设文案——那比「没有评论」更出戏）。
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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await sendChatRequest({
        messages: [{ role: 'user', content: prompt }],
        systemPrompt,
        temperature: 0.7,
        maxTokens: 150 + attempt * 50,
        stream: false,
      });
      const content = response.content?.trim();
      if (content) return content;
      console.warn(`[Social] 生成评论尝试 ${attempt + 1}/2 返回空`);
    } catch (e) {
      console.error(`[Social] 生成评论尝试 ${attempt + 1}/2 失败:`, e);
    }
  }
  return null;
}

// ---------- 生成回复（含重试与加锁） ----------
// replyToReplyId：用户「回复某条回复」时该回复的 id；为空表示回复的是评论本身。
export async function generateReplyForComment(postId, commentId, userReplyContent = null, retries = 2, replierId = null, replyToReplyId = null) {
  return withKeyLock('post', postId, async () => {
    const stores = await getS();
    const post = await stores.posts.get(postId);
    if (!post) return;
    const comment = post.comments.find(c => c.id === commentId);
    if (!comment) return;

    const hasCharacterReply = Array.isArray(comment.replies)
      && comment.replies.some(r => r.authorType === 'character');
    // replierId 显式指定（用户回复触发的接话）时绕过该守卫：
    // 旧守卫在角色回过一次后，把用户触发的后续接话调度全部掐断，
    // 表现为「评论区无法再触发角色的回复」。守卫仅用于限制无明确
    // 回复者的帖主自动接话，避免对同一条评论反复自动回复。
    if (hasCharacterReply && !userReplyContent && !replierId) return;

    // ---------- 用户手动回复：先落库，再由「被回复对象」决定是否触发 AI 接话 ----------
    if (userReplyContent) {
      // 回复对象：显式「回复某条回复」则取该回复的作者，否则为被回复的评论作者
      let targetType = comment.authorType;
      let targetId = comment.authorId;
      if (replyToReplyId) {
        const targetReply = (comment.replies || []).find(r => r.id === replyToReplyId);
        if (targetReply) {
          targetType = targetReply.authorType;
          targetId = targetReply.authorId;
        }
      }
      const reply = {
        id: generateUUID(),
        authorType: 'user',
        authorId: 'user',
        replyToAuthorType: targetType,
        replyToAuthorId: targetId,
        content: userReplyContent,
        timestamp: getGameTime(),
      };
      if (!comment.replies) comment.replies = [];
      comment.replies.push(reply);
      await stores.posts.update(postId, post);

      // 被回复对象若是角色，由该角色接话（用户是在跟这个角色对话），
      // 与帖子作者是谁无关。
      if (targetType === 'character') {
        scheduleSocialTask(
          'generateReply',
          { postId, commentId: comment.id, replierId: targetId, replyToReplyId: replyToReplyId || null },
          1 * 60 * 1000
        );
      }
      return;
    }

    // ---------- AI 生成回复 ----------
    // 回复者：显式指定则用之，否则回落到帖子作者（保持"帖主回应评论"的原有语义）。
    // 取角色的早退只能放在这里——用户帖子没有作者角色，但用户回复仍需正常落库。
    const author = await stores.characters.get(replierId || post.authorId);
    if (!author) return;

    const commentAuthor = comment.authorType === 'character'
      ? await stores.characters.get(comment.authorId)
      : null;
    const commentAuthorName = commentAuthor ? commentAuthor.name : '用户';

    // replierId 显式指定 ⇒ 用户对话触发的接话，回复对象是用户的最新回复；
    // 否则是帖主回应评论，回复对象是评论作者。
    const lastUserReply = (comment.replies || [])
      .filter(r => r.authorType === 'user')
      .slice(-1)[0]?.content || '';
    const isOwnComment = !!replierId && replierId === comment.authorId;

    const prompt = replierId
      ? `请以你的角色身份，回应对方在评论区的回复（约10-30字），内容应符合你的人设和当前状态。
动态内容：${post.content}
${isOwnComment ? `你的评论：${comment.content}` : `相关评论（${commentAuthorName}）：${comment.content}`}
对方的回复：${lastUserReply}
你的情绪：${getEmotionLabel(author.emotionState)}
你的状态：${getBodyDescription(author)}
直接输出回复内容，不要添加任何前缀。`
      : `请以你的角色身份，回复好友“${commentAuthorName}”对你动态的评论（约10-30字），内容应符合你的人设和当前状态。
动态内容：${post.content}
评论内容：${comment.content}
你的情绪：${getEmotionLabel(author.emotionState)}
你的状态：${getBodyDescription(author)}
直接输出回复内容，不要添加任何前缀。`;

    const fallbackPrompt = `请以你的角色身份，回复好友“${commentAuthorName}”的评论（10-30字）。直接输出回复内容。`;

    const systemPrompt = buildPersonaSystemMessage(author);

    // 回复对象展示字段：用户会话中回复的是用户；帖主自动接话则回复评论作者
    const replyTargetType = replierId ? 'user' : comment.authorType;
    const replyTargetId = replierId ? 'user' : comment.authorId;

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
            replyToAuthorType: replyTargetType,
            replyToAuthorId: replyTargetId,
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
        replyToAuthorType: replyTargetType,
        replyToAuthorId: replyTargetId,
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
    // 候选为空（例如只有 1 个角色时）直接返回，避免空评论
    if (candidates.length === 0) return;
    // 评论数至少 1 个、最多不超过候选数：若取 Math.floor(Math.random()*3)，
    // 有 1/3 概率得到 0，角色就永远不会评论帖子。
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
// replyToCommentId：被回复的评论 id；replyToReplyId：被回复的回复 id（回复"评论下某条回复"时传）。
export async function userCommentPost(postId, content, replyToCommentId = null, replyToReplyId = null) {
  // 分支 1：回复评论/回复 —— 直接调用 generateReplyForComment（它自己会加锁），
  //        避免外层再套一层锁导致同一 postId 死锁
  if (replyToCommentId) {
    const stores = await getS();
    const post = await stores.posts.get(postId);
    if (!post) return;
    const parentComment = post.comments.find(c => c.id === replyToCommentId);
    if (!parentComment) return;
    await generateReplyForComment(postId, parentComment.id, content, 2, null, replyToReplyId);
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

// ---------- 用户点赞/取消点赞（加锁） ----------
export async function togglePostLike(postId) {
  return withKeyLock('post', postId, async () => {
    const stores = await getS();
    const post = await stores.posts.get(postId);
    if (!post) return false;
    if (!Array.isArray(post.likes)) post.likes = [];
    const idx = post.likes.findIndex(l => l.authorType === 'user' && l.authorId === 'user');
    let liked;
    if (idx >= 0) {
      post.likes.splice(idx, 1);
      liked = false;
    } else {
      post.likes.push({ authorType: 'user', authorId: 'user', timestamp: getGameTime() });
      liked = true;
    }
    await stores.posts.update(postId, post);
    return liked;
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

  // 全局当日总数（跨角色累加），随每次发帖递增。
  // 若用 `totalToday + n`（n 是单角色计数）判断上限，多角色时各自都会越过 maxPerDay。
  let globalToday = totalToday;

  for (const char of allCharacters) {
    if (globalToday >= maxPerDay) break;
    const hour = new Date(getGameTime()).getHours();
    if (hour >= 22 || hour < 6) continue;
    if ((charCounts.get(char.id) || 0) >= maxPerChar) continue;
    const valence = char.emotionState?.valence || 0;
    const probability = baseProbability * (1 + valence / 100);
    if (Math.random() < probability) {
      const post = await publishPostByCharacter(char);
      if (!post) continue; // 生成失败：不计入次数，下次心跳再试
      charCounts.set(char.id, (charCounts.get(char.id) || 0) + 1);
      globalToday += 1;
    }
  }
}

function toFiniteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}