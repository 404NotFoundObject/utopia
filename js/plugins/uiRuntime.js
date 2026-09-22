/**
 * @module plugins/uiRuntime
 * @description 中心化 UI 槽位系统
 *
 * 设计：
 *   - 通过 data-plugin-slot="xxx" 在 DOM 中标注锚点
 *   - 插件注册 slotName → 渲染函数
 *   - MutationObserver 自动监听 DOM 变化，填充新出现的槽位
 *   - 支持"渲染器覆写"（用于气泡样式改造等）
 *
 * 使用（插件 ui.js）：
 *   uiApi.registerSlot('message-actions', (ctx) => {
 *     const btn = document.createElement('button');
 *     btn.textContent = '✏️';
 *     btn.onclick = () => editMessage(ctx.messageId);
 *     return btn;
 *   });
 */

// ============================================================
// 注册表
// ============================================================

// slotName -> [{ pluginId, render, priority }]
const slotRegistry = new Map();

// slotName -> [{ pluginId, override, priority }]
const rendererRegistry = new Map();

let observer = null;
let isStarted = false;

// ============================================================
// 槽位注册
// ============================================================

/**
 * 注册槽位渲染器
 * @param {string} pluginId - 插件ID
 * @param {string} slotName - 槽位名
 * @param {Function} renderFn - 渲染函数 (context) => Element | DocumentFragment | string | null
 * @param {Object} [opts]
 * @param {number} [opts.priority=100] - 优先级（数字小优先）
 */
export function registerSlot(pluginId, slotName, renderFn, opts = {}) {
  if (typeof renderFn !== 'function') {
    throw new TypeError('槽位渲染函数必须是函数');
  }
  if (!slotName || typeof slotName !== 'string') {
    throw new Error('slotName 必须是非空字符串');
  }

  const priority = typeof opts.priority === 'number' ? opts.priority : 100;

  if (!slotRegistry.has(slotName)) slotRegistry.set(slotName, []);
  const list = slotRegistry.get(slotName);

  // 避免重复注册
  if (list.some(s => s.pluginId === pluginId)) {
    console.warn(`[UIRuntime] ${pluginId} 已注册槽位 ${slotName}`);
    return;
  }

  list.push({ pluginId, render: renderFn, priority });
  list.sort((a, b) => a.priority - b.priority);

  // 立即应用到已存在的槽位
  applyToExisting(slotName);

  console.debug(`[UIRuntime] ${pluginId} 注册槽位 ${slotName}`);
}

/**
 * 注销单个槽位
 */
export function unregisterSlot(pluginId, slotName) {
  if (!slotRegistry.has(slotName)) return false;
  const list = slotRegistry.get(slotName);
  const idx = list.findIndex(s => s.pluginId === pluginId);
  if (idx === -1) return false;

  list.splice(idx, 1);
  if (list.length === 0) slotRegistry.delete(slotName);

  removeRenderedFromDom(pluginId, slotName);
  return true;
}

/**
 * 注销某插件的所有槽位
 */
export function unregisterAllSlots(pluginId) {
  for (const [slotName, list] of slotRegistry.entries()) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].pluginId === pluginId) list.splice(i, 1);
    }
    if (list.length === 0) slotRegistry.delete(slotName);
    removeRenderedFromDom(pluginId, slotName);
  }
}

// ============================================================
// 渲染器覆写
// ============================================================

/**
 * 覆写渲染器
 * @param {string} pluginId
 * @param {string} slotName
 * @param {Function} overrideFn - (args..., defaultRender) => any
 * @param {Object} [opts]
 * @param {number} [opts.priority=100]
 */
export function overrideRenderer(pluginId, slotName, overrideFn, opts = {}) {
  if (typeof overrideFn !== 'function') {
    throw new TypeError('覆写渲染器必须是函数');
  }
  if (!slotName || typeof slotName !== 'string') {
    throw new Error('slotName 必须是非空字符串');
  }

  const priority = typeof opts.priority === 'number' ? opts.priority : 100;

  if (!rendererRegistry.has(slotName)) rendererRegistry.set(slotName, []);
  const list = rendererRegistry.get(slotName);

  if (list.some(r => r.pluginId === pluginId)) {
    console.warn(`[UIRuntime] ${pluginId} 已覆写渲染器 ${slotName}`);
    return;
  }

  list.push({ pluginId, override: overrideFn, priority });
  list.sort((a, b) => a.priority - b.priority);

  console.debug(`[UIRuntime] ${pluginId} 覆写渲染器 ${slotName}`);
}

/**
 * 注销单个渲染器覆写
 */
export function unregisterRenderer(pluginId, slotName) {
  if (!rendererRegistry.has(slotName)) return false;
  const list = rendererRegistry.get(slotName);
  const idx = list.findIndex(r => r.pluginId === pluginId);
  if (idx === -1) return false;

  list.splice(idx, 1);
  if (list.length === 0) rendererRegistry.delete(slotName);
  return true;
}

/**
 * 注销某插件的所有渲染器覆写
 */
export function unregisterAllRenderers(pluginId) {
  for (const [slotName, list] of rendererRegistry.entries()) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].pluginId === pluginId) list.splice(i, 1);
    }
    if (list.length === 0) rendererRegistry.delete(slotName);
  }
}

/**
 * 获取某槽位的最终渲染器（链式叠加）
 *
 * @param {string} slotName
 * @param {Function} defaultRender - 默认渲染函数
 * @returns {Function}
 */
export function getRenderer(slotName, defaultRender) {
  const list = rendererRegistry.get(slotName);
  if (!list || list.length === 0) return defaultRender;

  // 链式叠加：每个覆写接收 (args..., 上一层渲染器)
  return function (...args) {
    let currentRender = defaultRender;
    for (const { override } of list) {
      const prevRender = currentRender;
      currentRender = (...innerArgs) => override(...innerArgs, prevRender);
    }
    return currentRender(...args);
  };
}

// ============================================================
// DOM 监听与填充
// ============================================================

/**
 * 启动 UI 运行时（监听 DOM 变化）
 */
export function startUIRuntime() {
  if (isStarted) return;
  isStarted = true;

  if (typeof document === 'undefined') {
    console.warn('[UIRuntime] 当前环境无 document');
    return;
  }

  if (typeof MutationObserver === 'undefined') {
    console.warn('[UIRuntime] 当前环境不支持 MutationObserver');
    // 降级：定期扫描
    setInterval(() => processNode(document.body), 1000);
    return;
  }

  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) {
          processNode(node);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // 初始扫描
  processNode(document.body);

  console.log('[UIRuntime] 已启动');
}

/**
 * 停止 UI 运行时
 */
export function stopUIRuntime() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  isStarted = false;
}

/**
 * 处理节点：检查自身和所有子节点中的槽位
 */
function processNode(node) {
  if (!node) return;

  if (node.matches && node.matches('[data-plugin-slot]')) {
    fillSlot(node);
  }

  if (node.querySelectorAll) {
    const slots = node.querySelectorAll('[data-plugin-slot]');
    for (const slot of slots) {
      fillSlot(slot);
    }
  }
}

/**
 * 填充单个槽位
 *
 */
function fillSlot(slotEl) {
  const slotName = slotEl.dataset.pluginSlot;
  const renderers = slotRegistry.get(slotName);
  if (!renderers || renderers.length === 0) return;

  const context = extractContext(slotEl, slotName);

  for (const { pluginId, render } of renderers) {
    // 检查当前槽位是否已有该插件渲染的直接子节点
    const alreadyRendered = Array.from(slotEl.children).some(
      (child) => child.dataset && child.dataset.pluginId === pluginId
    );
    if (alreadyRendered) continue;

    try {
      const result = render(context);
      if (!result) continue;

      const node = normalizeRenderResult(result);
      if (!node) {
        console.warn(`[Plugin:${pluginId}] 槽位 ${slotName} 返回无效值`);
        continue;
      }

      // 标记插件归属，便于卸载
      if (node instanceof Element) {
        node.dataset.pluginId = pluginId;
        node.dataset.pluginSlotContent = slotName;
        slotEl.appendChild(node);
      } else {
        // DocumentFragment：包装一层
        const wrapper = document.createElement('div');
        wrapper.dataset.pluginId = pluginId;
        wrapper.dataset.pluginSlotContent = slotName;
        wrapper.style.display = 'contents';
        wrapper.appendChild(node);
        slotEl.appendChild(wrapper);
      }
    } catch (err) {
      console.error(`[Plugin:${pluginId}] 槽位 ${slotName} 渲染失败:`, err);
    }
  }
}

/**
 * 归一化渲染结果
 */
function normalizeRenderResult(result) {
  if (typeof result === 'string') {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = result;
    const fragment = document.createDocumentFragment();
    while (wrapper.firstChild) {
      fragment.appendChild(wrapper.firstChild);
    }
    return fragment;
  }
  if (result instanceof DocumentFragment) return result;
  if (result instanceof Element) return result;
  return null;
}

/**
 * 从 DOM 上下文提取信息，传递给渲染器
 */
function extractContext(slotEl, slotName) {
  const messageEl = slotEl.closest('[data-message-id]');
  const characterEl = slotEl.closest('[data-character-id]');
  const groupEl = slotEl.closest('[data-group-id]');

  return {
    slotName,
    slotEl,
    messageEl,
    messageId: messageEl ? messageEl.dataset.messageId : null,
    messageRole: messageEl ? (messageEl.dataset.messageRole || null) : null,
    characterEl,
    characterId: characterEl ? characterEl.dataset.characterId : null,
    groupEl,
    groupId: groupEl ? groupEl.dataset.groupId : null,
    document,
    query: (sel) => {
      const root = slotEl.closest('.message, .group-message');
      return root ? root.querySelector(sel) : null;
    },
  };
}

/**
 * 立即应用到所有已存在的槽位
 */
function applyToExisting(slotName) {
  if (typeof document === 'undefined') return;
  const slots = document.querySelectorAll(`[data-plugin-slot="${slotName}"]`);
  for (const slot of slots) {
    fillSlot(slot);
  }
}

/**
 * 从 DOM 中移除某插件在指定槽位的已渲染内容
 */
function removeRenderedFromDom(pluginId, slotName) {
  if (typeof document === 'undefined') return;
  const selector = `[data-plugin-slot="${slotName}"] [data-plugin-id="${pluginId}"]`;
  const elements = document.querySelectorAll(selector);
  for (const el of elements) {
    el.remove();
  }
}

// ============================================================
// 调试工具
// ============================================================

export function listSlots() {
  const result = {};
  for (const [slotName, list] of slotRegistry.entries()) {
    result[slotName] = list.map(s => ({ pluginId: s.pluginId, priority: s.priority }));
  }
  return result;
}

export function listRenderers() {
  const result = {};
  for (const [slotName, list] of rendererRegistry.entries()) {
    result[slotName] = list.map(r => ({ pluginId: r.pluginId, priority: r.priority }));
  }
  return result;
}

/**
 * 手动触发一次全量扫描（调试用）
 */
export function rescan() {
  if (typeof document === 'undefined') return;
  processNode(document.body);
}