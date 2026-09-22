// js/ui/screens/worldBookGroupEditor.js
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import {
  getDefaultGroup, addGroup, updateGroup,
  getAllRules, getAllGroups,
  addRuleToGroup, removeRuleFromGroup,
  getRule,
  updateRule,
} from '../../modules/worldBook.js';
import { escapeHtml } from '../../core/utils.js';
import {
  renderRuleSelector,
  renderGroupSelector, bindGroupSelector,
} from './worldBookComponents.js';
import { acquireEditLock, releaseEditLock } from './worldBookEditLock.js';


/**
 * 绑定规则选择器事件（带 cleanup）
 * @param {HTMLElement} container - 包含 .wb-rule-selector 的容器
 * @param {Function} onChange - (selectedIds) => void，用户选择规则时回调
 * @returns {Function} cleanup 函数，调用后移除所有监听器
 */
function bindRuleSelectorWithCleanup(container, onChange) {
  const selector = container.querySelector('.wb-rule-selector');
  if (!selector) return () => {};

  const tagsContainer = selector.querySelector('.wb-selector-tags');
  const dropdown = selector.querySelector('.wb-selector-dropdown');
  const searchInput = selector.querySelector('.wb-selector-search');
  const optionsContainer = selector.querySelector('.wb-selector-options');

  // ---- 事件处理器（具名，便于后续 removeEventListener） ----

  const onTagsClick = (e) => {
    if (e.target.closest('.wb-selector-tag-remove')) return;
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    if (dropdown.style.display === 'block') searchInput?.focus();
  };

  // 事件委托：即使 options 被重建，只要容器不变，点击依然生效
  const onOptionsClick = (e) => {
    const opt = e.target.closest('.wb-selector-option');
    if (!opt || !optionsContainer || !optionsContainer.contains(opt)) return;
    const id = opt.dataset.id;
    if (onChange) onChange([id]);
    dropdown.style.display = 'none';
  };

  const onSearchInput = () => {
    const query = (searchInput?.value || '').toLowerCase();
    optionsContainer?.querySelectorAll('.wb-selector-option').forEach(opt => {
      const name = opt.querySelector('.wb-selector-option-name')?.textContent?.toLowerCase() || '';
      const desc = opt.querySelector('.wb-selector-option-desc')?.textContent?.toLowerCase() || '';
      opt.style.display = name.includes(query) || desc.includes(query) ? '' : 'none';
    });
  };

  const onDocClick = (e) => {
    if (!selector.contains(e.target)) {
      if (dropdown) dropdown.style.display = 'none';
    }
  };

  // ---- 绑定 ----
  if (tagsContainer) tagsContainer.addEventListener('click', onTagsClick);
  if (optionsContainer) optionsContainer.addEventListener('click', onOptionsClick);
  if (searchInput) searchInput.addEventListener('input', onSearchInput);
  document.addEventListener('click', onDocClick);

  // ---- 返回 cleanup ----
  return function cleanup() {
    if (tagsContainer) tagsContainer.removeEventListener('click', onTagsClick);
    if (optionsContainer) optionsContainer.removeEventListener('click', onOptionsClick);
    if (searchInput) searchInput.removeEventListener('input', onSearchInput);
    document.removeEventListener('click', onDocClick);
  };
}

export async function openGroupEditor(groupData = null) {
  const isEdit = !!groupData;
  const data = groupData || getDefaultGroup();
  const allGroups = await getAllGroups();
  const allRules = await getAllRules();
  const groupRules = data.ruleIds || [];
  const rulesInGroup = allRules.filter(r => groupRules.includes(r.id));

  const html = `
    <button class="modal-close">&times;</button>
    <div class="worldbook-editor wb-group-settings">
      <h3>${isEdit ? '⚙️ 编辑规则组' : '📁 创建规则组'}</h3>
      ${isEdit ? `
        <div class="form-group">
          <label>组ID</label>
          <div style="display:flex;gap:0.5rem;align-items:center;">
            <input type="text" value="${escapeHtml(data.id)}" readonly style="flex:1;background:var(--color-bg-secondary);cursor:default;font-family:monospace;font-size:0.8rem;" />
            <button class="btn btn-sm" id="wb-copy-group-id-btn"><i class="fas fa-copy"></i> 复制</button>
          </div>
        </div>
      ` : ''}
      <div class="form-group">
        <label>组名称 <span style="color:var(--color-danger);">*</span></label>
        <input type="text" id="wb-group-name" value="${escapeHtml(data.name)}" placeholder="请输入组名称" />
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea id="wb-group-desc" placeholder="可选，描述组的用途">${escapeHtml(data.description || '')}</textarea>
      </div>
      <div class="form-group">
        <label><input type="checkbox" id="wb-group-enabled" ${data.enabled ? 'checked' : ''}> 启用此组</label>
      </div>
      <div class="form-group">
        <label>优先级</label>
        <input type="number" id="wb-group-priority" value="${data.priority}" min="0" max="999" />
      </div>
      <div class="form-group">
        <label>📋 组内规则 (<span id="wb-group-rule-count">${rulesInGroup.length}</span> 条)</label>
        <div id="wb-group-rules-container">
          <div class="wb-group-rule-list"></div>
        </div>
        <div style="margin-top:0.3rem;">
          <div id="wb-add-rule-selector-container"></div>
        </div>
        <span class="help-text">从下拉列表中选择规则添加到组中，点击标签上的 ✕ 移除</span>
      </div>
      <div class="form-group">
        <label>🔗 组间互斥</label>
        <div id="wb-group-exclusive-container">
          ${renderGroupSelector(allGroups, data.exclusiveGroup || null, '选择互斥组...')}
        </div>
      </div>
      <details>
        <summary>🔗 组级规则链</summary>
        <div class="form-group">
          <label>激活组（触发后激活）</label>
          <div id="wb-group-activate-container">
            ${renderGroupSelectorMulti(allGroups, data.onTrigger?.activateGroups || [])}
          </div>
        </div>
        <div class="form-group">
          <label>停用组（触发后停用）</label>
          <div id="wb-group-deactivate-container">
            ${renderGroupSelectorMulti(allGroups, data.onTrigger?.deactivateGroups || [])}
          </div>
        </div>
      </details>
      ${isEdit ? `
        <div class="form-group" style="border-top:1px solid var(--color-border);padding-top:1rem;margin-top:1rem;">
          <button class="btn btn-danger" id="wb-group-clear-rules">🗑️ 清空组内规则</button>
          <span class="help-text">仅移除组内规则关联，不删除规则本身</span>
        </div>
      ` : ''}
      <div class="worldbook-editor-actions">
        <button class="btn btn-secondary" id="wb-group-editor-cancel">取消</button>
        <button class="btn btn-primary" id="wb-group-editor-save">保存组</button>
      </div>
    </div>
  `;

  let _activeSelectorCleanup = null;
  const _groupSelectorCleanups = [];

  acquireEditLock();
  openModal(html, () => {
    releaseEditLock();
    if (_activeSelectorCleanup) {
      try { _activeSelectorCleanup(); } catch (_) {}
      _activeSelectorCleanup = null;
    }
    for (const fn of _groupSelectorCleanups) {
      try { fn(); } catch (_) {}
    }
    _groupSelectorCleanups.length = 0;
  });

  document.getElementById('wb-copy-group-id-btn')?.addEventListener('click', async () => {
    const idInput = document.querySelector('#modalContent input[readonly]');
    if (idInput) {
      await navigator.clipboard.writeText(idInput.value);
      showToast('已复制ID', 'success');
    }
  });

  const exclusiveContainer = document.getElementById('wb-group-exclusive-container');
  const exclusiveSelect = exclusiveContainer.querySelector('.wb-selector-select');
  if (exclusiveSelect) {
    exclusiveSelect.addEventListener('change', () => {
      exclusiveSelect.dataset.selectedId = exclusiveSelect.value || '';
    });
  }

  const activateContainer = document.getElementById('wb-group-activate-container');

  _groupSelectorCleanups.push(
    bindGroupSelectorMulti(activateContainer, (ids) => { activateContainer._selectedIds = ids; })
  );
  activateContainer._selectedIds = [...(data.onTrigger?.activateGroups || [])];

  const deactivateContainer = document.getElementById('wb-group-deactivate-container');

  _groupSelectorCleanups.push(
    bindGroupSelectorMulti(deactivateContainer, (ids) => { deactivateContainer._selectedIds = ids; })
  );
  deactivateContainer._selectedIds = [...(data.onTrigger?.deactivateGroups || [])];

  // ============================================================
  // 统一管理"组内规则列表 + 添加规则选择器"的状态
  // ============================================================

  const addRuleContainer = document.getElementById('wb-add-rule-selector-container');
  const ruleListEl = document.querySelector('.wb-group-rule-list');

  function refreshAddRuleSelector() {
    if (!addRuleContainer || !ruleListEl) return;

    if (_activeSelectorCleanup) {
      try { _activeSelectorCleanup(); } catch (_) {}
      _activeSelectorCleanup = null;
    }

    const addedIds = Array.from(ruleListEl.querySelectorAll('.wb-group-rule-tag'))
      .map(tag => tag.dataset.id);
    const availableRules = allRules.filter(r => r.enabled && !addedIds.includes(r.id));

    addRuleContainer.innerHTML = renderRuleSelector(availableRules, []);

    _activeSelectorCleanup = bindRuleSelectorWithCleanup(addRuleContainer, (ids) => {
      if (!ids || ids.length === 0) return;

      const currentIds = Array.from(ruleListEl.querySelectorAll('.wb-group-rule-tag'))
        .map(tag => tag.dataset.id);
      const newIds = [...new Set([...currentIds, ...ids])];

      updateRuleListUI(ruleListEl, newIds, allRules, refreshAddRuleSelector);
    });
  }

  // 初始化：一次性填充 ruleList（并触发 selector 首次渲染）
  updateRuleListUI(ruleListEl, data.ruleIds || [], allRules, refreshAddRuleSelector);

  // 清空按钮：也走 updateRuleListUI，统一刷新
  document.getElementById('wb-group-clear-rules')?.addEventListener('click', () => {
    if (confirm(`确定要清空组 "${data.name}" 中的所有规则吗？`)) {
      updateRuleListUI(ruleListEl, [], allRules, refreshAddRuleSelector);
      showToast('已清空组内规则', 'success');
    }
  });

  // ============================================================
  // 保存逻辑
  // ============================================================

  document.getElementById('wb-group-editor-save').addEventListener('click', async () => {
    const name = document.getElementById('wb-group-name').value.trim();
    if (!name) { showToast('请输入组名称', 'warning'); return; }

    const ruleList = document.querySelector('.wb-group-rule-list');
    const newRuleIds = Array.from(ruleList.querySelectorAll('.wb-group-rule-tag')).map(el => el.dataset.id);

    const exclusiveSelectEl = exclusiveContainer.querySelector('.wb-selector-select');
    const exclusiveGroup = exclusiveSelectEl ? (exclusiveSelectEl.value || null) : null;

    const activateIds = activateContainer._selectedIds || [];
    const deactivateIds = deactivateContainer._selectedIds || [];

    try {
      let targetGroupId;
      if (isEdit) {
        targetGroupId = data.id;
        const oldRuleIds = data.ruleIds || [];

        for (const ruleId of oldRuleIds) {
          if (!newRuleIds.includes(ruleId)) {
            await removeRuleFromGroup(data.id, ruleId);
          }
        }
        for (const ruleId of newRuleIds) {
          if (!oldRuleIds.includes(ruleId)) {
            await addRuleToGroup(data.id, ruleId);
          }
        }

        const groupData = {
          name,
          description: document.getElementById('wb-group-desc').value.trim(),
          enabled: document.getElementById('wb-group-enabled').checked,
          priority: parseInt(document.getElementById('wb-group-priority').value) || 50,
          ruleIds: newRuleIds,
          exclusiveGroup: exclusiveGroup,
          onTrigger: { activateGroups: activateIds, deactivateGroups: deactivateIds },
          parentGroupId: null,
        };
        await updateGroup(data.id, groupData);

        for (const ruleId of newRuleIds) {
          const rule = await getRule(ruleId);
          if (rule && rule.groupId !== data.id) {
            await updateRule(ruleId, { groupId: data.id });
          }
        }
        showToast('组已更新', 'success');
      } else {
        const groupData = {
          name,
          description: document.getElementById('wb-group-desc').value.trim(),
          enabled: document.getElementById('wb-group-enabled').checked,
          priority: parseInt(document.getElementById('wb-group-priority').value) || 50,
          ruleIds: newRuleIds,
          exclusiveGroup: exclusiveGroup,
          onTrigger: { activateGroups: activateIds, deactivateGroups: deactivateIds },
          parentGroupId: null,
        };
        const newGroup = await addGroup(groupData);
        targetGroupId = newGroup.id;

        for (const ruleId of newRuleIds) {
          await addRuleToGroup(newGroup.id, ruleId);
        }

        for (const ruleId of newRuleIds) {
          const rule = await getRule(ruleId);
          if (rule && rule.groupId !== newGroup.id) {
            await updateRule(ruleId, { groupId: newGroup.id });
          }
        }
        showToast('组已创建', 'success');
      }

      closeModal();
      import('./worldBookUI.js')
        .then(m => m.renderWorldBookList())
        .catch(err => console.warn('[WorldBookGroupEditor] 重开列表失败:', err));
    } catch (err) {
      console.error('[GroupEditor] 保存失败:', err);
      showToast('保存失败: ' + err.message, 'error');
    }
  });

  document.getElementById('wb-group-editor-cancel').addEventListener('click', closeModal);
}

/**
 * 渲染多选组选择器
 */
function renderGroupSelectorMulti(groups, selectedIds = []) {
  const availableGroups = groups.filter(g => g.enabled);
  const selectedGroups = availableGroups.filter(g => selectedIds.includes(g.id));
  const availableToSelect = availableGroups.filter(g => !selectedIds.includes(g.id));
  return `
    <div class="wb-selector wb-group-selector-multi" data-selector="group-multi">
      <div class="wb-selector-tags">
        ${selectedGroups.map(g => `
          <span class="wb-selector-tag" data-id="${escapeHtml(g.id)}">
            ${escapeHtml(g.name)}
            <button class="wb-selector-tag-remove" data-id="${escapeHtml(g.id)}">✕</button>
          </span>
        `).join('')}
        ${selectedGroups.length === 0 ? `<span class="wb-selector-placeholder">选择组...</span>` : ''}
      </div>
      <div class="wb-selector-dropdown" style="display:none;">
        <input class="wb-selector-search" placeholder="搜索组..." />
        <div class="wb-selector-options">
          ${availableToSelect.map(g => `
            <div class="wb-selector-option" data-id="${escapeHtml(g.id)}">
              <span class="wb-selector-option-name">${escapeHtml(g.name)}</span>
              <span class="wb-selector-option-desc">${g.ruleIds?.length || 0}条规则</span>
            </div>
          `).join('')}
          ${availableToSelect.length === 0 ? '<div class="wb-selector-empty">没有可用的组</div>' : ''}
        </div>
      </div>
    </div>
  `;
}

function bindGroupSelectorMulti(container, onChange) {
  const selector = container.querySelector('.wb-group-selector-multi');
  if (!selector) return () => {};

  selector._onChange = onChange;

  const tagsContainer = selector.querySelector('.wb-selector-tags');
  const dropdown = selector.querySelector('.wb-selector-dropdown');
  const searchInput = selector.querySelector('.wb-selector-search');
  const optionsContainer = selector.querySelector('.wb-selector-options');

  tagsContainer?.addEventListener('click', (e) => {
    if (e.target.closest('.wb-selector-tag-remove')) return;
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    if (dropdown.style.display === 'block') searchInput?.focus();
  });

  selector.querySelectorAll('.wb-selector-tag-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const currentIds = getSelectedIdsMulti(selector);
      const newIds = currentIds.filter(i => i !== id);
      updateSelectorStateMulti(selector, newIds);
      if (onChange) onChange(newIds);
    });
  });

  optionsContainer?.querySelectorAll('.wb-selector-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const id = opt.dataset.id;
      const currentIds = getSelectedIdsMulti(selector);
      if (!currentIds.includes(id)) {
        const newIds = [...currentIds, id];
        updateSelectorStateMulti(selector, newIds);
        if (onChange) onChange(newIds);
      }
      dropdown.style.display = 'none';
    });
  });

  searchInput?.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase();
    optionsContainer?.querySelectorAll('.wb-selector-option').forEach(opt => {
      const name = opt.querySelector('.wb-selector-option-name')?.textContent?.toLowerCase() || '';
      const desc = opt.querySelector('.wb-selector-option-desc')?.textContent?.toLowerCase() || '';
      opt.style.display = name.includes(query) || desc.includes(query) ? '' : 'none';
    });
  });

  const onDocClick = (e) => {
    if (!selector.contains(e.target)) dropdown.style.display = 'none';
  };
  document.addEventListener('click', onDocClick);

  return function cleanup() {
    document.removeEventListener('click', onDocClick);
  };
}

function getSelectedIdsMulti(selector) {
  const tags = selector.querySelectorAll('.wb-selector-tag');
  return Array.from(tags).map(tag => tag.dataset.id);
}

/**
 * 更新多选组选择器的状态
 */
function updateSelectorStateMulti(selector, selectedIds) {
  const optionsContainer = selector.querySelector('.wb-selector-options');

  const optionMap = {};
  optionsContainer?.querySelectorAll('.wb-selector-option').forEach(opt => {
    optionMap[opt.dataset.id] = opt.querySelector('.wb-selector-option-name')?.textContent || opt.dataset.id;
  });

  const tagsContainer = selector.querySelector('.wb-selector-tags');
  tagsContainer.innerHTML = `
    ${selectedIds.map(id => `
      <span class="wb-selector-tag" data-id="${escapeHtml(id)}">
        ${escapeHtml(optionMap[id] || id)}
        <button class="wb-selector-tag-remove" data-id="${escapeHtml(id)}">✕</button>
      </span>
    `).join('')}
    ${selectedIds.length === 0 ? `<span class="wb-selector-placeholder">选择组...</span>` : ''}
  `;

  tagsContainer.querySelectorAll('.wb-selector-tag-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const currentIds = getSelectedIdsMulti(selector);
      const newIds = currentIds.filter(i => i !== id);
      updateSelectorStateMulti(selector, newIds);
      const onChange = selector._onChange;
      if (onChange) onChange(newIds);
    });
  });

  optionsContainer?.querySelectorAll('.wb-selector-option').forEach(opt => {
    opt.style.display = selectedIds.includes(opt.dataset.id) ? 'none' : '';
  });
}

/**
 * 更新组内规则列表
 *
 * @param {HTMLElement} ruleList - ruleList DOM 容器
 * @param {string[]} ruleIds - 当前组内的规则 ID 数组
 * @param {Object[]} allRules - 全部规则（用于查找规则名）
 * @param {Function} [onChange] - DOM 更新完成后的回调（无参数）
 */
function updateRuleListUI(ruleList, ruleIds, allRules, onChange = null) {
  if (!ruleList) return;

  const rules = allRules.filter(r => ruleIds.includes(r.id));
  ruleList.innerHTML = `
    ${rules.map(rule => `
      <span class="wb-group-rule-tag" data-id="${escapeHtml(rule.id)}">
        ${escapeHtml(rule.name)}
        <span class="remove" data-action="remove-rule-from-group" data-id="${escapeHtml(rule.id)}">✕</span>
      </span>
    `).join('')}
    ${rules.length === 0 ? `<span style="color:var(--color-text-muted);font-size:0.85rem;">暂无规则</span>` : ''}
  `;

  const countEl = document.getElementById('wb-group-rule-count');
  if (countEl) countEl.textContent = String(rules.length);

  ruleList.querySelectorAll('[data-action="remove-rule-from-group"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.id;
      const currentIds = Array.from(ruleList.querySelectorAll('.wb-group-rule-tag')).map(tag => tag.dataset.id);
      const newIds = currentIds.filter(i => i !== id);
      updateRuleListUI(ruleList, newIds, allRules, onChange);
    });
  });

  if (typeof onChange === 'function') {
    onChange();
  }
}