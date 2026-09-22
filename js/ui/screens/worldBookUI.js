// js/ui/screens/worldBookUI.js
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { getAppState } from '../../core/state.js';
import { escapeHtml } from '../../core/utils.js';
import { getGroupsByUser } from '../../modules/groupChat.js';
import {
  getAllRules, getRule, toggleRule, deleteRule,
  getAllGroups, getGroup, toggleGroup, deleteGroup,
  getGroupRules, getRulesByGroup,
  getAvailableRulesForSelector, getAvailableGroupsForSelector,
  exportRules, importRules, exportGroups, importGroups,
  getConditionDescription, migrateWorldBookData
} from '../../modules/worldBook.js';
import { openRuleEditor } from './worldBookEditor.js';
import { openGroupEditor } from './worldBookGroupEditor.js';
import { isEditLocked } from './worldBookEditLock.js';
import globalEventBus from '../../core/eventBus.js';
import { rescan } from '../../plugins/uiRuntime.js';

const RULE_TYPE_BADGES = {
  conditional: { icon: '', label: '条件', color: 'var(--color-primary)' },
  constant: { icon: '📌', label: '常驻', color: 'var(--color-secondary)' },
  semantic: { icon: '🧠', label: '语义', color: 'var(--color-accent, #6c5ce7)' },
  sticky: { icon: '📎', label: '粘性', color: 'var(--color-warning)' },
};

export async function renderWorldBookList() {
  await migrateWorldBookData();
  const rules = await getAllRules();
  const groups = await getAllGroups();
  const chatGroups = await getGroupsByUser('user');

  const html = `
    <button class="modal-close">&times;</button>
    <div class="worldbook-container">
      <div class="worldbook-header" data-plugin-slot="worldbook-header">
        <h2>📖 世界书</h2>
        <div class="worldbook-actions">
          <input type="text" id="wbSearchInput" placeholder="搜索规则或组..." />
          <select id="wbFilterScope">
            <option value="all">所有作用域</option>
            <option value="global">全局</option>
            <option value="character">角色</option>
            <option value="group">群组</option>
          </select>
          <select id="wbFilterType">
            <option value="all">所有类型</option>
            <option value="conditional">条件触发</option>
            <option value="constant">常驻注入</option>
            <option value="semantic">语义触发</option>
            <option value="sticky">粘性</option>
          </select>
          <div data-plugin-slot="worldbook-toolbar" style="display:contents;"></div>
          <button class="btn btn-sm" id="wbTutorialBtn">📖 教程</button>
          <button class="btn btn-sm" id="wbImportBtn">📥 导入</button>
          <button class="btn btn-sm" id="wbExportBtn">📤 导出</button>
          <button class="btn btn-sm" id="wbSyncVectorsBtn" title="同步语义规则的向量">🧠 同步向量</button>
          <button class="btn btn-sm btn-primary" id="wbAddGroupBtn">+ 创建组</button>
          <button class="btn btn-sm btn-primary" id="wbAddRuleBtn">+ 创建规则</button>
        </div>
      </div>
      <div id="wbContent">
        ${renderGroupTree(groups, rules, chatGroups)}
      </div>
      <div data-plugin-slot="worldbook-footer" style="display:contents;"></div>
    </div>
  `;

  openModal(html);
  bindEvents(groups, rules, chatGroups);

  setTimeout(() => {
    try { rescan(); } catch (_) {}
  }, 50);
}

function renderGroupTree(groups, rules, chatGroups) {
  if (groups.length === 0 && rules.length === 0) {
    return `
      <div class="wb-empty">
        <div class="wb-empty-icon">📭</div>
        <div class="wb-empty-text">暂无规则或组，点击"创建组"或"创建规则"开始</div>
      </div>
    `;
  }

  const ungroupedRules = rules.filter(r => !r.groupId);
  let html = '<div class="wb-group-tree">';

  for (const group of groups) {
    const groupRules = rules.filter(r => r.groupId === group.id);
    const isExpanded = localStorage.getItem(`wb_group_${group.id}_expanded`) !== 'false';
    const safeGroupId = escapeHtml(group.id);
    const safeGroupName = escapeHtml(group.name);

    html += `
      <div class="wb-group-node" data-group-id="${safeGroupId}" data-plugin-slot="worldbook-group">
        <div class="wb-group-header" data-action="toggle-group">
          <span class="wb-group-toggle ${isExpanded ? 'expanded' : ''}">▶</span>
          <span class="wb-group-icon">📁</span>
          <span class="wb-group-name">${safeGroupName}</span>
          <span class="wb-group-status ${group.enabled ? 'enabled' : 'disabled'}">
            ${group.enabled ? '启用' : '禁用'}
          </span>
          <span class="wb-group-count">${groupRules.length} 条规则</span>
          <div class="wb-group-actions">
            <button class="icon-btn" data-action="toggle-group-status" data-id="${safeGroupId}" title="切换启用状态">
              <i class="fas ${group.enabled ? 'fa-pause' : 'fa-play'}"></i>
            </button>
            <button class="icon-btn" data-action="edit-group" data-id="${safeGroupId}" title="编辑组">
              <i class="fas fa-edit"></i>
            </button>
            <button class="icon-btn delete-btn" data-action="delete-group" data-id="${safeGroupId}" title="删除组">
              <i class="fas fa-trash"></i>
            </button>
            <div data-plugin-slot="worldbook-group-actions" data-group-id="${safeGroupId}" style="display:contents;"></div>
          </div>
        </div>
        <div class="wb-group-body ${isExpanded ? 'expanded' : ''}">
          ${renderGroupRules(groupRules, chatGroups)}
        </div>
      </div>
    `;
  }

  if (ungroupedRules.length > 0) {
    html += `
      <div class="wb-group-node" data-plugin-slot="worldbook-group">
        <div class="wb-group-header" style="cursor:default;background:var(--color-bg-secondary);">
          <span class="wb-group-icon">📄</span>
          <span class="wb-group-name" style="color:var(--color-text-muted);">未分组规则</span>
          <span class="wb-group-count">${ungroupedRules.length} 条规则</span>
        </div>
        <div class="wb-group-body expanded">
          ${renderGroupRules(ungroupedRules, chatGroups)}
        </div>
      </div>
    `;
  }

  html += '</div>';
  return html;
}

function renderGroupRules(rules, chatGroups) {
  if (rules.length === 0) {
    return `<div class="wb-empty-text" style="padding:0.5rem;color:var(--color-text-muted);font-size:0.85rem;">此组暂无规则</div>`;
  }
  return `
    <div class="wb-group-rules">
      ${rules.map(rule => renderRuleItem(rule, chatGroups)).join('')}
    </div>
  `;
}

function renderRuleItem(rule, chatGroups) {
  const state = getAppState();
  const characters = state.get('characters') || [];
  const statusIcon = rule.enabled ? '🟢' : '🔴';
  const conditionDesc = getConditionDescription(rule.condition);

  const typeBadge = RULE_TYPE_BADGES[rule.type] || RULE_TYPE_BADGES.conditional;
  const typeBadgeHtml = typeBadge.icon
    ? `<span class="wb-rule-type" style="color:${typeBadge.color};font-size:0.75rem;margin-right:0.3rem;" title="${escapeHtml(typeBadge.label)}">${typeBadge.icon}</span>`
    : '';

  let semanticInfo = '';
  if (rule.type === 'semantic' && rule.semanticQuery) {
    const thresholdText = rule.semanticThreshold != null
      ? `阈值 ${rule.semanticThreshold}`
      : '默认阈值';
    const vectorStatus = rule.vector
      ? '<span style="color:var(--color-success);">已生成</span>'
      : '<span style="color:var(--color-danger);">未生成</span>';
    semanticInfo = `
      <span class="wb-rule-semantic" style="font-size:0.7rem;color:var(--color-text-muted);margin-left:0.3rem;">
        🧠 ${escapeHtml(thresholdText)} · 向量${vectorStatus}
      </span>
    `;
  }

  let scopeLabel = rule.scope === 'global' ? '🌍 全局' : rule.scope;
  if (rule.scope.startsWith('character:')) {
    const charId = rule.scope.split(':')[1];
    const char = characters.find(c => c.id === charId);
    const charName = char ? char.name : charId;
    scopeLabel = `👤 ${charName}`;
  } else if (rule.scope.startsWith('group:')) {
    const groupId = rule.scope.split(':')[1];
    const group = chatGroups.find(g => g.id === groupId);
    const groupName = group ? group.name : groupId;
    scopeLabel = `👥 ${groupName}`;
  }

  const desc = rule.description
    ? (rule.description.length > 40 ? rule.description.slice(0, 40) + '...' : rule.description)
    : '';

  let conditionDisplay = conditionDesc;
  if (rule.type === 'semantic' && rule.semanticQuery) {
    conditionDisplay = `语义: ${rule.semanticQuery}`;
  } else if (rule.type === 'constant') {
    conditionDisplay = '每轮都注入';
  }

  const safeRuleId = escapeHtml(rule.id);
  const safeRuleType = escapeHtml(rule.type || 'conditional');
  const safeRuleName = escapeHtml(rule.name);
  const safeScopeLabel = escapeHtml(scopeLabel);
  const safeDesc = escapeHtml(desc);
  const safeDescriptionFull = escapeHtml(rule.description || '');
  const safeConditionDisplay = escapeHtml(conditionDisplay);
  const conditionPreview = conditionDisplay.length > 30
    ? conditionDisplay.slice(0, 30) + '...'
    : conditionDisplay;
  const safeConditionPreview = escapeHtml(conditionPreview);

  return `
    <div class="wb-rule-item ${rule.enabled ? '' : 'disabled'}" data-rule-id="${safeRuleId}" data-rule-type="${safeRuleType}" data-plugin-slot="worldbook-rule">
      <span class="wb-rule-status">${statusIcon}</span>
      ${typeBadgeHtml}
      <span class="wb-rule-name">${safeRuleName}</span>
      <span class="wb-rule-scope">${safeScopeLabel}</span>
      <span class="wb-rule-desc" title="${safeDescriptionFull}">${safeDesc}</span>
      <span class="wb-rule-condition" title="${safeConditionDisplay}">${safeConditionPreview}</span>
      ${semanticInfo}
      <div class="wb-rule-actions">
        <button class="icon-btn" data-action="toggle-rule-status" data-id="${safeRuleId}" title="切换启用状态">
          <i class="fas ${rule.enabled ? 'fa-pause' : 'fa-play'}"></i>
        </button>
        <button class="icon-btn" data-action="edit-rule" data-id="${safeRuleId}" title="编辑规则">
          <i class="fas fa-edit"></i>
        </button>
        <button class="icon-btn" data-action="duplicate-rule" data-id="${safeRuleId}" title="复制规则">
          <i class="fas fa-copy"></i>
        </button>
        <button class="icon-btn delete-btn" data-action="delete-rule" data-id="${safeRuleId}" title="删除规则">
          <i class="fas fa-trash"></i>
        </button>
        <div data-plugin-slot="worldbook-rule-actions" data-rule-id="${safeRuleId}" style="display:contents;"></div>
      </div>
    </div>
  `;
}

function bindEvents(groups, rules, chatGroups) {
  document.getElementById('wbTutorialBtn').addEventListener('click', () => {
    import('./worldBookHelp.js').then(m => {
      const tutorialHtml = m.renderWorldBookTutorial();
      openModal(tutorialHtml);
    });
  });

  document.getElementById('wbAddGroupBtn').addEventListener('click', () => {
    openGroupEditor();
  });

  document.getElementById('wbAddRuleBtn').addEventListener('click', () => {
    openRuleEditor();
  });

  document.getElementById('wbImportBtn').addEventListener('click', handleImport);
  document.getElementById('wbExportBtn').addEventListener('click', handleExport);

  const syncBtn = document.getElementById('wbSyncVectorsBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      const originalText = syncBtn.innerHTML;
      syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 同步中...';
      try {
        const { syncWorldBookVectors } = await import('../../modules/worldBook.js');
        const result = await syncWorldBookVectors();
        if (result.updated === 0 && result.skipped === 0) {
          if (result.editedDuringSync > 0) {
            showToast(`✅ 同步完成：编辑跳过 ${result.editedDuringSync}`, 'success');
            renderWorldBookList();
          } else {
            showToast('⚠️ 无语义规则，或语义引擎未就绪', 'warning');
          }
        } else {
          const editPart = result.editedDuringSync > 0 ? `，编辑跳过 ${result.editedDuringSync}` : '';
          showToast(`✅ 同步完成：更新 ${result.updated}，跳过 ${result.skipped}${editPart}`, 'success');
          renderWorldBookList();
        }
      } catch (err) {
        showToast('❌ 同步失败: ' + err.message, 'error');
      } finally {
        syncBtn.disabled = false;
        syncBtn.innerHTML = originalText;
      }
    });
  }

  document.getElementById('wbSearchInput').addEventListener('input', filterContent);
  document.getElementById('wbFilterScope').addEventListener('change', filterContent);
  const typeFilter = document.getElementById('wbFilterType');
  if (typeFilter) typeFilter.addEventListener('change', filterContent);

  document.querySelector('#wbContent').addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;

    switch (action) {
      case 'toggle-group': {
        const header = target.closest('.wb-group-header');
        const body = header.nextElementSibling;
        const toggle = header.querySelector('.wb-group-toggle');
        const isExpanded = body.classList.toggle('expanded');
        toggle.classList.toggle('expanded', isExpanded);
        localStorage.setItem(`wb_group_${header.closest('.wb-group-node').dataset.groupId}_expanded`, String(isExpanded));
        break;
      }
      case 'toggle-group-status': {
        if (!id) return;
        await toggleGroup(id);
        renderWorldBookList();
        showToast('组状态已切换', 'success');
        break;
      }
      case 'edit-group': {
        if (!id) return;
        const group = await getGroup(id);
        openGroupEditor(group);
        break;
      }
      case 'delete-group': {
        if (!id) return;
        const group = await getGroup(id);
        if (confirm(`确定要删除组 "${group.name}" 及其所有规则吗？`)) {
          await deleteGroup(id);
          renderWorldBookList();
          showToast('组已删除', 'success');
        }
        break;
      }
      case 'toggle-rule-status': {
        if (!id) return;
        await toggleRule(id);
        renderWorldBookList();
        showToast('规则状态已切换', 'success');
        break;
      }
      case 'edit-rule': {
        if (!id) return;
        const rule = await getRule(id);
        openRuleEditor(rule);
        break;
      }
      case 'duplicate-rule': {
        if (!id) return;
        const rule = await getRule(id);
        const newRule = {
          ...rule,
          id: undefined,
          name: rule.name + ' (副本)',
          createdAt: undefined,
          updatedAt: undefined,
          groupId: rule.groupId || null,
          vector: null,
          vectorModel: null,
        };
        const { addRule } = await import('../../modules/worldBook.js');
        await addRule(newRule);
        renderWorldBookList();
        showToast('规则已复制', 'success');
        break;
      }
      case 'delete-rule': {
        if (!id) return;
        const rule = await getRule(id);
        if (confirm(`确定要删除规则 "${rule.name}" 吗？`)) {
          await deleteRule(id);
          renderWorldBookList();
          showToast('规则已删除', 'success');
        }
        break;
      }
    }
  });
}

function filterContent() {
  const search = document.getElementById('wbSearchInput').value.toLowerCase();
  const scopeFilter = document.getElementById('wbFilterScope').value;
  const typeFilterEl = document.getElementById('wbFilterType');
  const typeFilter = typeFilterEl ? typeFilterEl.value : 'all';

  const items = document.querySelectorAll('.wb-rule-item');
  const groups = document.querySelectorAll('.wb-group-node');

  items.forEach(item => {
    const name = item.querySelector('.wb-rule-name')?.textContent?.toLowerCase() || '';
    const desc = item.querySelector('.wb-rule-desc')?.textContent?.toLowerCase() || '';
    const condition = item.querySelector('.wb-rule-condition')?.textContent?.toLowerCase() || '';
    const scopeText = item.querySelector('.wb-rule-scope')?.textContent || '';
    const ruleType = item.dataset.ruleType || 'conditional';

    let visible = name.includes(search) || desc.includes(search) || condition.includes(search);

    if (scopeFilter !== 'all') {
      if (scopeFilter === 'global') visible = visible && scopeText.includes('全局');
      else if (scopeFilter === 'character') visible = visible && scopeText.includes('👤');
      else if (scopeFilter === 'group') visible = visible && scopeText.includes('👥');
    }

    if (typeFilter !== 'all') {
      visible = visible && ruleType === typeFilter;
    }

    item.style.display = visible ? '' : 'none';
  });

  groups.forEach(group => {
    const body = group.querySelector('.wb-group-body');
    if (body) {
      const visibleItems = body.querySelectorAll('.wb-rule-item[style*="display: none"]');
      const totalItems = body.querySelectorAll('.wb-rule-item');
      const hasVisible = visibleItems.length < totalItems.length;
      group.style.display = hasVisible ? '' : 'none';
    }
  });
}

async function handleImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        if (data.length > 0 && data[0].ruleIds !== undefined) {
          const { importGroups } = await import('../../modules/worldBook.js');
          const count = await importGroups(text);
          renderWorldBookList();
          showToast(`成功导入 ${count} 个组`, 'success');
        } else {
          const count = await importRules(text);
          renderWorldBookList();
          showToast(`成功导入 ${count} 条规则`, 'success');
        }
      }
    } catch (err) {
      showToast('导入失败: ' + err.message, 'error');
    }
  };
  input.click();
}

async function handleExport() {
  const html = `
    <button class="modal-close">&times;</button>
    <h3 class="modal-title">📤 导出世界书</h3>
    <div class="form-group" style="margin:1rem 0;">
      <label style="display:block;margin-bottom:0.5rem;">
        <input type="radio" name="exportType" value="rules" checked>
        <strong>导出规则</strong>（所有世界书规则）
      </label>
      <label style="display:block;margin-bottom:0.5rem;">
        <input type="radio" name="exportType" value="groups">
        <strong>导出规则组</strong>（所有组结构）
      </label>
      <label style="display:block;margin-bottom:0.5rem;">
        <input type="radio" name="exportType" value="all">
        <strong>导出全部</strong>（规则 + 组）
      </label>
    </div>
    <div class="worldbook-editor-actions">
      <button class="btn btn-secondary" id="exportCancelBtn">取消</button>
      <button class="btn btn-primary" id="exportConfirmBtn">确定导出</button>
    </div>
  `;
  openModal(html);

  document.getElementById('exportConfirmBtn').addEventListener('click', async () => {
    const selected = document.querySelector('input[name="exportType"]:checked');
    const type = selected ? selected.value : 'rules';
    let json = '';
    let filename = '';

    try {
      if (type === 'rules' || type === 'all') {
        const rules = await exportRules();
        if (type === 'rules') {
          json = rules;
          filename = `worldbook_rules_${new Date().toISOString().slice(0,10)}.json`;
        } else {
          const groups = await exportGroups();
          const allData = { rules: JSON.parse(rules), groups: JSON.parse(groups) };
          json = JSON.stringify(allData, null, 2);
          filename = `worldbook_full_${new Date().toISOString().slice(0,10)}.json`;
        }
      } else {
        json = await exportGroups();
        filename = `worldbook_groups_${new Date().toISOString().slice(0,10)}.json`;
      }

      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      closeModal();
      showToast('导出成功', 'success');
    } catch (err) {
      showToast('导出失败: ' + err.message, 'error');
    }
  });

  document.getElementById('exportCancelBtn').addEventListener('click', closeModal);
}

// ============================================================
// 对外 API
// ============================================================

export function refreshWorldBook() {
  if (isEditLocked()) {
    console.debug('[WorldBookUI] 编辑中，跳过列表刷新');
    return;
  }
  renderWorldBookList();
}

const WORLDBOOK_EVENTS = [
  'worldbook:rule-added',
  'worldbook:rule-updated',
  'worldbook:rule-deleted',
  'worldbook:group-added',
  'worldbook:group-updated',
  'worldbook:group-deleted',
  'worldbook:rules-imported',
  'worldbook:groups-imported',
];

let _eventsInitialized = false;
const _eventUnsubscribers = [];

function initWorldBookEvents() {
  if (_eventsInitialized) return;
  _eventsInitialized = true;

  for (const eventName of WORLDBOOK_EVENTS) {
    const unsub = globalEventBus.on(eventName, refreshWorldBook);
    if (typeof unsub === 'function') {
      _eventUnsubscribers.push(unsub);
    }
  }
  console.debug(`[WorldBookUI] 已注册 ${WORLDBOOK_EVENTS.length} 个全局事件监听器`);
}

export function disposeWorldBookEvents() {
  if (!_eventsInitialized) return;
  for (const unsub of _eventUnsubscribers) {
    try { unsub(); } catch (_) {}
  }
  _eventUnsubscribers.length = 0;
  _eventsInitialized = false;
  console.debug('[WorldBookUI] 已卸载世界书全局事件监听器');
}

initWorldBookEvents();