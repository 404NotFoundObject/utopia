// js/ui/screens/worldBookComponents.js - 世界书共享UI组件（精简日志版）
import { getAvailablePaths, getAvailableOperators } from '../../modules/worldBook.js';
import { escapeHtml } from '../../core/utils.js';

// ---------- 全局日志计数器 ----------
let renderCounter = 0;
const MAX_RENDER_COUNT = 20;

/**
 * 渲染条件编辑器（纯HTML生成）
 */
export function renderConditionEditor(condition, depth = 0, onRemove = null, isRoot = true) {
  const paths = getAvailablePaths();
  const operators = getAvailableOperators();
  const indent = depth * 24;

  if (!condition.type || condition.type === 'simple') {
    const path = condition.path || 'user.message';
    const op = condition.op || 'contains';
    const value = condition.value || '';
    const safeValue = escapeHtml(value);
    return `
      <div class="wb-cond-node wb-cond-simple" style="margin-left: ${indent}px;" data-depth="${depth}">
        <div class="wb-cond-row">
          <span class="wb-cond-badge simple">条件</span>
          <select class="wb-cond-path" data-field="path">
            ${paths.map(p => `<option value="${escapeHtml(p.value)}" ${p.value === path ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}
          </select>
          <select class="wb-cond-op" data-field="op">
            ${operators.map(o => `<option value="${escapeHtml(o.value)}" ${o.value === op ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
          </select>
          <input class="wb-cond-value" data-field="value" value="${safeValue}" placeholder="值" />
          ${onRemove ? `<button class="btn btn-sm btn-remove-cond" data-action="remove">✕</button>` : ''}
          ${isRoot ? `<button class="btn btn-sm btn-promote-to-composite" data-action="promote-to-composite">➕ 转为组合条件</button>` : ''}
        </div>
      </div>
    `;
  }

  const typeLabel = { and: 'AND', or: 'OR', not: 'NOT' }[condition.type] || condition.type;
  const children = condition.children || [];
  return `
    <div class="wb-cond-node wb-cond-composite" style="margin-left: ${indent}px;" data-depth="${depth}" data-type="${condition.type}">
      <div class="wb-cond-row wb-cond-header">
        <span class="wb-cond-badge ${condition.type}">${typeLabel}</span>
        <span class="wb-cond-count">${children.length} 个子条件</span>
        <div class="wb-cond-actions">
          <button class="btn btn-sm btn-add-child" data-action="add-child">+ 添加子条件</button>
          <button class="btn btn-sm btn-toggle-type" data-action="toggle-type">切换类型</button>
          ${onRemove ? `<button class="btn btn-sm btn-remove-cond" data-action="remove">✕</button>` : ''}
        </div>
      </div>
      <div class="wb-cond-children">
        ${children.map((child, index) => renderConditionEditor(child, depth + 1, (() => {}), false)).join('')}
      </div>
    </div>
  `;
}

// ---------- 防卡死渲染引擎 ----------
let renderTimeout = null;
let isRendering = false;

export function createConditionEditor(container, condition, onChange) {
  container._onChange = onChange;

  if (renderTimeout) {
    cancelAnimationFrame(renderTimeout);
    renderTimeout = null;
  }

  if (isRendering) {
    renderTimeout = requestAnimationFrame(() => {
      createConditionEditor(container, condition, onChange);
    });
    return;
  }

  const currentData = getConditionData(container);
  const isSame = JSON.stringify(currentData) === JSON.stringify(condition);
  const isRendered = container.dataset.rendered === 'true';

  if (isSame && isRendered) {
    return;
  }

  renderCounter++;
  if (renderCounter > MAX_RENDER_COUNT) {
    console.error('[ConditionEditor] ❌ 渲染次数超限，可能存在无限循环');
    renderCounter = 0;
    return;
  }

  isRendering = true;
  try {
    _renderConditionEditor(container, condition, onChange);
    container.dataset.rendered = 'true';
  } catch (err) {
    console.error('[ConditionEditor] ❌ 渲染异常:', err);
    renderCounter = 0;
  } finally {
    isRendering = false;
  }
}

function _renderConditionEditor(container, condition, onChange) {
  container.innerHTML = renderConditionEditor(condition, 0, null, true);

  if (!container._delegated) {
    container.addEventListener('click', handleContainerClick);
    container.addEventListener('input', handleContainerInput);
    container._delegated = true;
  }
  container._conditionData = condition;
}

// ---------- 事件委托 ----------
function handleContainerClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const container = target.closest('.wb-condition-editor');
  if (!container) return;

  let data = getConditionData(container);
  const onChange = container._onChange;
  e.stopPropagation();

  switch (action) {
    case 'promote-to-composite': {
      if (data.type === 'simple') {
        const oldPath = data.path || 'user.message';
        const oldOp = data.op || 'contains';
        const oldValue = data.value || '';
        data = {
          type: 'and',
          children: [
            { type: 'simple', path: oldPath, op: oldOp, value: oldValue },
            { type: 'simple', path: 'user.message', op: 'contains', value: '' }
          ]
        };
        createConditionEditor(container, data, onChange);
        if (onChange) onChange(data);
      }
      break;
    }
    case 'add-child': {
      const node = target.closest('.wb-cond-composite');
      if (!node) break;

      const path = getPathFromDOM(node);
      const parent = getConditionByPath(data, path);

      if (parent && (parent.type === 'and' || parent.type === 'or')) {
        parent.children.push({ type: 'simple', path: 'user.message', op: 'contains', value: '' });
        createConditionEditor(container, data, onChange);
        if (onChange) onChange(data);
      }
      break;
    }
    case 'toggle-type': {
      const node = target.closest('.wb-cond-composite');
      if (!node) break;

      const path = getPathFromDOM(node);
      const parent = getConditionByPath(data, path);

      if (parent) {
        const types = ['and', 'or', 'not'];
        const idx = types.indexOf(parent.type);
        parent.type = types[(idx + 1) % types.length];
        createConditionEditor(container, data, onChange);
        if (onChange) onChange(data);
      }
      break;
    }
    case 'remove': {
      const node = target.closest('.wb-cond-node');
      if (!node || node.dataset.depth === '0') break;

      const path = getPathFromDOM(node);
      const parent = getConditionByPath(data, path.slice(0, -1));
      if (parent && parent.children) {
        const idx = parseInt(path[path.length - 1]);
        parent.children.splice(idx, 1);
        createConditionEditor(container, data, onChange);
        if (onChange) onChange(data);
      }
      break;
    }
  }
}

function handleContainerInput(e) {
  const target = e.target;
  if (!target.classList.contains('wb-cond-path') &&
      !target.classList.contains('wb-cond-op') &&
      !target.classList.contains('wb-cond-value')) return;

  const container = target.closest('.wb-condition-editor');
  if (!container) return;

  clearTimeout(container._inputTimer);
  container._inputTimer = setTimeout(() => {
    const data = getConditionData(container);
    const onChange = container._onChange;
    if (onChange) onChange(data);
  }, 200);
}

// ---------- 辅助工具 ----------
export function getConditionData(container) {
  const root = container.querySelector('.wb-cond-composite');
  if (!root) {
    const simple = container.querySelector('.wb-cond-simple');
    if (simple) {
      const path = simple.querySelector('.wb-cond-path')?.value || 'user.message';
      const op = simple.querySelector('.wb-cond-op')?.value || 'contains';
      const value = simple.querySelector('.wb-cond-value')?.value || '';
      return { type: 'simple', path, op, value };
    }
    return { type: 'and', children: [] };
  }
  return parseComposite(root);
}

function parseComposite(node) {
  const type = node.dataset.type || 'and';
  const children = [];
  const childNodes = node.querySelectorAll(':scope > .wb-cond-children > .wb-cond-node');
  for (const child of childNodes) {
    if (child.classList.contains('wb-cond-simple')) {
      const path = child.querySelector('.wb-cond-path')?.value || 'user.message';
      const op = child.querySelector('.wb-cond-op')?.value || 'contains';
      const value = child.querySelector('.wb-cond-value')?.value || '';
      children.push({ type: 'simple', path, op, value });
    } else if (child.classList.contains('wb-cond-composite')) {
      children.push(parseComposite(child));
    }
  }
  return { type, children };
}

function getPathFromDOM(node) {
  const path = [];
  let current = node;

  while (current && current !== document && !current.classList.contains('wb-condition-editor')) {
    const parent = current.parentElement;
    if (!parent) break;

    if (parent.classList.contains('wb-cond-composite')) {
      const siblings = parent.querySelectorAll(':scope > .wb-cond-children > .wb-cond-node');
      const index = Array.from(siblings).indexOf(current);
      if (index !== -1) {
        path.unshift(index);
      }
      current = parent;
    } else {
      current = parent;
    }
  }
  return path;
}

function getConditionByPath(condition, path) {
  if (path.length === 0) return condition;
  let current = condition;
  for (const idx of path) {
    if (current.children && current.children[idx]) {
      current = current.children[idx];
    } else {
      return null;
    }
  }
  return current;
}

// ---------- 规则选择器（带数据传入） ----------
export function renderRuleSelector(allRules, selectedIds = [], placeholder = '选择规则...') {
  const availableRules = allRules.filter(r => r.enabled);
  const selectedRules = availableRules.filter(r => selectedIds.includes(r.id));
  const availableToSelect = availableRules.filter(r => !selectedIds.includes(r.id));

  return `
    <div class="wb-selector wb-rule-selector" data-selector="rule">
      <div class="wb-selector-tags">
        ${selectedRules.map(r => `
          <span class="wb-selector-tag" data-id="${escapeHtml(r.id)}">
            ${escapeHtml(r.name)}
            <button class="wb-selector-tag-remove" data-id="${escapeHtml(r.id)}">✕</button>
          </span>
        `).join('')}
        ${selectedRules.length === 0 ? `<span class="wb-selector-placeholder">${escapeHtml(placeholder)}</span>` : ''}
      </div>
      <div class="wb-selector-dropdown" style="display:none;">
        <input class="wb-selector-search" placeholder="搜索规则..." />
        <div class="wb-selector-options">
          ${availableToSelect.map(r => `
            <div class="wb-selector-option" data-id="${escapeHtml(r.id)}">
              <span class="wb-selector-option-name">${escapeHtml(r.name)}</span>
              <span class="wb-selector-option-desc">${escapeHtml(r.description || '')}</span>
            </div>
          `).join('')}
          ${availableToSelect.length === 0 ? '<div class="wb-selector-empty">没有可用的规则</div>' : ''}
        </div>
      </div>
    </div>
  `;
}

export function bindRuleSelector(container, onChange) {
  const selector = container.querySelector('.wb-rule-selector');

  if (!selector) return () => {};

  selector._onChange = onChange;

  const tagsContainer = selector.querySelector('.wb-selector-tags');
  const dropdown = selector.querySelector('.wb-selector-dropdown');
  const searchInput = selector.querySelector('.wb-selector-search');
  const optionsContainer = selector.querySelector('.wb-selector-options');

  if (tagsContainer) {
    tagsContainer.addEventListener('click', (e) => {
      if (e.target.closest('.wb-selector-tag-remove')) return;
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
      if (dropdown.style.display === 'block') searchInput?.focus();
    });
  }

  selector.querySelectorAll('.wb-selector-tag-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const currentIds = getSelectedIds(selector);
      const newIds = currentIds.filter(i => i !== id);
      updateSelectorState(selector, newIds, optionsContainer);
      if (onChange) onChange(newIds);
    });
  });

  if (optionsContainer) {
    optionsContainer.querySelectorAll('.wb-selector-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const id = opt.dataset.id;
        const currentIds = getSelectedIds(selector);
        if (!currentIds.includes(id)) {
          const newIds = [...currentIds, id];
          updateSelectorState(selector, newIds, optionsContainer);
          if (onChange) onChange(newIds);
        }
        dropdown.style.display = 'none';
      });
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase();
      optionsContainer.querySelectorAll('.wb-selector-option').forEach(opt => {
        const name = opt.querySelector('.wb-selector-option-name')?.textContent?.toLowerCase() || '';
        const desc = opt.querySelector('.wb-selector-option-desc')?.textContent?.toLowerCase() || '';
        opt.style.display = name.includes(query) || desc.includes(query) ? '' : 'none';
      });
    });
  }

  const onDocClick = (e) => {
    if (!selector.contains(e.target)) dropdown.style.display = 'none';
  };
  document.addEventListener('click', onDocClick);

  return function cleanup() {
    document.removeEventListener('click', onDocClick);
  };
}

function getSelectedIds(selector) {
  const tags = selector.querySelectorAll('.wb-selector-tag');
  return Array.from(tags).map(tag => tag.dataset.id);
}

function updateSelectorState(selector, selectedIds, optionsContainer) {
  const tagsContainer = selector.querySelector('.wb-selector-tags');
  if (!tagsContainer) return;
  const options = optionsContainer ? optionsContainer.querySelectorAll('.wb-selector-option') : [];
  const ruleMap = {};
  options.forEach(opt => {
    const name = opt.querySelector('.wb-selector-option-name')?.textContent || opt.dataset.id;
    const desc = opt.querySelector('.wb-selector-option-desc')?.textContent || '';
    ruleMap[opt.dataset.id] = { name, desc };
  });
  const selectedRules = selectedIds.map(id => ({ id, ...ruleMap[id] })).filter(r => r.name);
  tagsContainer.innerHTML = `
    ${selectedRules.map(r => `
      <span class="wb-selector-tag" data-id="${escapeHtml(r.id)}">
        ${escapeHtml(r.name)}
        <button class="wb-selector-tag-remove" data-id="${escapeHtml(r.id)}">✕</button>
      </span>
    `).join('')}
    ${selectedRules.length === 0 ? `<span class="wb-selector-placeholder">选择规则...</span>` : ''}
  `;
  tagsContainer.querySelectorAll('.wb-selector-tag-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const currentIds = getSelectedIds(selector);
      const newIds = currentIds.filter(i => i !== id);
      updateSelectorState(selector, newIds, optionsContainer);
      const onChange = selector._onChange;
      if (onChange) onChange(newIds);
    });
  });
  if (optionsContainer) {
    optionsContainer.querySelectorAll('.wb-selector-option').forEach(opt => {
      const id = opt.dataset.id;
      opt.style.display = selectedIds.includes(id) ? 'none' : '';
    });
  }
}

// ---------- 组选择器（带数据传入） ----------
export function renderGroupSelector(groups, selectedId = null, placeholder = '选择组...') {
  const availableGroups = groups.filter(g => g.enabled);
  return `
    <div class="wb-selector wb-group-selector" data-selector="group">
      <select class="wb-selector-select">
        <option value="">${escapeHtml(placeholder)}</option>
        ${availableGroups.map(g => `
          <option value="${escapeHtml(g.id)}" ${g.id === selectedId ? 'selected' : ''}>
            ${escapeHtml(g.name)} (${g.ruleIds?.length || 0}条规则)
          </option>
        `).join('')}
      </select>
    </div>
  `;
}

export function bindGroupSelector(container, onChange) {
  const selector = container.querySelector('.wb-group-selector');
  if (!selector) return () => {};
  const select = selector.querySelector('.wb-selector-select');

  const handleChange = () => {
    const value = select ? (select.value || null) : null;
    if (onChange) onChange(value);
  };

  if (select) {
    select.addEventListener('change', handleChange);
  }

  return function cleanup() {
    if (select) {
      select.removeEventListener('change', handleChange);
    }
  };
}

// 重置渲染计数器
export function resetRenderCounter() {
  renderCounter = 0;
}

// 导出旧名
export { renderRuleSelector as renderRuleSelectorWithData, renderGroupSelector as renderGroupSelectorWithData };