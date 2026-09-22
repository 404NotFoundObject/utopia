/**
 * @module ui/themes/themeMaker
 * @description 主题制作器 v2（完整功能版）
 *
 * 特性：
 *   - 三栏布局：主题列表 / 编辑器 / 实时预览
 *   - 支持内置主题派生的自定义副本
 *   - 圆角/阴影抽象系数实时调整
 *   - 导入 / 导出 JSON
 *   - 取消时恢复原始 :root
 */

import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import {
  applyTheme,
  getCurrentTheme,
  getAvailableThemes,
  getThemeVariablesById,
  computeRadiusVars,
  computeShadowVars,
} from '../layout/theme.js';
import { THEME_PRESETS } from './themePresets.js';
import {
  getCustomTheme,
  saveCustomTheme,
  deleteCustomTheme,
  generateCustomThemeId,
  isCustomThemeId,
} from './themeStorage.js';

// ============================================================
// 常量：颜色项分组
// ============================================================
const COLOR_GROUPS = [
  {
    name: '🎨 背景',
    items: [
      { key: '--color-bg-primary', label: '主背景' },
      { key: '--color-bg-secondary', label: '次背景' },
      { key: '--color-bg-sidebar', label: '侧栏背景' },
      { key: '--color-bg-input', label: '输入框' },
      { key: '--color-bg-card', label: '卡片' },
    ],
  },
  {
    name: '📝 文字',
    items: [
      { key: '--color-text-primary', label: '主文字' },
      { key: '--color-text-secondary', label: '次文字' },
      { key: '--color-text-muted', label: '弱化文字' },
    ],
  },
  {
    name: '📏 边框',
    items: [
      { key: '--color-border', label: '边框' },
      { key: '--color-border-light', label: '边框浅色' },
    ],
  },
  {
    name: '💜 主色',
    items: [
      { key: '--color-primary', label: '主色' },
      { key: '--color-primary-light', label: '主色浅' },
      { key: '--color-primary-dark', label: '主色深' },
    ],
  },
  {
    name: '💚 辅色',
    items: [
      { key: '--color-secondary', label: '辅色' },
      { key: '--color-secondary-light', label: '辅色浅' },
      { key: '--color-secondary-dark', label: '辅色深' },
    ],
  },
  {
    name: '⚠️ 语义色',
    items: [
      { key: '--color-danger', label: '危险色' },
      { key: '--color-warning', label: '警告色' },
    ],
  },
];

// ============================================================
// 模块级状态
// ============================================================
let _originalThemeId = null;      // 打开时记录的当前主题，用于取消恢复
let _editingTheme = null;         // 当前编辑中的主题 record（可能尚未持久化）
let _keepCurrent = false;         // 保存时置 true，阻止 onClose 恢复
let _root = null;                 // document.documentElement 缓存

let _abortController = null;

// ============================================================
// 工具函数
// ============================================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text == null ? '' : text);
  return div.innerHTML;
}

/**
 * 把任意 CSS 颜色值转为 <input type="color"> 能接受的 #RRGGBB
 * - #RRGGBBAA  → 截取前 7 位
 * - #RGB        → 展开为 #RRGGBB
 * - rgba()      → 尝试解析，失败返回 #000000
 */
function toColorInputValue(value) {
  if (!value) return '#000000';
  const v = String(value).trim();

  if (/^#[0-9a-fA-F]{8}$/.test(v)) return v.slice(0, 7);
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  }

  const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    const toHex = (n) => Number(n).toString(16).padStart(2, '0');
    return '#' + toHex(m[1]) + toHex(m[2]) + toHex(m[3]);
  }

  return '#000000';
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// 打开入口
// ============================================================

/**
 * 打开主题制作器
 *
 * @param {Object} [options]
 * @param {Function} [options.onClose] - 模态框关闭后的回调（在内部状态恢复逻辑之后执行）
 */
export function openThemeMaker(options = {}) {
  _root = document.documentElement;
  _originalThemeId = getCurrentTheme();
  _keepCurrent = false;

  if (_abortController) {
    try { _abortController.abort(); } catch (_) {}
    _abortController = null;
  }
  _abortController = new AbortController();

  // 初始化：以当前主题为基准构建一个"编辑副本"
  _editingTheme = buildEditingThemeFromCurrent(_originalThemeId);

  // ★ 保留外部传入的 onClose 回调，在模态框关闭后执行
  const userOnClose = typeof options.onClose === 'function' ? options.onClose : null;

  const html = renderShell();
  openModal(html, () => {
    onModalClose();
    if (userOnClose) {
      try {
        userOnClose();
      } catch (err) {
        console.error('[ThemeMaker] onClose 回调执行失败:', err);
      }
    }
  });

  // 绑定事件（使用当前 controller 的 signal）
  bindAllEvents();

  // 立即预览
  applyEditingThemeToRoot();
}

function onModalClose() {
  if (_keepCurrent) {
    // 保存流程：保留当前 :root
    return;
  }
  // 取消 / 关闭：恢复打开前的主题
  if (_originalThemeId) {
    applyTheme(_originalThemeId);
  }
}

// ============================================================
// 构建编辑主题对象
// ============================================================

function buildEditingThemeFromCurrent(themeId) {
  // 自定义主题：直接复制一份
  if (isCustomThemeId(themeId)) {
    const record = getCustomTheme(themeId);
    if (record) {
      return {
        id: record.id,
        name: record.name,
        baseTheme: record.baseTheme || 'light',
        variables: { ...record.variables },
        radiusScale: record.radiusScale ?? 50,
        shadowScale: record.shadowScale ?? 100,
        _isNew: false,
      };
    }
  }

  // 内置主题（或找不到的自定义）：生成一个未持久化的副本
  const builtin = THEME_PRESETS[themeId] ? themeId : 'light';
  const baseVars = { ...THEME_PRESETS[builtin].variables };

  // 只保留颜色类变量（不含 radius/shadow/gradient）
  const colorVars = {};
  for (const [key, value] of Object.entries(baseVars)) {
    if (key.startsWith('--radius-')) continue;
    if (key.startsWith('--shadow-')) continue;
    colorVars[key] = value;
  }

  return {
    id: generateCustomThemeId(),
    name: `${THEME_PRESETS[builtin].name} 副本`,
    baseTheme: builtin,
    variables: colorVars,
    radiusScale: 50,
    shadowScale: 100,
    _isNew: true,
  };
}

function buildEditingThemeFromCustom(record) {
  return {
    id: record.id,
    name: record.name,
    baseTheme: record.baseTheme || 'light',
    variables: { ...record.variables },
    radiusScale: record.radiusScale ?? 50,
    shadowScale: record.shadowScale ?? 100,
    _isNew: false,
  };
}

// ============================================================
// HTML 渲染
// ============================================================

function renderShell() {
  return `
    <style>
      #modalContent:has(.theme-maker-v2) {
        max-width: 960px;
        width: 96vw;
      }
    </style>
    <button class="modal-close">&times;</button>
    <div class="theme-maker-v2">
      ${renderHeader()}
      <div class="tm-body">
        <aside class="tm-sidebar" id="tmSidebar">
          ${renderSidebar()}
        </aside>
        <main class="tm-main">
          ${renderMainHeader()}
          <div class="tm-content">
            <div class="tm-editor" id="tmEditor">
              ${renderColorGroups()}
              ${renderRadiusShadow()}
            </div>
            <div class="tm-preview" id="tmPreview">
              ${renderPreviewHTML()}
            </div>
          </div>
          ${renderFooter()}
        </main>
      </div>
    </div>
    <style>${sharedStyles()}</style>
  `;
}

function renderHeader() {
  return `
    <div class="tm-header">
      <h2>🎨 主题制作器</h2>
      <div class="tm-header-actions">
        <button class="btn btn-sm" id="tmImportBtn"><i class="fas fa-file-import"></i> 导入</button>
        <button class="btn btn-sm" id="tmExportBtn"><i class="fas fa-file-export"></i> 导出</button>
        <button class="btn btn-primary btn-sm" id="tmNewBtn"><i class="fas fa-plus"></i> 新建副本</button>
      </div>
    </div>
  `;
}

function renderSidebar() {
  const themes = getAvailableThemes();
  const builtin = themes.filter(t => !t.isCustom);
  const custom = themes.filter(t => t.isCustom);

  const itemHtml = (t) => {
    const active = t.id === _editingTheme.id ? 'active' : '';
    return `
      <li class="tm-list-item ${active}" data-theme-id="${escapeHtml(t.id)}">
        <span class="tm-list-name">${escapeHtml(t.name)}</span>
        ${t.isCustom ? '<span class="tm-list-tag">自定义</span>' : '<span class="tm-list-tag tm-list-tag-base">内置</span>'}
      </li>
    `;
  };

  return `
    <h3 class="tm-sidebar-title">内置主题</h3>
    <ul class="tm-list">${builtin.map(itemHtml).join('')}</ul>
    <h3 class="tm-sidebar-title">我的主题</h3>
    <ul class="tm-list">${custom.length > 0 ? custom.map(itemHtml).join('') : '<li class="tm-empty">暂无自定义主题</li>'}</ul>
  `;
}

function renderMainHeader() {
  const isNew = _editingTheme._isNew;
  return `
    <div class="tm-main-header">
      <input type="text" id="tmThemeName" class="tm-name-input"
             value="${escapeHtml(_editingTheme.name)}"
             placeholder="主题名称" />
      <div class="tm-main-header-actions">
        <button class="btn btn-sm" id="tmResetBtn" title="重置为基准值">
          <i class="fas fa-undo"></i> 重置
        </button>
        <button class="btn btn-sm" id="tmDuplicateBtn" title="基于当前主题创建副本">
          <i class="fas fa-copy"></i> 复制
        </button>
        <button class="btn btn-danger btn-sm" id="tmDeleteBtn" ${isNew ? 'disabled' : ''} title="删除此自定义主题">
          <i class="fas fa-trash"></i> 删除
        </button>
      </div>
    </div>
  `;
}

function renderColorGroups() {
  const html = COLOR_GROUPS.map((group, gi) => {
    const items = group.items.map(item => {
      const val = _editingTheme.variables[item.key] || '';
      const inputVal = toColorInputValue(val);
      return `
        <div class="tm-color-item">
          <label>${escapeHtml(item.label)}</label>
          <input type="color" data-var="${item.key}" value="${inputVal}"
                 title="${escapeHtml(item.key)}" />
        </div>
      `;
    }).join('');
    return `
      <details class="tm-group" ${gi === 0 ? 'open' : ''}>
        <summary>${group.name}</summary>
        <div class="tm-color-grid">${items}</div>
      </details>
    `;
  }).join('');
  return html;
}

function renderRadiusShadow() {
  return `
    <details class="tm-group" open>
      <summary>📐 圆角与阴影</summary>
      <div class="tm-slider-item">
        <label>圆角系数</label>
        <input type="range" id="tmRadius" min="0" max="100" step="1"
               value="${_editingTheme.radiusScale}" />
        <span class="tm-slider-value" id="tmRadiusValue">${_editingTheme.radiusScale}</span>
      </div>
      <div class="tm-slider-item">
        <label>阴影系数</label>
        <input type="range" id="tmShadow" min="0" max="200" step="5"
               value="${_editingTheme.shadowScale}" />
        <span class="tm-slider-value" id="tmShadowValue">${_editingTheme.shadowScale}</span>
      </div>
    </details>
  `;
}

function renderPreviewHTML() {
  return `
    <div class="tm-preview-title">实时预览</div>
    <div class="tm-preview-body">
      <div class="tm-preview-msg assistant">
        <div class="tm-preview-avatar" style="background:var(--color-primary-gradient);">A</div>
        <div class="tm-preview-bubble">你好！今天过得怎么样？</div>
      </div>
      <div class="tm-preview-msg user">
        <div class="tm-preview-bubble">还不错，刚忙完手头的事</div>
      </div>
      <div class="tm-preview-msg assistant">
        <div class="tm-preview-avatar" style="background:var(--color-secondary);">A</div>
        <div class="tm-preview-bubble">那就好！要不要一起随便聊聊？</div>
      </div>
      <div class="tm-preview-input-row">
        <input type="text" placeholder="输入消息..." disabled />
        <button class="btn btn-primary btn-sm">发送</button>
      </div>
      <div class="tm-preview-btn-row">
        <button class="btn btn-primary btn-sm">主按钮</button>
        <button class="btn btn-sm">次按钮</button>
        <button class="btn btn-danger btn-sm">危险</button>
      </div>
    </div>
  `;
}

function renderFooter() {
  return `
    <div class="tm-footer">
      <button class="btn" id="tmCancelBtn">取消</button>
      <div style="flex:1;"></div>
      <button class="btn" id="tmSaveBtn">仅保存</button>
      <button class="btn btn-primary" id="tmSaveApplyBtn">保存并应用</button>
    </div>
  `;
}

// ============================================================
// 样式
// ============================================================

function sharedStyles() {
  return `
    .theme-maker-v2 {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      color: var(--color-text-primary);
      max-height: 80vh;
    }
    .tm-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--color-border);
    }
    .tm-header h2 {
      margin: 0;
      font-size: 1.15rem;
    }
    .tm-header-actions {
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
    }
    .tm-body {
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 0.75rem;
      flex: 1;
      min-height: 0;
    }
    .tm-sidebar {
      border-right: 1px solid var(--color-border);
      padding-right: 0.6rem;
      overflow-y: auto;
      max-height: 60vh;
    }
    .tm-sidebar-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
      margin: 0.6rem 0 0.3rem 0;
      padding-left: 0.2rem;
    }
    .tm-sidebar-title:first-child { margin-top: 0; }
    .tm-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .tm-list-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.35rem 0.5rem;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: 0.85rem;
      border: 1px solid transparent;
      transition: all 0.15s;
    }
    .tm-list-item:hover {
      background: var(--color-bg-secondary);
    }
    .tm-list-item.active {
      background: var(--color-bg-secondary);
      border-color: var(--color-primary);
      color: var(--color-primary);
      font-weight: 500;
    }
    .tm-list-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
    .tm-list-tag {
      flex-shrink: 0;
      font-size: 0.6rem;
      padding: 0.05rem 0.35rem;
      border-radius: var(--radius-full);
      background: var(--color-primary-light);
      color: var(--color-primary-dark);
      margin-left: 0.3rem;
    }
    .tm-list-tag-base {
      background: var(--color-border);
      color: var(--color-text-muted);
    }
    .tm-empty {
      padding: 0.5rem;
      font-size: 0.8rem;
      color: var(--color-text-muted);
      text-align: center;
    }
    .tm-main {
      display: flex;
      flex-direction: column;
      min-height: 0;
      gap: 0.6rem;
    }
    .tm-main-header {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .tm-name-input {
      flex: 1;
      min-width: 120px;
      padding: 0.35rem 0.6rem;
      font-size: 0.9rem;
    }
    .tm-main-header-actions {
      display: flex;
      gap: 0.3rem;
      flex-wrap: wrap;
    }
    .tm-content {
      display: grid;
      grid-template-columns: 1fr 240px;
      gap: 0.75rem;
      min-height: 0;
      flex: 1;
    }
    .tm-editor {
      overflow-y: auto;
      max-height: 52vh;
      padding-right: 0.3rem;
    }
    .tm-group {
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      margin-bottom: 0.5rem;
      overflow: hidden;
    }
    .tm-group summary {
      padding: 0.4rem 0.6rem;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      background: var(--color-bg-secondary);
      user-select: none;
    }
    .tm-group summary:hover {
      background: var(--color-border);
    }
    .tm-color-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 0.4rem;
      padding: 0.5rem;
    }
    .tm-color-item {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .tm-color-item label {
      font-size: 0.72rem;
      color: var(--color-text-secondary);
    }
    .tm-color-item input[type="color"] {
      width: 100%;
      height: 28px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      padding: 0;
      cursor: pointer;
      background: transparent;
    }
    .tm-slider-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.6rem;
    }
    .tm-slider-item label {
      font-size: 0.8rem;
      min-width: 70px;
    }
    .tm-slider-item input[type="range"] {
      flex: 1;
    }
    .tm-slider-value {
      font-size: 0.75rem;
      color: var(--color-text-muted);
      min-width: 32px;
      text-align: right;
    }
    .tm-preview {
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 0.5rem;
      background: var(--color-bg-secondary);
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      overflow-y: auto;
      max-height: 52vh;
    }
    .tm-preview-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
    }
    .tm-preview-body {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .tm-preview-msg {
      display: flex;
      gap: 0.3rem;
      align-items: flex-start;
    }
    .tm-preview-msg.user {
      flex-direction: row-reverse;
    }
    .tm-preview-avatar {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 0.65rem;
      font-weight: bold;
    }
    .tm-preview-bubble {
      padding: 0.3rem 0.55rem;
      background: var(--color-bg-primary);
      border: 1px solid var(--color-border-light);
      border-radius: var(--radius-lg);
      font-size: 0.75rem;
      color: var(--color-text-primary);
      max-width: 85%;
      word-break: break-word;
    }
    .tm-preview-msg.user .tm-preview-bubble {
      background: var(--color-primary-gradient);
      color: #fff;
      border-color: var(--color-primary);
    }
    .tm-preview-input-row {
      display: flex;
      gap: 0.3rem;
      align-items: center;
    }
    .tm-preview-input-row input {
      flex: 1;
      padding: 0.25rem 0.5rem;
      font-size: 0.75rem;
    }
    .tm-preview-btn-row {
      display: flex;
      gap: 0.3rem;
      flex-wrap: wrap;
    }
    .tm-footer {
      display: flex;
      gap: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--color-border);
    }
    @media (max-width: 720px) {
      .tm-body {
        grid-template-columns: 1fr;
      }
      .tm-sidebar {
        border-right: none;
        border-bottom: 1px solid var(--color-border);
        padding-right: 0;
        padding-bottom: 0.5rem;
        max-height: 25vh;
      }
      .tm-content {
        grid-template-columns: 1fr;
      }
      .tm-preview {
        max-height: 30vh;
      }
      .tm-editor {
        max-height: 40vh;
      }
    }
    @media (max-width: 768px) {
      .theme-maker-v2 {
        max-height: none;
      }
      /* ★ 附带：窄屏下优化 header 布局，避免标题与按钮挤爆 */
      .tm-header {
        flex-wrap: wrap;
        gap: 0.4rem;
      }
      .tm-header h2 {
        width: 100%;
        font-size: 1rem;
      }
      .tm-main-header {
        flex-direction: column;
        align-items: stretch;
      }
      .tm-main-header-actions {
        width: 100%;
        justify-content: flex-end;
      }
    }
  `;
}

// ============================================================
// 事件绑定（委托，只绑定一次）
// ============================================================

/**
 * 绑定所有事件
 *
 */
function bindAllEvents() {
  const modalContent = document.getElementById('modalContent');
  if (!modalContent) {
    console.warn('[ThemeMaker] #modalContent 不存在，跳过事件绑定');
    return;
  }

  // 防御：确保 controller 已创建
  if (!_abortController) {
    _abortController = new AbortController();
  }
  const signal = _abortController.signal;

  // ---- 颜色项 ----
  modalContent.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('input[type="color"][data-var]')) {
      const key = t.dataset.var;
      _editingTheme.variables[key] = t.value;
      _root.style.setProperty(key, t.value);
    }
  }, { signal });

  // ---- 圆角/阴影滑杆 ----
  modalContent.addEventListener('input', (e) => {
    if (e.target.id === 'tmRadius') {
      const v = Number(e.target.value);
      _editingTheme.radiusScale = v;
      const label = document.getElementById('tmRadiusValue');
      if (label) label.textContent = String(v);
      const vars = computeRadiusVars(v);
      for (const [k, val] of Object.entries(vars)) _root.style.setProperty(k, val);
    }
    if (e.target.id === 'tmShadow') {
      const v = Number(e.target.value);
      _editingTheme.shadowScale = v;
      const label = document.getElementById('tmShadowValue');
      if (label) label.textContent = String(v);
      const vars = computeShadowVars(v);
      for (const [k, val] of Object.entries(vars)) _root.style.setProperty(k, val);
    }
  }, { signal });

  // ---- 名称 ----
  modalContent.addEventListener('input', (e) => {
    if (e.target.id === 'tmThemeName') {
      _editingTheme.name = e.target.value;
    }
  }, { signal });

  // ---- 主题列表点击 ----
  modalContent.addEventListener('click', (e) => {
    const li = e.target.closest('.tm-list-item');
    if (li) {
      const id = li.dataset.themeId;
      if (id && id !== _editingTheme.id) {
        switchEditingTheme(id);
      }
    }
  }, { signal });

  // ---- 按钮 ----
  modalContent.addEventListener('click', async (e) => {
    const id = e.target.closest('button')?.id;
    if (!id) return;

    switch (id) {
      case 'tmNewBtn':       onNewCopy(); break;
      case 'tmDuplicateBtn': onDuplicate(); break;
      case 'tmResetBtn':     onReset(); break;
      case 'tmDeleteBtn':    onDelete(); break;
      case 'tmImportBtn':    onImport(); break;
      case 'tmExportBtn':    onExport(); break;
      case 'tmCancelBtn':    onCancel(); break;
      case 'tmSaveBtn':      onSave(false); break;
      case 'tmSaveApplyBtn': onSave(true); break;
    }
  }, { signal });
}

// ============================================================
// 主题应用 / 切换
// ============================================================

function applyEditingThemeToRoot() {
  // 先清理所有颜色/圆角/阴影变量，再逐项写入
  const baseVars = THEME_PRESETS[_editingTheme.baseTheme]?.variables
    || THEME_PRESETS.light.variables;

  const toClear = new Set([
    ...Object.keys(THEME_PRESETS.light.variables),
    ...Object.keys(THEME_PRESETS.dark.variables),
    ...Object.keys(THEME_PRESETS.cyberpunk.variables),
  ]);

  for (const key of Object.keys(_editingTheme.variables)) {
    toClear.add(key);
  }

  for (const key of toClear) {
    _root.style.removeProperty(key);
  }

  // 写入 baseTheme 原始值
  for (const [key, value] of Object.entries(baseVars)) {
    if (key.startsWith('--radius-') || key.startsWith('--shadow-')) continue;
    _root.style.setProperty(key, value);
  }

  // 写入用户覆盖
  for (const [key, value] of Object.entries(_editingTheme.variables)) {
    if (key.startsWith('--radius-') || key.startsWith('--shadow-')) continue;
    _root.style.setProperty(key, value);
  }

  // 写入圆角 / 阴影
  const rv = computeRadiusVars(_editingTheme.radiusScale);
  for (const [k, v] of Object.entries(rv)) _root.style.setProperty(k, v);
  const sv = computeShadowVars(_editingTheme.shadowScale);
  for (const [k, v] of Object.entries(sv)) _root.style.setProperty(k, v);
}

function switchEditingTheme(themeId) {
  if (isCustomThemeId(themeId)) {
    const record = getCustomTheme(themeId);
    if (record) {
      _editingTheme = buildEditingThemeFromCustom(record);
    } else {
      showToast('主题不存在', 'warning');
      return;
    }
  } else {
    _editingTheme = buildEditingThemeFromCurrent(themeId);
  }

  applyEditingThemeToRoot();
  refreshUI();
}

function refreshUI() {
  const modalContent = document.getElementById('modalContent');
  if (!modalContent) return;

  // 更新侧栏 active 状态
  modalContent.querySelectorAll('.tm-list-item').forEach(el => {
    el.classList.toggle('active', el.dataset.themeId === _editingTheme.id);
  });

  // 更新名称
  const nameInput = document.getElementById('tmThemeName');
  if (nameInput) nameInput.value = _editingTheme.name;

  // 更新颜色项
  for (const group of COLOR_GROUPS) {
    for (const item of group.items) {
      const input = modalContent.querySelector(`input[data-var="${item.key}"]`);
      if (input) {
        input.value = toColorInputValue(_editingTheme.variables[item.key] || '');
      }
    }
  }

  // 更新滑杆
  const rSlider = document.getElementById('tmRadius');
  if (rSlider) {
    rSlider.value = _editingTheme.radiusScale;
    const rv = document.getElementById('tmRadiusValue');
    if (rv) rv.textContent = String(_editingTheme.radiusScale);
  }
  const sSlider = document.getElementById('tmShadow');
  if (sSlider) {
    sSlider.value = _editingTheme.shadowScale;
    const sv = document.getElementById('tmShadowValue');
    if (sv) sv.textContent = String(_editingTheme.shadowScale);
  }

  // 删除按钮可用性
  const delBtn = document.getElementById('tmDeleteBtn');
  if (delBtn) {
    if (_editingTheme._isNew) delBtn.setAttribute('disabled', '');
    else delBtn.removeAttribute('disabled');
  }
}

// ============================================================
// 按钮逻辑
// ============================================================

function onNewCopy() {
  // 基于当前 baseTheme 生成新的副本
  const base = _editingTheme.baseTheme || 'light';
  _editingTheme = buildEditingThemeFromCurrent(base);
  applyEditingThemeToRoot();
  refreshUI();
  showToast('已创建新副本', 'info');
}

function onDuplicate() {
  const base = _editingTheme.baseTheme || 'light';
  const copy = {
    id: generateCustomThemeId(),
    name: `${_editingTheme.name} 副本`,
    baseTheme: base,
    variables: { ..._editingTheme.variables },
    radiusScale: _editingTheme.radiusScale,
    shadowScale: _editingTheme.shadowScale,
    _isNew: true,
  };
  _editingTheme = copy;
  applyEditingThemeToRoot();
  refreshUI();
  showToast('已基于当前主题创建副本', 'info');
}

function onReset() {
  if (!confirm('确定将当前编辑重置为基准主题的默认值？')) return;
  const base = _editingTheme.baseTheme || 'light';
  const baseVars = THEME_PRESETS[base].variables;
  const colorVars = {};
  for (const [k, v] of Object.entries(baseVars)) {
    if (k.startsWith('--radius-') || k.startsWith('--shadow-')) continue;
    colorVars[k] = v;
  }
  _editingTheme.variables = colorVars;
  _editingTheme.radiusScale = 50;
  _editingTheme.shadowScale = 100;
  applyEditingThemeToRoot();
  refreshUI();
  showToast('已重置为基准值', 'success');
}

function onDelete() {
  if (_editingTheme._isNew) return;
  if (!confirm(`确定删除自定义主题"${_editingTheme.name}"？`)) return;

  deleteCustomTheme(_editingTheme.id);

  // 切换到 light
  _editingTheme = buildEditingThemeFromCurrent('light');
  applyEditingThemeToRoot();
  refreshSidebar();
  refreshUI();
  showToast('已删除', 'success');
}

function onCancel() {
  _keepCurrent = false;
  closeModal();
}

function onSave(applyNow) {
  if (!_editingTheme.name.trim()) {
    showToast('请输入主题名称', 'warning');
    return;
  }

  try {
    // 保留 baseTheme 的原始颜色作为底，用户覆盖已存在 variables 中
    const record = saveCustomTheme({
      id: _editingTheme.id,
      name: _editingTheme.name.trim(),
      baseTheme: _editingTheme.baseTheme || 'light',
      variables: { ..._editingTheme.variables },
      radiusScale: _editingTheme.radiusScale,
      shadowScale: _editingTheme.shadowScale,
    });

    _editingTheme._isNew = false;

    if (applyNow) {
      _keepCurrent = true;
      applyTheme(record.id);
      closeModal();
      showToast(`主题"${record.name}"已保存并应用`, 'success');
    } else {
      refreshSidebar();
      refreshUI();
      showToast(`主题"${record.name}"已保存`, 'success');
    }
  } catch (e) {
    console.error('[ThemeMaker] 保存失败:', e);
    showToast('保存失败: ' + e.message, 'error');
  }
}

function refreshSidebar() {
  const sidebar = document.getElementById('tmSidebar');
  if (!sidebar) return;
  const scrollTop = sidebar.scrollTop;
  sidebar.innerHTML = renderSidebar();
  sidebar.scrollTop = scrollTop;

  // 重新为列表项加 active（由于重新渲染了）
  refreshUI();
}

// ============================================================
// 导入 / 导出
// ============================================================

function onExport() {
  const data = {
    __type: 'utopia-theme',
    version: 1,
    name: _editingTheme.name,
    baseTheme: _editingTheme.baseTheme || 'light',
    variables: _editingTheme.variables,
    radiusScale: _editingTheme.radiusScale,
    shadowScale: _editingTheme.shadowScale,
  };
  const safeName = (_editingTheme.name || 'theme').replace(/[\\/:*?"<>|]/g, '_');
  downloadJson(data, `${safeName}.utopia-theme.json`);
  showToast('已导出', 'success');
}

function onImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const validated = validateImportedTheme(data);
      if (!validated) {
        showToast('无效的主题文件', 'error');
        return;
      }
      _editingTheme = validated;
      applyEditingThemeToRoot();
      refreshUI();
      showToast('已导入，可在编辑后保存', 'success');
    } catch (err) {
      showToast('导入失败: ' + err.message, 'error');
    }
  };
  input.click();
}

function validateImportedTheme(data) {
  if (!data || typeof data !== 'object') return null;
  if (!data.variables && !data.baseTheme) return null;

  const base = THEME_PRESETS[data.baseTheme] ? data.baseTheme : 'light';

  // 校验 variables 中的键
  const vars = {};
  if (data.variables && typeof data.variables === 'object') {
    for (const [k, v] of Object.entries(data.variables)) {
      if (typeof k !== 'string') continue;
      if (typeof v !== 'string') continue;
      if (k.startsWith('--radius-') || k.startsWith('--shadow-')) continue;
      vars[k] = v;
    }
  }

  return {
    id: generateCustomThemeId(),
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : '导入的主题',
    baseTheme: base,
    variables: vars,
    radiusScale: Number.isFinite(data.radiusScale) ? Math.max(0, Math.min(100, data.radiusScale)) : 50,
    shadowScale: Number.isFinite(data.shadowScale) ? Math.max(0, Math.min(200, data.shadowScale)) : 100,
    _isNew: true,
  };
}