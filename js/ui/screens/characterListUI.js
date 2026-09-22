// js/ui/screens/characterListUI.js - 角色列表渲染（已埋插件槽位）
import { getAppState } from '../../core/state.js';
import { escapeHtml } from '../../core/utils.js';
import { selectCharacter, deleteCharacter, exportCharacter, updateCharacter } from '../../modules/character.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { renderCharacterForm } from './characterFormUI.js';
import { renderGroupList } from './groupListUI.js';
import globalEventBus from '../../core/eventBus.js';


let _lastSignature = null;


function hashString(str) {
  if (!str) return 0;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function computeListSignature(chars, currentId) {
  if (!chars || chars.length === 0) {
    return `empty|${currentId || ''}`;
  }
  const parts = new Array(chars.length);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const avatar = c.avatar || '';
    const desc = c.description || '';
    parts[i] =
      c.id + '|' +
      (c.name || '') + '|' +
      hashString(avatar) + '|' + avatar.length + '|' +
      hashString(desc) + '|' + desc.length + '|' +
      (c.unreadProactiveType || '') + '|' +
      (c.id === currentId ? '1' : '0');
  }
  return parts.join('\n');
}

// ============================================================
// 主渲染
// ============================================================
export async function renderCharacterList() {
  const state = getAppState();
  const chars = state.get('characters');
  const currentId = state.get('currentCharacterId');

  const signature = computeListSignature(chars, currentId);
  if (signature === _lastSignature) {
    return;
  }

  const list = document.getElementById('characterList');
  if (!list) return;

  _lastSignature = signature;

  const roleItems = list.querySelectorAll('.character-item:not(.group-item)');
  for (const el of roleItems) el.remove();

  const placeholders = list.querySelectorAll('.empty-placeholder');
  for (const el of placeholders) el.remove();

  if (!chars || chars.length === 0) {
    const hasGroup = list.querySelector('.group-item');
    const placeholder = document.createElement('li');
    placeholder.className = 'empty-placeholder';
    placeholder.style.cssText = 'padding:1rem;text-align:center;color:var(--color-text-muted);';
    placeholder.textContent = '暂无角色，请创建或导入';
    const emptySlot = document.createElement('div');
    emptySlot.dataset.pluginSlot = 'character-list-empty';
    emptySlot.style.display = 'contents';
    placeholder.appendChild(emptySlot);
    if (hasGroup) {
      const lastGroup = list.querySelector('.group-item:last-child');
      lastGroup.after(placeholder);
    } else {
      list.appendChild(placeholder);
    }
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const char of chars) {
    let unreadTag = '';
    if (char.unreadProactiveMessage) {
      const icon = char.unreadProactiveType === 'voice' ? '📞' : '💬';
      const label = char.unreadProactiveType === 'voice' ? '来电' : '消息';
      unreadTag = `<span class="proactive-tag" style="display:inline-block;background:var(--color-primary);color:#fff;font-size:0.55rem;font-weight:600;padding:0.05rem 0.5rem;border-radius:var(--radius-full);margin-left:0.3rem;text-transform:uppercase;border:1px solid rgba(255,255,255,0.15);">${icon} ${label}</span>`;
    }

    const safeId = escapeHtml(char.id);
    const safeName = escapeHtml(char.name);
    const safeDesc = escapeHtml(char.description || '无简介');
    const safeAvatar = escapeHtml(
      char.avatar ||
      'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'36\' height=\'36\' viewBox=\'0 0 36 36\'%3E%3Ccircle cx=\'18\' cy=\'18\' r=\'18\' fill=\'%23e0e0e6\'/%3E%3Ctext x=\'18\' y=\'24\' text-anchor=\'middle\' fill=\'%238a8aaa\' font-size=\'14\' font-family=\'sans-serif\'%3E?%3C/text%3E%3C/svg%3E'
    );

    const li = document.createElement('li');
    li.className = `character-item${char.id === currentId ? ' active' : ''}`;
    li.dataset.id = char.id;
    li.dataset.characterId = char.id;
    li.dataset.pluginSlot = 'character-item';

    li.innerHTML = `
      <img class="avatar" src="${safeAvatar}" alt="${safeName}">
      <div class="info">
        <div class="name">${safeName} ${unreadTag}</div>
        <div class="desc">${safeDesc}</div>
      </div>
      <div class="item-actions">
        <button class="edit-btn icon-btn" data-id="${safeId}" title="编辑"><i class="fas fa-edit"></i></button>
        <button class="export-btn icon-btn" data-id="${safeId}" title="导出"><i class="fas fa-download"></i></button>
        <button class="delete-btn icon-btn" data-id="${safeId}" title="删除"><i class="fas fa-times"></i></button>
        <div data-plugin-slot="character-item-actions" data-character-id="${safeId}" style="display:contents;"></div>
      </div>
    `;
    fragment.appendChild(li);

    li.addEventListener('click', async (e) => {
      if (e.target.closest('.item-actions')) return;
      const id = li.dataset.id;
      const charData = chars.find(c => c.id === id);
      if (charData && charData.unreadProactiveMessage) {
        await updateCharacter(id, { unreadProactiveMessage: null, unreadProactiveType: null });
        renderCharacterList();
      }
      await selectCharacter(id);
      localStorage.setItem('lastCharacterId', id);
    });

    li.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      renderCharacterForm(char);
    });

    li.querySelector('.export-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const format = await showExportFormatDialog(char);
      if (!format) return;
      if (format === 'png') {
        const { openPNGExport } = await import('./characterExportUI.js');
        openPNGExport(char);
        return;
      }
      try {
        const json = await exportCharacter(char.id, format);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${char.name}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('角色导出成功', 'success');
      } catch (err) {
        showToast('导出失败: ' + err.message, 'error');
      }
    });

    li.querySelector('.delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`确定要删除角色 "${char.name}" 及其所有会话吗？`)) {
        await deleteCharacter(char.id);
        renderCharacterList();
      }
    });
  }

  list.appendChild(fragment);

  try {
    const { rescan } = await import('../../plugins/uiRuntime.js');
    rescan();
  } catch (_) {}
}

// ============================================================
// 强制重渲染（用于外部明确要求刷新时）
// ============================================================
// 场景：
//   - 导入插件动态改变 DOM 结构
//   - 主题切换后需要重置缓存
// 大部分场景不需要显式调用。
// ============================================================
export function invalidateCharacterListCache() {
  _lastSignature = null;
}

export function updateCharacterHighlight(selectedId) {
  const list = document.getElementById('characterList');
  if (!list) return;
  const items = list.querySelectorAll('.character-item:not(.group-item)');
  for (const el of items) {
    if (el.dataset.id === selectedId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  }
}

/**
 * 显示导出格式选择对话框
 *
 * @param {Object|null} char
 * @returns {Promise<string|null>} 选中的格式，或 null（取消/关闭）
 */
async function showExportFormatDialog(char = null) {
  return new Promise((resolve) => {
    const charName = char ? char.name : '角色';
    // ★ XSS 修复：角色名转义
    const safeCharName = escapeHtml(charName);

    // ---- 结果保护：防止重复 resolve ----
    let settled = false;
    const safeResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    // ---- 用户意图：默认 null（等价于取消） ----
    // 点"确定"时置为选中的格式；点 X / 遮罩时保持 null
    let pendingValue = null;

    const html = `
      <button class="modal-close">&times;</button>
      <h3 class="modal-title">导出 "${safeCharName}"</h3>
      <div class="form-group" style="margin: 1rem 0;">
        <label style="display:block;margin-bottom:0.5rem;padding:0.3rem 0.5rem;border-radius:var(--radius-sm);cursor:pointer;background:var(--color-primary-light);color:var(--color-primary-dark);">
          <input type="radio" name="exportFormat" value="png" checked>
          <strong>🖼️ PNG 卡</strong>（可通过卡片重新导入角色）
        </label>
        <label style="display:block;margin-bottom:0.5rem;padding:0.3rem 0.5rem;border-radius:var(--radius-sm);cursor:pointer;">
          <input type="radio" name="exportFormat" value="utopia-v3.1">
          <strong>Utopia v3.1</strong>（推荐，更兼容Utopia）
        </label>
        <label style="display:block;margin-bottom:0.5rem;padding:0.3rem 0.5rem;border-radius:var(--radius-sm);cursor:pointer;">
          <input type="radio" name="exportFormat" value="utopia-v3">
          <strong>Utopia v3</strong>
        </label>
        <label style="display:block;margin-bottom:0.5rem;padding:0.3rem 0.5rem;border-radius:var(--radius-sm);cursor:pointer;">
          <input type="radio" name="exportFormat" value="st-v3">
          SillyTavern v3
        </label>
        <label style="display:block;margin-bottom:0.5rem;padding:0.3rem 0.5rem;border-radius:var(--radius-sm);cursor:pointer;">
          <input type="radio" name="exportFormat" value="st-v2">
          SillyTavern v2
        </label>
        <label style="display:block;padding:0.3rem 0.5rem;border-radius:var(--radius-sm);cursor:pointer;">
          <input type="radio" name="exportFormat" value="generic">
          通用格式
        </label>
      </div>
      <div class="worldbook-editor-actions">
        <button class="btn btn-secondary" id="exportCancelBtn">取消</button>
        <button class="btn btn-primary" id="exportConfirmBtn">确定导出</button>
      </div>
    `;

    openModal(html, () => {
      safeResolve(pendingValue);
    });

    const modalContent = document.getElementById('modalContent');
    if (!modalContent) {
      try { closeModal(); } catch (_) {
        safeResolve(null);
      }
      return;
    }

    // 单选标签高亮
    modalContent.querySelectorAll('label').forEach(label => {
      label.addEventListener('click', () => {
        modalContent.querySelectorAll('label').forEach(l => {
          l.style.background = '';
          l.style.color = '';
        });
        label.style.background = 'var(--color-primary-light)';
        label.style.color = 'var(--color-primary-dark)';
      });
    });

    // 确定：先设置 pendingValue，再 closeModal
    // closeModal 触发 onClose → safeResolve(pendingValue)
    const confirmBtn = modalContent.querySelector('#exportConfirmBtn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const selected = modalContent.querySelector('input[name="exportFormat"]:checked');
        pendingValue = selected ? selected.value : 'utopia-v3.1';
        closeModal();
      });
    }

    // 取消：pendingValue 保持默认 null，closeModal 触发 onClose → safeResolve(null)
    const cancelBtn = modalContent.querySelector('#exportCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        closeModal();
      });
    }
  });
}

export function initCharacterListSubscription() {
  const state = getAppState();

  state.subscribe('characters', () => {
    renderCharacterList();
  });

  globalEventBus.on('proactive:new', () => {
    renderCharacterList();
  });
}