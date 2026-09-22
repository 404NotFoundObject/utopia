// js/ui/screens/groupSettingsUI.js - 群组管理（添加头像和聊天背景编辑）

import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { escapeHtml } from '../../core/utils.js';
import { getGroup, getGroupMembers, updateGroup, removeGroupMember, setGroupMemberMute, unMuteGroupMember, disbandGroup } from '../../modules/groupChat.js';

/**
 * 重开群组设置面板并恢复滚动位置
 * 用于"成员操作后需要刷新 UI"的场景，避免滚动位置回到顶部。
 *
 * @param {string} groupId
 */
async function reopenGroupSettingsPreservingScroll(groupId) {
  const oldContent = document.getElementById('modalContent');
  const scrollTop = oldContent ? oldContent.scrollTop : 0;
  closeModal();
  await openGroupSettings(groupId);
  const newContent = document.getElementById('modalContent');
  if (newContent) newContent.scrollTop = scrollTop;
}

export async function openGroupSettings(groupId) {
  const group = await getGroup(groupId);
  if (!group) { showToast('群组不存在', 'error'); return; }
  const members = await getGroupMembers(groupId);

  // 头像和背景预览数据
  const avatarSrc = group.avatar || '';
  const bgSrc = group.chatBg || '';

  // ★ XSS 修复：group.name / group.description / avatar / bgSrc 转义
  const safeName = escapeHtml(group.name);
  const safeDesc = escapeHtml(group.description || '');
  const safeAvatarSrc = escapeHtml(avatarSrc);
  const safeBgSrc = escapeHtml(bgSrc);

  // ★ XSS 修复：成员列表里所有来自用户的字段转义
  const memberListHtml = members.map(m => {
    const safeMemberId = escapeHtml(m.memberId);
    const displayName = m.memberType === 'user'
      ? '👤 用户'
      : (m.character?.name || m.memberId);
    const safeDisplayName = escapeHtml(displayName);
    return `
      <li style="display:flex;align-items:center;gap:0.5rem;padding:0.2rem 0;border-bottom:1px solid var(--color-border-light);">
        <span>${safeDisplayName}</span>
        ${m.role === 'owner' ? '<span style="font-size:0.7rem;color:var(--color-primary);">(群主)</span>' : ''}
        ${m.isMuted ? '<span style="color:var(--color-danger);">🔇</span>' : ''}
        ${m.memberType === 'character' && m.role !== 'owner' ? `
          <button class="btn btn-sm ${m.isMuted ? 'btn-secondary' : 'btn-warning'}" data-action="mute" data-id="${safeMemberId}">${m.isMuted ? '解除禁言' : '禁言'}</button>
          <button class="btn btn-sm btn-danger" data-action="remove" data-id="${safeMemberId}">移出</button>
        ` : ''}
      </li>
    `;
  }).join('');

  const html = `
    <button class="modal-close">&times;</button>
    <h3 class="modal-title"><i class="fas fa-cog"></i> 群组管理</h3>
    <div class="group-settings">
      <!-- ★★★ 群头像上传 ★★★ -->
      <div class="form-group">
        <label>群头像</label>
        <div class="file-upload-wrapper">
          <input type="file" id="gsAvatarInput" accept="image/*">
          <label class="file-upload-label" for="gsAvatarInput">
            <i class="fas fa-cloud-upload-alt"></i>
            <span>选择头像</span>
            <span class="file-name" id="gsAvatarFileName">未选择</span>
          </label>
        </div>
        <img id="gsAvatarPreview" class="avatar-preview" src="${safeAvatarSrc}" style="${avatarSrc ? '' : 'display:none;'}">
      </div>

      <!-- ★★★ 聊天背景上传 ★★★ -->
      <div class="form-group">
        <label>聊天背景</label>
        <div class="file-upload-wrapper">
          <input type="file" id="gsBgInput" accept="image/*">
          <label class="file-upload-label" for="gsBgInput">
            <i class="fas fa-cloud-upload-alt"></i>
            <span>选择背景</span>
            <span class="file-name" id="gsBgFileName">未选择</span>
          </label>
        </div>
        <img id="gsBgPreview" class="bg-preview" src="${safeBgSrc}" style="${bgSrc ? '' : 'display:none;'}">
      </div>

      <div class="form-group">
        <label>群名称</label>
        <input type="text" id="gsName" value="${safeName}">
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea id="gsDesc">${safeDesc}</textarea>
      </div>
      <div class="form-group">
        <label>自动发言间隔（秒）</label>
        <input type="number" id="gsInterval" value="${group.settings?.autoSpeakInterval || 180}">
      </div>
      <div class="form-group">
        <label>成员列表</label>
        <ul id="gsMemberList">
          ${memberListHtml}
        </ul>
      </div>
      <div class="worldbook-editor-actions">
        <button class="btn btn-secondary" id="gsCancel">关闭</button>
        <button class="btn btn-primary" id="gsSave">保存设置</button>
        <button class="btn btn-danger" id="gsDisband">解散群组</button>
      </div>
    </div>
  `;

  openModal(html);

  // 获取 DOM 元素
  const avatarInput = document.getElementById('gsAvatarInput');
  const avatarPreview = document.getElementById('gsAvatarPreview');
  const avatarFileName = document.getElementById('gsAvatarFileName');
  const bgInput = document.getElementById('gsBgInput');
  const bgPreview = document.getElementById('gsBgPreview');
  const bgFileName = document.getElementById('gsBgFileName');

  // 头像预览
  if (avatarInput && avatarPreview) {
    avatarInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        avatarFileName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (ev) => {
          avatarPreview.src = ev.target.result;
          avatarPreview.style.display = 'block';
        };
        reader.readAsDataURL(file);
      } else {
        avatarFileName.textContent = '未选择';
        avatarPreview.style.display = 'none';
      }
    });
  }

  // 背景预览
  if (bgInput && bgPreview) {
    bgInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        bgFileName.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (ev) => {
          bgPreview.src = ev.target.result;
          bgPreview.style.display = 'block';
        };
        reader.readAsDataURL(file);
      } else {
        bgFileName.textContent = '未选择';
        bgPreview.style.display = 'none';
      }
    });
  }

  // 成员操作事件委托
  document.getElementById('gsMemberList').addEventListener('click', async (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    const action = target.dataset.action;
    const memberId = target.dataset.id;
    if (!memberId) return;

    if (action === 'mute') {
      const isMuted = target.textContent.includes('解除');
      if (isMuted) {
        await unMuteGroupMember(groupId, memberId, 'character');
        showToast('已解除禁言', 'success');
      } else {
        await setGroupMemberMute(groupId, memberId, 'character', 600);
        showToast('已禁言10分钟', 'success');
      }

      await reopenGroupSettingsPreservingScroll(groupId);
    } else if (action === 'remove') {
      if (confirm('确定移出该成员吗？')) {
        await removeGroupMember(groupId, memberId, 'character');
        showToast('已移出', 'success');
        await reopenGroupSettingsPreservingScroll(groupId);
      }
    }
  });

  document.getElementById('gsCancel').addEventListener('click', closeModal);

  document.getElementById('gsSave').addEventListener('click', async () => {
    const name = document.getElementById('gsName').value.trim();
    const desc = document.getElementById('gsDesc').value.trim();
    const interval = parseInt(document.getElementById('gsInterval').value) || 180;

    // ★★★ 获取头像和背景的新值 ★★★
    const avatar = avatarPreview.src || '';
    const chatBg = bgPreview.src || '';

    await updateGroup(groupId, {
      name,
      description: desc,
      avatar,
      chatBg,
      settings: { ...group.settings, autoSpeakInterval: interval }
    });
    showToast('设置已保存', 'success');
    closeModal();
  });

  document.getElementById('gsDisband').addEventListener('click', async () => {
    if (confirm('确定解散此群组吗？所有数据将被清除。')) {
      await disbandGroup(groupId);
      showToast('群组已解散', 'success');
      closeModal();
      import('./groupListUI.js').then(m => m.renderGroupList());
    }
  });
}