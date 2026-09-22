// js/ui/screens/groupFormUI.js - 创建群组（已埋插件槽位）

import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { getAppState } from '../../core/state.js';
import { escapeHtml } from '../../core/utils.js';
import { createGroup, addGroupMember } from '../../modules/groupChat.js';
import { renderGroupList } from './groupListUI.js';
import { rescan } from '../../plugins/uiRuntime.js';

export function renderGroupForm() {
  const state = getAppState();
  const characters = state.get('characters') || [];

  // ★ XSS 修复：c.id / c.avatar / c.name 全部转义
  const memberOptionsHtml = characters.map(c => {
    const safeId = escapeHtml(c.id);
    const safeAvatar = escapeHtml(c.avatar || '');
    const safeName = escapeHtml(c.name);
    return `
      <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.9rem;">
        <input type="checkbox" class="member-checkbox" value="${safeId}">
        <img src="${safeAvatar}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">
        ${safeName}
      </label>
    `;
  }).join('');

  const html = `
    <button class="modal-close">&times;</button>
    <h3 class="modal-title"><i class="fas fa-users"></i> 创建群组</h3>
    <div class="group-form" data-plugin-slot="group-form">
      <!-- ★ 槽位：群组表单顶部 ★ -->
      <div data-plugin-slot="group-form-top" style="display:contents;"></div>

      <div class="form-group">
        <label>群名称</label>
        <input type="text" id="groupNameInput" placeholder="如：深夜咖啡馆">
      </div>
      <div class="form-group">
        <label>群头像</label>
        <div class="file-upload-wrapper">
          <input type="file" id="groupAvatarInput" accept="image/*">
          <label class="file-upload-label" for="groupAvatarInput">
            <i class="fas fa-cloud-upload-alt"></i>
            <span>选择头像</span>
            <span class="file-name" id="groupAvatarFileName">未选择</span>
          </label>
        </div>
        <img id="groupAvatarPreview" class="avatar-preview" style="display:none;">
      </div>
      <div class="form-group">
        <label>聊天背景</label>
        <div class="file-upload-wrapper">
          <input type="file" id="groupBgInput" accept="image/*">
          <label class="file-upload-label" for="groupBgInput">
            <i class="fas fa-cloud-upload-alt"></i>
            <span>选择背景</span>
            <span class="file-name" id="groupBgFileName">未选择</span>
          </label>
        </div>
        <img id="groupBgPreview" class="bg-preview" style="display:none;">
      </div>

      <!-- ★ 槽位：群组表单中部（插件可注入"群规则"等） ★ -->
      <div data-plugin-slot="group-form-middle" style="display:contents;"></div>

      <div class="form-group">
        <label>选择成员 (2-10人)</label>
        <div id="memberSelection" style="display:flex;flex-wrap:wrap;gap:0.5rem;">
          ${memberOptionsHtml}
        </div>
        <!-- ★ 槽位：成员选择器附加操作（插件可注入"按标签选人"） ★ -->
        <div data-plugin-slot="group-form-member-extras" style="display:contents;"></div>
      </div>

      <!-- ★ 槽位：群组表单底部（提交按钮之前） ★ -->
      <div data-plugin-slot="group-form-bottom" style="display:contents;"></div>

      <div class="worldbook-editor-actions">
        <button class="btn btn-secondary" id="groupFormCancel">取消</button>
        <button class="btn btn-primary" id="groupFormSubmit">创建群组</button>
      </div>
    </div>
  `;

  openModal(html);

  // 触发槽位扫描
  setTimeout(() => {
    try { rescan(); } catch (_) {}
  }, 50);

  // 头像预览
  const avatarInput = document.getElementById('groupAvatarInput');
  const avatarPreview = document.getElementById('groupAvatarPreview');
  const avatarName = document.getElementById('groupAvatarFileName');
  avatarInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      avatarName.textContent = file.name;
      const reader = new FileReader();
      reader.onload = (ev) => {
        avatarPreview.src = ev.target.result;
        avatarPreview.style.display = 'block';
      };
      reader.readAsDataURL(file);
    }
  });

  // 背景预览
  const bgInput = document.getElementById('groupBgInput');
  const bgPreview = document.getElementById('groupBgPreview');
  const bgName = document.getElementById('groupBgFileName');
  bgInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      bgName.textContent = file.name;
      const reader = new FileReader();
      reader.onload = (ev) => {
        bgPreview.src = ev.target.result;
        bgPreview.style.display = 'block';
      };
      reader.readAsDataURL(file);
    }
  });

  document.getElementById('groupFormCancel').addEventListener('click', closeModal);

  document.getElementById('groupFormSubmit').addEventListener('click', async () => {
    const name = document.getElementById('groupNameInput').value.trim();
    if (!name) { showToast('请输入群名称', 'warning'); return; }

    const checked = document.querySelectorAll('.member-checkbox:checked');
    const selectedIds = Array.from(checked).map(cb => cb.value);
    if (selectedIds.length < 2) {
      showToast('请至少选择2个角色', 'warning');
      return;
    }
    if (selectedIds.length > 10) {
      showToast('最多选择10个角色', 'warning');
      return;
    }

    const avatar = avatarPreview.src || '';
    const chatBg = bgPreview.src || '';

    try {
      const group = await createGroup(name, 'user', avatar, chatBg);
      for (const id of selectedIds) {
        await addGroupMember(group.id, id, 'character', 'member');
      }
      closeModal();
      showToast('群组创建成功', 'success');
      renderGroupList();
    } catch (err) {
      showToast('创建失败: ' + err.message, 'error');
    }
  });
}