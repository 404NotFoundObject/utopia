// js/ui/layout/sidebar.js - 侧栏折叠与移动端控制（含插件入口 + 槽位保留）
import { getAppState } from '../../core/state.js';
import { rescan } from '../../plugins/uiRuntime.js';

// ============================================================
// 按钮配置
// ============================================================

const BUTTON_CONFIG = {
  themeToggleBtn: { icon: 'fa-moon', label: '主题' },
  socialBtn: { icon: 'fa-users', label: '朋友圈' },
  worldbookBtn: { icon: 'fa-book-open', label: '世界书' },
  pluginBtn: { icon: 'fa-puzzle-piece', label: '插件' },
  settingsBtn: { icon: 'fa-cog', label: '设置' },
  importBtn: { icon: 'fa-file-import', label: '导入' },
  createBtn: { icon: 'fa-plus-circle', label: '创建' },
  createGroupBtn: { icon: 'fa-user-plus', label: '创建群组' },
};


const PRIMARY_IDS = ['themeToggleBtn', 'socialBtn', 'worldbookBtn', 'pluginBtn'];
const SECONDARY_IDS = ['settingsBtn', 'importBtn', 'createBtn', 'createGroupBtn'];

let isExpanded = false;
let currentMode = null;

// ★ 模块级保存 document click handler，供重复绑定时先移除旧的
let _documentClickHandler = null;

// ============================================================
// 初始化
// ============================================================
export function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const mobileToggle = document.getElementById('mobileMenuToggle');
  const sidebarToggle = document.getElementById('sidebarToggle');

  // ---------- 移动端汉堡菜单：打开侧栏 ----------
  if (mobileToggle && sidebar && overlay) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('show');
    });
    // 点击遮罩：关闭侧栏
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
  }

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      const isMobile = window.innerWidth < 768;
      if (isMobile) {
        sidebar.classList.remove('open');
        overlay?.classList.remove('show');
      } else {
        sidebar.classList.toggle('collapsed');
      }
    });
  }

  window.addEventListener('resize', handleResize);
  handleResize();
}

// ============================================================
// 响应式处理
// ============================================================
function handleResize() {
  const state = getAppState();
  const isMobile = window.innerWidth < 768;
  state.set('isMobile', isMobile);

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');

  if (isMobile) {
    sidebar?.classList.remove('collapsed');
  } else if (sidebar && overlay) {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  }

  const newMode = isMobile ? 'mobile' : 'desktop';
  if (newMode !== currentMode) {
    currentMode = newMode;
    const footer = document.querySelector('.sidebar-footer');
    if (footer) {
      footer.dataset.rebuilt = 'false';
    }
    rebuildAllButtons();
  }
}

function rebuildAllButtons() {
  const isMobile = window.innerWidth < 768;
  const footer = document.querySelector('.sidebar-footer');
  if (!footer) return;

  // 防止同模式重复执行
  if (footer.dataset.rebuilt === 'true') return;

  // ---- 展开按钮容器（footer 的兄弟节点，位置保持不变） ----
  let expandContainer = document.getElementById('expandToggleContainer');
  if (!expandContainer) {
    expandContainer = document.createElement('div');
    expandContainer.id = 'expandToggleContainer';
    expandContainer.className = 'expand-toggle-container';
    footer.parentNode.insertBefore(expandContainer, footer);
  }

  // ---- 保证 footer 内部两层结构：buttonsContainer + extraSlot ----
  // 用 :scope > 严格匹配直接子节点，避免误查嵌套的同名属性节点
  let buttonsContainer = footer.querySelector(':scope > .sidebar-footer-buttons');
  let extraSlot = footer.querySelector(':scope > [data-plugin-slot="sidebar-footer-extra"]');

  if (buttonsContainer && extraSlot) {
    // 结构已就绪：只清空按钮容器，extraSlot 完全不动
    buttonsContainer.innerHTML = '';
  } else {
    // 首次构建（或结构不完整）
    // 1. 若 extraSlot 已存在，摘除但保留引用与子节点（含插件已注入内容）
    if (extraSlot) {
      extraSlot.remove();
    } else {
      extraSlot = document.createElement('div');
      extraSlot.dataset.pluginSlot = 'sidebar-footer-extra';
      extraSlot.style.display = 'contents';
    }

    // 2. 创建按钮容器
    if (!buttonsContainer) {
      buttonsContainer = document.createElement('div');
      buttonsContainer.className = 'sidebar-footer-buttons';
      buttonsContainer.style.display = 'contents';
    }

    // 3. 清空 footer 并重建两层结构
    //    注：此次清空会销毁除 extraSlot 外的所有旧节点；
    //    旧节点在首次构建时都是按钮，无副作用。
    footer.innerHTML = '';
    footer.appendChild(buttonsContainer);
    footer.appendChild(extraSlot);
  }

  // ---- 构建按钮 HTML ----
  let html = '';

  if (isMobile) {
    // ===== 移动端 =====
    // 4 + 4 布局，两排按钮数一致，视觉对齐
    expandContainer.innerHTML = `
      <button class="sidebar-btn expand-toggle" id="expandToggleBtn">
        <i class="fas fa-ellipsis-h"></i>
      </button>
    `;
    expandContainer.style.display = 'flex';

    html += `<div class="sidebar-btn-row primary-row">`;
    for (const id of PRIMARY_IDS) {
      const config = BUTTON_CONFIG[id];
      html += `
        <button class="sidebar-btn" id="${id}">
          <i class="fas ${config.icon}"></i>
          <span>${config.label}</span>
        </button>
      `;
    }
    html += `</div>`;

    html += `<div class="sidebar-btn-row secondary-row" style="display: none;">`;
    for (const id of SECONDARY_IDS) {
      const config = BUTTON_CONFIG[id];
      html += `
        <button class="sidebar-btn" id="${id}">
          <i class="fas ${config.icon}"></i>
          <span>${config.label}</span>
        </button>
      `;
    }
    html += `</div>`;

  } else {
    // ===== PC 端 =====
    // 顺序不变：PRIMARY 后接 SECONDARY
    expandContainer.style.display = 'none';

    const allIds = [...PRIMARY_IDS, ...SECONDARY_IDS];
    for (const id of allIds) {
      const config = BUTTON_CONFIG[id];
      html += `
        <button class="sidebar-btn" id="${id}">
          <i class="fas ${config.icon}"></i>
          <span>${config.label}</span>
        </button>
      `;
    }
  }

  // ---- 写入按钮容器（extraSlot 全程不受影响） ----
  buttonsContainer.innerHTML = html;

  footer.dataset.rebuilt = 'true';

  // ---- 绑定事件 ----
  bindButtonEvents();
  if (isMobile) {
    bindExpandToggle();
  } else {
    // ★ 切回桌面模式时，清理移动端遗留的 document 监听器
    if (_documentClickHandler) {
      document.removeEventListener('click', _documentClickHandler);
      _documentClickHandler = null;
    }
    isExpanded = false;
  }

  // ---- 兜底：通知 uiRuntime 扫描一次 ----
  // extraSlot 全程在 DOM 中，rescan 不会重复填充已填充的插件
  try {
    rescan();
  } catch (_) {
    // uiRuntime 可能尚未启动，忽略
  }
}

// ============================================================
// 移动端展开/折叠
// ============================================================

function bindExpandToggle() {
  const expandToggle = document.getElementById('expandToggleBtn');
  // 注：buttonsContainer 是 .sidebar-footer 的直接子节点，
  //     .secondary-row 是其内嵌子节点，后代选择器 .sidebar-footer .secondary-row 依然有效。
  const secondaryRow = document.querySelector('.sidebar-footer .secondary-row');

  if (!expandToggle || !secondaryRow) return;

  // ★ 防御性：确保初始状态为收起，避免状态错位
  isExpanded = false;
  secondaryRow.style.display = 'none';

  // 移除旧监听（防重复绑定）
  const newToggle = expandToggle.cloneNode(true);
  expandToggle.parentNode?.replaceChild(newToggle, expandToggle);

  // 重置图标状态
  newToggle.innerHTML = '<i class="fas fa-ellipsis-h"></i>';
  newToggle.title = '展开更多';

  newToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    isExpanded = !isExpanded;
    secondaryRow.style.display = isExpanded ? 'flex' : 'none';
    newToggle.innerHTML = isExpanded
      ? '<i class="fas fa-chevron-up"></i>'
      : '<i class="fas fa-ellipsis-h"></i>';
    newToggle.title = isExpanded ? '收起' : '展开更多';
  });

  // ★ 先移除上一个 document 监听器，再绑定新的
  //   handler 内部通过 getElementById 动态查询当前元素，
  //   避免闭包持有已失效的 DOM 引用。
  if (_documentClickHandler) {
    document.removeEventListener('click', _documentClickHandler);
    _documentClickHandler = null;
  }

  const documentClickHandler = (e) => {
    if (!isExpanded) return;
    const footer = document.querySelector('.sidebar-footer');
    const container = document.getElementById('expandToggleContainer');
    if (footer?.contains(e.target) || container?.contains(e.target)) return;

    // 收起
    isExpanded = false;
    const currentRow = document.querySelector('.sidebar-footer .secondary-row');
    const currentToggle = document.getElementById('expandToggleBtn');
    if (currentRow) currentRow.style.display = 'none';
    if (currentToggle) {
      currentToggle.innerHTML = '<i class="fas fa-ellipsis-h"></i>';
      currentToggle.title = '展开更多';
    }
  };

  _documentClickHandler = documentClickHandler;
  document.addEventListener('click', documentClickHandler);

  secondaryRow.addEventListener('click', () => {
    if (isExpanded) {
      setTimeout(() => {
        isExpanded = false;
        secondaryRow.style.display = 'none';
        newToggle.innerHTML = '<i class="fas fa-ellipsis-h"></i>';
        newToggle.title = '展开更多';
      }, 300);
    }
  });
}

// ============================================================
// 绑定按钮事件
// ============================================================

function bindButtonEvents() {
  const bind = (id, handler) => {
    const btn = document.getElementById(id);
    if (btn) {
      const newBtn = btn.cloneNode(true);
      btn.parentNode?.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', handler);
    }
  };

  bind('themeToggleBtn', () => {
    import('../layout/theme.js').then(m => m.toggleTheme());
  });
  bind('socialBtn', () => {
    import('../screens/socialUI.js').then(m => m.openSocialFeed());
  });
  bind('worldbookBtn', () => {
    import('../screens/worldBookUI.js').then(m => m.renderWorldBookList());
  });
  bind('pluginBtn', () => {
    import('../screens/pluginManagerUI.js').then(m => m.renderPluginManagerModal());
  });
  bind('settingsBtn', async () => {
    const { renderSettingsModal, bindSettingsSave } = await import('../screens/settingsUI.js');
    const { openModal } = await import('../components/modal.js');
    const html = renderSettingsModal();
    openModal(html);
    const modalContent = document.querySelector('#modalContent');
    bindSettingsSave(modalContent);
  });
  bind('importBtn', () => {
    import('../screens/importUI.js').then(m => m.renderImportModal());
  });
  bind('createBtn', () => {
    import('../screens/characterFormUI.js').then(m => m.renderCharacterForm(null));
  });
  bind('createGroupBtn', () => {
    import('../screens/groupFormUI.js').then(m => m.renderGroupForm());
  });
}

// ============================================================
// 对外 API
// ============================================================

export function getExpandState() {
  return isExpanded;
}