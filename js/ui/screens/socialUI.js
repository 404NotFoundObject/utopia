// js/ui/screens/socialUI.js - 朋友圈界面（微信风格布局，已埋插件槽位）
import { getAppState } from '../../core/state.js';
import { escapeHtml } from '../../core/utils.js';
import { getAllPosts, publishPostByUser, userCommentPost, deletePost, togglePostLike } from '../../modules/social.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { rescan } from '../../plugins/uiRuntime.js';

const AVATAR_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'42\' height=\'42\' viewBox=\'0 0 42 42\'%3E%3Crect width=\'42\' height=\'42\' rx=\'6\' fill=\'%23e0e0e6\'/%3E%3Ctext x=\'21\' y=\'28\' text-anchor=\'middle\' fill=\'%238a8aaa\' font-size=\'16\' font-family=\'sans-serif\'%3E?%3C/text%3E%3C/svg%3E';

export async function openSocialFeed() {
  const posts = await getAllPosts();
  const html = `
    <div class="social-feed">
      <div class="social-header" data-plugin-slot="social-header">
        <div class="social-header-actions">
          <!-- ★ 槽位：头部按钮区（插件可注入） ★ -->
          <div data-plugin-slot="social-header-actions" style="display:contents;"></div>
          <button id="socialTogglePublishBtn" class="btn btn-sm"><i class="fas fa-plus"></i> 发布</button>
          <button id="socialCloseBtn" class="modal-close">&times;</button>
        </div>
      </div>
      <div id="socialPublishBox" class="social-publish-box" style="display:none;">
        <textarea id="socialNewPostInput" rows="2" placeholder="说点什么..."></textarea>
        <div class="social-publish-actions">
          <!-- ★ 槽位：发布框底部（插件可注入附加选项） ★ -->
          <div data-plugin-slot="social-publish-extras" style="display:contents;"></div>
          <button id="socialPublishCancelBtn" class="btn btn-sm">取消</button>
          <button id="socialPublishSubmitBtn" class="btn btn-primary btn-sm">发表</button>
        </div>
      </div>
      <div id="socialPostsList" class="social-posts">
        ${posts.length === 0 ? '<p class="empty-msg">暂无动态，发一条吧！</p>' : ''}
        ${posts.map(post => renderPostHtml(post)).join('')}
      </div>
    </div>
  `;
  openModal(html);

  // 打开后触发槽位扫描
  setTimeout(() => {
    try { rescan(); } catch (_) {}
  }, 50);

  // ----- 发布框控制 -----
  const toggleBtn = document.getElementById('socialTogglePublishBtn');
  const publishBox = document.getElementById('socialPublishBox');
  const publishInput = document.getElementById('socialNewPostInput');
  const cancelBtn = document.getElementById('socialPublishCancelBtn');
  const submitBtn = document.getElementById('socialPublishSubmitBtn');

  function showPublishBox(show) {
    publishBox.style.display = show ? 'block' : 'none';
    if (show) publishInput.focus();
  }

  toggleBtn.addEventListener('click', () => {
    const isVisible = publishBox.style.display !== 'none';
    showPublishBox(!isVisible);
  });

  cancelBtn.addEventListener('click', () => {
    publishInput.value = '';
    showPublishBox(false);
  });

  submitBtn.addEventListener('click', async () => {
    const content = publishInput.value.trim();
    if (!content) { showToast('请输入内容', 'warning'); return; }
    const user = getAppState().get('settings').user;
    await publishPostByUser(user, content);
    publishInput.value = '';
    showPublishBox(false);
    closeModal();
    openSocialFeed();
    showToast('发布成功', 'success');
  });

  // 关闭
  document.getElementById('socialCloseBtn').addEventListener('click', closeModal);

  // ----- 事件委托 -----
  const postsList = document.getElementById('socialPostsList');

  // 点击空白处关闭「赞/评论」弹出菜单
  document.addEventListener('click', closeAllPopups);
  // 模态关闭时移除 document 级监听（openModal 重建 DOM，旧监听保留无害但尽量清理）
  document.getElementById('socialCloseBtn').addEventListener('click', () => {
    document.removeEventListener('click', closeAllPopups);
  });

  function closeAllPopups(excludePopup = null) {
    postsList.querySelectorAll('.social-action-popup.open').forEach(p => {
      if (p !== excludePopup) p.classList.remove('open');
    });
  }

  postsList.addEventListener('click', async (e) => {
    // —— 「···」按钮：切换赞/评论弹出菜单 ——
    const moreBtn = e.target.closest('.social-more-btn');
    if (moreBtn) {
      e.stopPropagation();
      const popup = moreBtn.parentElement.querySelector('.social-action-popup');
      const willOpen = !popup.classList.contains('open');
      closeAllPopups(popup);
      popup.classList.toggle('open', willOpen);
      return;
    }
    // 点在弹出菜单内部时不要被 document 监听关掉
    if (e.target.closest('.social-action-popup')) {
      e.stopPropagation();
    }

    // —— 评论行 / 回复行：点击进入回复输入（微信交互，行本身不是按钮） ——
    const commentRow = e.target.closest('.social-comment-row');
    const replyRow = e.target.closest('.social-reply');
    if (replyRow || commentRow) {
      const row = replyRow || commentRow;
      const postId = row.dataset.postId;
      const commentId = row.dataset.commentId;
      const replyId = replyRow ? replyRow.dataset.replyId : null;
      const targetName = row.dataset.targetName || '对方';
      const floor = row.closest('.social-comment-floor') || row.closest('.social-post-comments');
      if (floor) {
        showInlineInput(floor, { postId, commentId, replyId, placeholder: `回复 ${targetName}` });
      }
      return;
    }

    const target = e.target.closest('button');
    if (!target) return;

    if (target.classList.contains('social-action-like')) {
      const postId = target.dataset.postId;
      const liked = await togglePostLike(postId);
      closeModal();
      openSocialFeed();
      showToast(liked ? '已点赞' : '已取消点赞', 'success');
      return;
    }

    if (target.classList.contains('social-action-comment')) {
      const postId = target.dataset.postId;
      const postEl = target.closest('.social-post');
      // 无点赞且无评论时不渲染灰底容器，首次评论动态创建
      let bar = postEl.querySelector('.social-comment-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'social-comment-bar';
        const commentsDiv = document.createElement('div');
        commentsDiv.className = 'social-post-comments';
        bar.appendChild(commentsDiv);
        postEl.querySelector('.social-post-main').appendChild(bar);
      }
      const commentsArea = bar.querySelector('.social-post-comments');
      if (commentsArea) {
        showInlineInput(commentsArea, { postId, commentId: null, replyId: null, placeholder: '评论' });
      }
      return;
    }

    if (target.classList.contains('social-action-delete')) {
      const postId = target.dataset.postId;
      if (confirm('确定删除此动态？')) {
        await deletePost(postId);
        closeModal();
        openSocialFeed();
        showToast('已删除', 'success');
      }
      return;
    }

    if (target.classList.contains('social-comment-send-btn')) {
      const inlineBox = target.closest('.social-inline-comment');
      const input = inlineBox.querySelector('.social-comment-input');
      const postId = input.dataset.postId;
      const commentId = input.dataset.commentId || null;
      const replyId = input.dataset.replyId || null;
      const content = input.value.trim();
      if (!content) return;
      await userCommentPost(postId, content, commentId, replyId);
      closeModal();
      openSocialFeed();
      showToast('发送成功', 'success');
      return;
    }

    if (target.classList.contains('social-comment-cancel-btn')) {
      const inlineBox = target.closest('.social-inline-comment');
      if (inlineBox) inlineBox.remove();
      return;
    }
  });

  // 回车发送
  postsList.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const input = e.target.closest('.social-comment-input');
      if (input) {
        e.preventDefault();
        const inlineBox = input.closest('.social-inline-comment');
        const sendBtn = inlineBox.querySelector('.social-comment-send-btn');
        if (sendBtn) sendBtn.click();
      }
    }
  });
}

// ---------- 内联评论/回复输入框 ----------
// opts: { postId, commentId, replyId, placeholder }
function showInlineInput(container, opts = {}) {
  const existing = container.querySelector('.social-inline-comment');
  if (existing) {
    existing.remove();
  }

  // ★ 防 XSS：data-* 属性值转义
  const safePostId = escapeHtml(opts.postId || '');
  const safeCommentId = escapeHtml(opts.commentId || '');
  const safeReplyId = escapeHtml(opts.replyId || '');

  const html = `
    <div class="social-inline-comment">
      <input type="text" class="social-comment-input" data-post-id="${safePostId}" data-comment-id="${safeCommentId}" data-reply-id="${safeReplyId}" placeholder="${escapeHtml(opts.placeholder || '说点什么...')}" autofocus>
      <div class="social-inline-actions">
        <button class="btn btn-sm social-comment-cancel-btn">取消</button>
        <button class="btn btn-primary btn-sm social-comment-send-btn">发送</button>
      </div>
    </div>
  `;
  const temp = document.createElement('div');
  temp.innerHTML = html;
  const inputBox = temp.firstElementChild;
  container.appendChild(inputBox);
  const input = inputBox.querySelector('.social-comment-input');
  input.focus();
}

// ---------- 相对时间（微信风格） ----------
function formatRelativeTime(ts) {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 2 * 24 * 60 * 60 * 1000) return '昨天';
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}天前`;
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// ---------- 渲染单条帖子（微信风格） ----------
function renderPostHtml(post) {
  const state = getAppState();
  const chars = state.get('characters');
  const user = state.get('settings').user || {};

  const getAuthorInfo = (id, type) => {
    if (type === 'user') {
      return { name: user.name || '用户', avatar: user.avatar || '' };
    }
    const char = chars.find(c => c.id === id);
    return char ? { name: char.name, avatar: char.avatar || '' } : { name: '未知角色', avatar: '' };
  };

  const authorInfo = getAuthorInfo(post.authorId, post.authorType);
  const isOwnPost = post.authorType === 'user';
  const likedByMe = Array.isArray(post.likes) && post.likes.some(l => l.authorType === 'user' && l.authorId === 'user');
  const safePostId = escapeHtml(post.id);
  const safeAuthorId = escapeHtml(post.authorId);

  // —— 评论区（微信灰条，与点赞行同容器）：点评论/回复行即可回复 ——
  // 微信文案格式：「名字: 内容」「A 回复 B: 内容」（半角冒号，名字链接蓝）
  const commentsHtml = (Array.isArray(post.comments) ? post.comments : []).map(c => {
    const cAuthor = getAuthorInfo(c.authorId, c.authorType);
    let repliesHtml = '';
    if (c.replies && c.replies.length > 0) {
      repliesHtml = c.replies.map(r => {
        const rAuthor = getAuthorInfo(r.authorId, r.authorType);
        // 回复对象：优先取 replyToAuthor*，旧数据回落为被回复的评论作者
        const tType = r.replyToAuthorType ?? c.authorType;
        const tInfo = getAuthorInfo(r.replyToAuthorId ?? c.authorId, tType);
        const safeTargetType = escapeHtml(tType);
        const safeTargetName = escapeHtml(tInfo.name);
        // ★ 防 XSS：作者和内容转义
        return `<div class="social-reply" data-post-id="${safePostId}" data-comment-id="${escapeHtml(c.id)}" data-reply-id="${escapeHtml(r.id)}" data-target-type="${safeTargetType}" data-target-name="${safeTargetName}"><span class="social-cname">${escapeHtml(rAuthor.name)}</span> 回复 <span class="social-cname">${safeTargetName}</span>: ${escapeHtml(r.content)}</div>`;
      }).join('');
    }
    return `<div class="social-comment-floor">
      <div class="social-comment-row" data-post-id="${safePostId}" data-comment-id="${escapeHtml(c.id)}" data-target-type="${escapeHtml(c.authorType)}" data-target-name="${escapeHtml(cAuthor.name)}"><span class="social-cname">${escapeHtml(cAuthor.name)}</span>: ${escapeHtml(c.content)}</div>
      ${repliesHtml}
    </div>`;
  }).join('');

  // —— 点赞行（微信式：空心心形 + 蓝色名字列表，与评论同处一个灰底容器） ——
  let likesHtml = '';
  if (Array.isArray(post.likes) && post.likes.length > 0) {
    const names = post.likes
      .map(l => `<span class="social-like-name">${escapeHtml(getAuthorInfo(l.authorId, l.authorType).name)}</span>`)
      .join('');
    likesHtml = `<div class="social-post-likes"><i class="${likedByMe ? 'fas' : 'far'} fa-heart social-like-icon"></i>${names}</div>`;
  }

  const hasLikes = !!(Array.isArray(post.likes) && post.likes.length > 0);
  const hasComments = !!(Array.isArray(post.comments) && post.comments.length > 0);
  // 微信式灰底容器：点赞在上、白色细线分隔、评论在下；无内容不渲染
  const barHtml = (hasLikes || hasComments)
    ? `<div class="social-comment-bar">${likesHtml}${hasLikes && hasComments ? '<div class="social-bar-divider"></div>' : ''}${hasComments ? `<div class="social-post-comments">${commentsHtml}</div>` : ''}</div>`
    : '';

  // —— 图片：微信规则 —— 单图大图（保持比例），4 图 2×2，其余 3 列九宫格 ——
  let imagesHtml = '';
  if (Array.isArray(post.images) && post.images.length > 0) {
    const n = post.images.length;
    const layoutClass = n === 1 ? ' count-1' : (n === 4 ? ' count-4' : '');
    imagesHtml = `<div class="social-post-images${layoutClass}">${post.images.map(src => `<img src="${escapeHtml(src)}" alt="">`).join('')}</div>`;
  }

  // ★ 防 XSS：作者名、内容全部转义
  const safeAuthorName = escapeHtml(authorInfo.name);
  const safeContent = escapeHtml(post.content);

  return `
    <div class="social-post" data-id="${safePostId}" data-author-id="${safeAuthorId}" data-plugin-slot="social-post">
      <img class="social-post-avatar" src="${escapeHtml(authorInfo.avatar || AVATAR_PLACEHOLDER)}" alt="">
      <div class="social-post-main">
        <div class="social-post-author">${safeAuthorName}</div>
        <div class="social-post-content" data-plugin-slot="social-post-content">${safeContent}</div>
        ${imagesHtml}
        <div class="social-post-meta">
          <span class="social-post-time">${escapeHtml(formatRelativeTime(post.timestamp))}</span>
          <div class="social-more-wrap">
            <button class="social-more-btn" data-post-id="${safePostId}" aria-label="更多操作"><i></i><i></i></button>
            <div class="social-action-popup">
              <button class="social-action-item social-action-like" data-post-id="${safePostId}"><i class="fas fa-heart"></i>${likedByMe ? '取消' : '赞'}</button>
              <button class="social-action-item social-action-comment" data-post-id="${safePostId}"><i class="far fa-comment"></i>评论</button>
              ${isOwnPost ? `<button class="social-action-item social-action-delete" data-post-id="${safePostId}"><i class="far fa-trash-alt"></i>删除</button>` : ''}
            </div>
          </div>
        </div>
        ${barHtml}
        <!-- ★ 槽位：帖子底部操作区（插件可注入"翻译"、"点赞"等） ★ -->
        <div data-plugin-slot="social-post-actions" data-post-id="${safePostId}" style="display:contents;"></div>
      </div>
    </div>
  `;
}
