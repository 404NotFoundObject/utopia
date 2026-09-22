// js/ui/screens/socialUI.js - 朋友圈完整界面（已埋插件槽位）
import { getAppState } from '../../core/state.js';
import { escapeHtml } from '../../core/utils.js';
import { getAllPosts, publishPostByUser, userCommentPost, deletePost } from '../../modules/social.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { rescan } from '../../plugins/uiRuntime.js';

export async function openSocialFeed() {
  const posts = await getAllPosts();
  const html = `
    <div class="social-feed">
      <div class="social-header" data-plugin-slot="social-header">
        <h2><i class="fas fa-globe"></i> 朋友圈</h2>
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
  document.getElementById('socialPostsList').addEventListener('click', async (e) => {
    const target = e.target.closest('button');
    if (!target) return;

    if (target.classList.contains('social-comment-btn')) {
      const postId = target.dataset.postId;
      const replyToId = target.dataset.replyToId || null;
      let container = target.closest('.social-comment');
      if (!container) container = target.closest('.social-post');
      if (container) {
        showInlineInput(container, postId, replyToId);
      }
      return;
    }

    if (target.classList.contains('social-delete-btn')) {
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
      const replyToId = input.dataset.replyToId || null;
      const content = input.value.trim();
      if (!content) return;
      await userCommentPost(postId, content, replyToId);
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
  document.getElementById('socialPostsList').addEventListener('keydown', (e) => {
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

function showInlineInput(container, postId, replyToId = null) {
  const existing = container.querySelector('.social-inline-comment');
  if (existing) {
    const input = existing.querySelector('.social-comment-input');
    if (input) input.focus();
    return;
  }

  // ★ XSS 修复：data-* 属性值转义
  const safePostId = escapeHtml(postId);
  const safeReplyToId = escapeHtml(replyToId || '');

  const html = `
    <div class="social-inline-comment">
      <input type="text" class="social-comment-input" data-post-id="${safePostId}" data-reply-to-id="${safeReplyToId}" placeholder="说点什么..." autofocus>
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

function renderPostHtml(post) {
  const state = getAppState();
  const chars = state.get('characters');
  const getAuthorName = (id, type) => {
    if (type === 'user') return '用户';
    const char = chars.find(c => c.id === id);
    return char ? char.name : '未知角色';
  };
  const authorName = getAuthorName(post.authorId, post.authorType);
  const time = new Date(post.timestamp).toLocaleString();

  const commentsHtml = post.comments.map(c => {
    const cAuthor = getAuthorName(c.authorId, c.authorType);
    let repliesHtml = '';
    if (c.replies && c.replies.length > 0) {
      repliesHtml = c.replies.map(r => {
        const rAuthor = getAuthorName(r.authorId, r.authorType);
        // ★ XSS 修复：回复作者和内容转义
        return `<div class="social-reply"><strong>${escapeHtml(rAuthor)}</strong> 回复：${escapeHtml(r.content)}</div>`;
      }).join('');
    }
    const replyBtn = `<button class="social-comment-btn btn btn-sm" data-post-id="${escapeHtml(post.id)}" data-reply-to-id="${escapeHtml(c.id)}">回复</button>`;
    // ★ XSS 修复：评论作者和内容转义
    return `<div class="social-comment"><strong>${escapeHtml(cAuthor)}</strong>：${escapeHtml(c.content)} ${repliesHtml} ${replyBtn}</div>`;
  }).join('');

  // ★ XSS 修复：作者名、时间、内容、data-* 全部转义
  const safeAuthorName = escapeHtml(authorName);
  const safeTime = escapeHtml(time);
  const safeContent = escapeHtml(post.content);
  const safePostId = escapeHtml(post.id);
  const safeAuthorId = escapeHtml(post.authorId);

  return `
    <div class="social-post" data-id="${safePostId}" data-author-id="${safeAuthorId}" data-plugin-slot="social-post">
      <div class="social-post-header">
        <span class="social-post-author"><strong>${safeAuthorName}</strong></span>
        <span class="social-post-time">${safeTime}</span>
        ${post.authorType === 'user' ? `<button class="social-delete-btn" data-post-id="${safePostId}">删除</button>` : ''}
      </div>
      <div class="social-post-content" data-plugin-slot="social-post-content">${safeContent}</div>
      <div class="social-post-comments">${commentsHtml}</div>
      <button class="social-comment-btn btn btn-sm" data-post-id="${safePostId}">评论</button>
      <!-- ★ 槽位：帖子底部操作区（插件可注入"翻译"、"点赞"等） ★ -->
      <div data-plugin-slot="social-post-actions" data-post-id="${safePostId}" style="display:contents;"></div>
    </div>
  `;
}