/**
 * DOM 骨架注入。
 *
 * 应用的部分模块在**模块作用域**就读取 DOM 节点，例如：
 *   - js/ui/components/modal.js  → document.getElementById('modalOverlay' / 'modalContent')
 *   - js/ui/components/toast.js  → document.getElementById('toastContainer')
 * 这些模块一旦被静态 import 就立即求值。若此时节点不存在，模块内部会持有 null 引用，
 * 后续所有操作静默失效。因此必须在测试模块图加载之前把骨架铺好。
 *
 * 关键约束：骨架节点一经创建就**不可重建**。模块导入期捕获的是节点对象本身，
 * 若在用例之间重建这些节点，模块持有的将是游离（detached）引用，用例仍会静默失败。
 * 因此 resetDom() 只清理内容与测试产生的临时节点，绝不重建骨架。
 *
 * 骨架结构与 index.html 保持一致，只保留测试需要的容器。
 */

export const SKELETON_ROOT_ID = 'test-skeleton-root';

/** 骨架中需要在用例之间清空内容的容器 */
const CONTENT_CONTAINERS = ['modalContent', 'toastContainer', 'chatMessages', 'characterList'];

const SKELETON_HTML = `
  <div id="app">
    <aside id="sidebar">
      <div class="sidebar-header"><span class="logo">Utopia</span></div>
      <div class="sidebar-content">
        <h3>角色与群组</h3>
        <ul id="characterList" class="character-list"></ul>
      </div>
      <div class="sidebar-footer"></div>
    </aside>
    <div id="sidebarOverlay" class="sidebar-overlay"></div>
    <main id="main">
      <header id="chatHeader">
        <div id="characterInfo">
          <img id="charAvatar" alt="头像">
          <div>
            <h2 id="charName">未选择</h2>
            <p id="charRelation">--</p>
          </div>
        </div>
        <div class="header-actions"></div>
      </header>
      <div id="welcomePage"></div>
      <div id="chatContainer">
        <div id="chatMessages"></div>
        <div id="chatInput">
          <textarea id="messageInput" rows="2"></textarea>
          <button id="sendBtn" class="send-btn"></button>
        </div>
      </div>
    </main>
  </div>
  <div id="modalOverlay" class="modal-overlay hidden">
    <div id="modalContent" class="modal-content"></div>
  </div>
  <div id="toastContainer" class="toast-container"></div>
`;

function getRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById(SKELETON_ROOT_ID);
}

/**
 * 确保应用所需的 DOM 容器存在。幂等：可重复调用，已存在的骨架不会被重建。
 * @returns {void}
 */
export function installDomSkeleton() {
  if (typeof document === 'undefined') return;

  if (getRoot()) {
    // 骨架已存在，仅确认仍挂在 body 上（测试可能整体清空过 body）
    const root = getRoot();
    if (root.parentNode !== document.body) {
      document.body.appendChild(root);
    }
    return;
  }

  const root = document.createElement('div');
  root.id = SKELETON_ROOT_ID;
  root.setAttribute('data-test-skeleton', 'true');
  root.innerHTML = SKELETON_HTML;
  document.body.appendChild(root);
}

/**
 * 把 DOM 重置为干净的骨架状态，用于每个用例开始前。
 * 不重建骨架节点，只清空内容并移除测试产生的临时节点。
 * @returns {void}
 */
export function resetDom() {
  if (typeof document === 'undefined') return;

  installDomSkeleton();
  const root = getRoot();
  if (!root) return;

  // 移除测试期间挂到 body 上的一次性节点（如 banner 容器），保留骨架根
  for (const child of Array.from(document.body.children)) {
    if (child !== root) child.remove();
  }

  // 清空容器内容，但不替换容器本身
  for (const id of CONTENT_CONTAINERS) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  }

  // 恢复模态框的初始隐藏态
  const overlay = document.getElementById('modalOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.style.display = '';
  }

  document.body.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');

  // 清掉 stash 的样式表（主题相关用例可能注入过）
  for (const style of Array.from(document.querySelectorAll('style[data-test-style]'))) {
    style.remove();
  }
}
