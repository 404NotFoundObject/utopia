// js/ui/screens/groupListUI.js - 群组列表渲染（已埋插件槽位）
import { getAppState } from '../../core/state.js';
import { escapeHtml } from '../../core/utils.js';
import { getGroupsByUser, getGroup } from '../../modules/groupChat.js';
import { openGroupChat } from './groupChatUI.js';
import { renderGroupForm } from './groupFormUI.js';
import { rescan } from '../../plugins/uiRuntime.js';


let _lastGroupSignature = null;

function hashString(str) {
  if (!str) return 0;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function computeGroupSignature(groups, currentGroupId) {
  if (!groups || groups.length === 0) {
    return `empty|${currentGroupId || ''}`;
  }
  const parts = new Array(groups.length);
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const avatar = g.avatar || '';
    const desc = g.description || '';
    parts[i] =
      g.id + '|' +
      (g.name || '') + '|' +
      hashString(avatar) + '|' + avatar.length + '|' +
      hashString(desc) + '|' + desc.length + '|' +
      (g.id === currentGroupId ? '1' : '0');
  }
  return parts.join('\n');
}

export function invalidateGroupListCache() {
  _lastGroupSignature = null;
}

// ============================================================
// 主渲染
// ============================================================
export async function renderGroupList() {
  const state = getAppState();
  const userId = 'user';
  const groups = await getGroupsByUser(userId);
  const container = document.getElementById('characterList');
  if (!container) return;

  const currentGroupId = state.get('currentGroupId');

  const signature = computeGroupSignature(groups, currentGroupId);
  if (signature === _lastGroupSignature) {
    return;
  }
  _lastGroupSignature = signature;

  state.set('groups', groups);

  const existingGroups = container.querySelectorAll('.group-item');
  for (const el of existingGroups) el.remove();

  if (groups.length === 0) return;

  // ★ XSS 修复：group.id / avatar / name / description 全部转义
  const html = groups.map(group => {
    const safeId = escapeHtml(group.id);
    const safeName = escapeHtml(group.name);
    const safeDesc = escapeHtml(group.description || '点击进入群聊');
    const safeAvatar = escapeHtml(
      group.avatar ||
      'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'36\' height=\'36\' viewBox=\'0 0 36 36\'%3E%3Ccircle cx=\'18\' cy=\'18\' r=\'18\' fill=\'%236c5ce7\'/%3E%3Ctext x=\'18\' y=\'24\' text-anchor=\'middle\' fill=\'%23fff\' font-size=\'14\' font-family=\'sans-serif\'%3E👥%3C/text%3E%3C/svg%3E'
    );
    return `
    <li class="character-item group-item ${group.id === currentGroupId ? 'active' : ''}"
        data-id="${safeId}"
        data-type="group"
        data-group-id="${safeId}"
        data-plugin-slot="group-item">
      <img class="avatar" src="${safeAvatar}" alt="${safeName}">
      <div class="info">
        <div class="name-row">
          <span class="name">${safeName}</span>
          <span class="group-tag">群组</span>
        </div>
        <div class="desc">${safeDesc}</div>
      </div>
      <div class="item-actions">
        <button class="enter-btn icon-btn" data-id="${safeId}" title="进入群聊"><i class="fas fa-sign-in-alt"></i></button>
        <button class="settings-btn icon-btn" data-id="${safeId}" title="管理群组"><i class="fas fa-cog"></i></button>
        <div data-plugin-slot="group-item-actions" data-group-id="${safeId}" style="display:contents;"></div>
      </div>
    </li>
  `;
  }).join('');

  container.insertAdjacentHTML('beforeend', html);

  container.querySelectorAll('.group-item .enter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      openGroupChat(id);
    });
  });

  container.querySelectorAll('.group-item .settings-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      import('./groupSettingsUI.js').then(m => m.openGroupSettings(id));
    });
  });

  container.querySelectorAll('.group-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      openGroupChat(id);
    });
  });

  try { rescan(); } catch (_) {}
}

export function renderCreateGroupButton() {
  const btn = document.getElementById('createGroupBtn');
  if (btn) {
    const newBtn = btn.cloneNode(true);
    btn.parentNode?.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', () => renderGroupForm());
  }
}

export async function getGroupName(groupId) {
  const group = await getGroup(groupId);
  return group?.name || null;
}

export function updateGroupHighlight(selectedId) {
  const list = document.getElementById('characterList');
  if (!list) return;
  const items = list.querySelectorAll('.group-item');
  for (const el of items) {
    if (el.dataset.id === selectedId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  }
}