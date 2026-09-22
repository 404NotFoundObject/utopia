// js/modules/social.js - 朋友圈核心逻辑
import { getStores, withKeyLock } from '../core/db.js';
import { generateUUID } from '../core/utils.js';
import { getGameTime, getGameDate } from './time.js';
import { sendChatRequest } from '../core/api.js';
import { searchMemories } from './memory.js';
import { getEmotionLabel } from './emotionEngine.js';
import { getBodyDescription } from './bodyState.js';

let _stores = null;
async function getS() {
  if (!_stores) _stores = await getStores();
  return _stores;
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

    const prompt = `你是角色“${character.name}”，请根据以下信息，生成一条朋友圈动态（约20-50字），风格符合你的人设：
- 当前情绪：${emotion}
- 身体状态：${body}
- 当前时间：${time}
- 近期记忆：${memoryText}
- 人设：${character.personality}
直接输出动态内容，不要添加任何前缀或解释。`;

    const fallbackPrompt = `请扮演角色“${character.name}”，说一句符合他/她人设的朋友圈动态（20-50字）。直接输出内容。`;

    for (let attempt = 0; attempt < retries; attempt++) {
      const currentPrompt = attempt === 0 ? prompt : fallbackPrompt;
      const maxTokens = 200 + attempt * 50;
      console.log(`[Social] 生成帖子尝试 ${attempt+1}/${retries}，maxTokens=${maxTokens}`);
      try {
        const response = await sendChatRequest({
          messages: [{ role: 'user', content: currentPrompt }],
          systemPrompt: '你是一个社交媒体内容生成助手。',
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
  setTimeout(() => {
    generateCommentsForPost(post.id).catch(console.error);
  }, 2 * 60 * 1000);
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
  setTimeout(() => {
    generateCommentsForPost(post.id).catch(console.error);
  }, 2 * 60 * 1000);
  return post;
}

// ---------- 生成评论（纯生成，不写 DB） ----------
export async function generateComment(character, post) {
  const stores = await getS();
  const author = post.authorType === 'character' ? await stores.characters.get(post.authorId) : null;
  const authorName = author ? author.name : '用户';
  const prompt = `你是角色“${character.name}”，请对好友“${authorName}”的动态发表一条评论（约10-30字），符合你的人设和当前状态。
动态内容：${post.content}
你的情绪：${getEmotionLabel(character.emotionState)}
你的状态：${getBodyDescription(character)}
直接输出评论内容，不要添加任何前缀。`;
  try {
    const response = await sendChatRequest({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: '你是一个社交媒体评论助手。',
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

// ---------- 生成回复（含重试，AUD-13 加锁） ----------
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
        setTimeout(() => {
          generateReplyForComment(postId, comment.id).catch(console.error);
        }, 1 * 60 * 1000);
      }
      return;
    }

    // ---------- AI 生成回复 ----------
    const prompt = `你是角色“${author.name}”，请回复好友“${commentAuthorName}”对你动态的评论（约10-30字），符合你的人设和当前状态。
动态内容：${post.content}
评论内容：${comment.content}
你的情绪：${getEmotionLabel(author.emotionState)}
你的状态：${getBodyDescription(author)}
直接输出回复内容，不要添加任何前缀。`;

    const fallbackPrompt = `请扮演角色“${author.name}”，回复好友“${commentAuthorName}”的评论（10-30字）。直接输出回复内容。`;

    for (let attempt = 0; attempt < retries; attempt++) {
      const currentPrompt = attempt === 0 ? prompt : fallbackPrompt;
      const maxTokens = 150 + attempt * 50;
      console.log(`[Social] 生成回复尝试 ${attempt+1}/${retries}，maxTokens=${maxTokens}`);
      try {
        const response = await sendChatRequest({
          messages: [{ role: 'user', content: currentPrompt }],
          systemPrompt: '你是一个社交媒体回复助手。',
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

// ---------- 为帖子生成评论（AUD-13 加锁） ----------
export async function generateCommentsForPost(postId) {
  return withKeyLock('post', postId, async () => {
    const stores = await getS();
    const post = await stores.posts.get(postId);
    if (!post) return;

    const allCharacters = await stores.characters.getAll();
    let candidates = allCharacters.filter(c => c.id !== post.authorId);
    const num = Math.floor(Math.random() * 3);
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
      // 注意：这里的 setTimeout 是延时执行，不在当前锁窗口内，安全
      for (const comment of post.comments) {
        if (!comment.replies || comment.replies.length === 0) {
          setTimeout(() => {
            generateReplyForComment(post.id, comment.id).catch(console.error);
          }, 3 * 60 * 1000);
        }
      }
    }

    if (hasNewComment) {
      await stores.posts.update(postId, post);
    }
  });
}

// ---------- 用户评论帖子（AUD-13 加锁） ----------
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
      setTimeout(() => {
        generateReplyForComment(postId, comment.id).catch(console.error);
      }, 1 * 60 * 1000);
    }
  });
}

// ---------- 获取所有帖子（纯读） ----------
export async function getAllPosts() {
  const stores = await getS();
  const posts = await stores.posts.getAll();
  return posts.sort((a, b) => b.timestamp - a.timestamp);
}

// ---------- 删除帖子（AUD-13 加锁） ----------
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
  const stores = await getS();
  const allCharacters = await stores.characters.getAll();
  for (const char of allCharacters) {
    const hour = new Date(getGameTime()).getHours();
    if (hour >= 22 || hour < 6) continue;
    const valence = char.emotionState?.valence || 0;
    const probability = 0.03 * (1 + valence / 100);
    if (Math.random() < probability) {
      await publishPostByCharacter(char);
    }
  }
}