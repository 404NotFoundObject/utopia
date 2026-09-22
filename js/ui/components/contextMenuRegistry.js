/**
 * 全局右键菜单注册表。
 *
 * 特性：
 *   - 单一监听器 + 单一菜单 DOM
 *   - 多 provider 合并（按 priority 升序）
 *   - provider 支持返回同步数组或 Promise
 *   - 竞态防护（token）：连续右键丢弃过期结果
 *
 * Provider 签名：
 *   (target, event) => MenuItem[] | Promise<MenuItem[]> | null | []
 *
 * opts:
 *   priority:  数字越小越先执行（默认 100）
 *   exclusive: true 时，一旦返回非空 items，其余 provider 不再执行
 *   claim:     true 时，返回非空 items 后跳过后续 provider
 *   pluginId:  插件 ID（可选，用于按插件批量卸载）
 *
 */

const registrations = new Map();
let listenerAttached = false;
let activeMenu = null;
let idCounter = 0;
let _ctxToken = 0;

function generateId() {
  return `ctx_${++idCounter}_${Date.now().toString(36)}`;
}

function ensureListener() {
  if (listenerAttached || typeof document === 'undefined') return;
  document.addEventListener('contextmenu', handleContextMenu, true);
  listenerAttached = true;
}

function releaseListenerIfEmpty() {
  if (!listenerAttached) return;
  if (registrations.size > 0) return;
  document.removeEventListener('contextmenu', handleContextMenu, true);
  listenerAttached = false;
}

export function register(selector, provider, opts = {}) {
  if (!selector || typeof selector !== 'string') {
    throw new Error('contextMenuRegistry.register: selector 必须是非空字符串');
  }
  if (typeof provider !== 'function') {
    throw new Error('contextMenuRegistry.register: provider 必须是函数');
  }

  const entry = {
    id: generateId(),
    selector,
    priority: typeof opts.priority === 'number' ? opts.priority : 100,
    exclusive: opts.exclusive === true,
    claim: opts.claim === true,
    pluginId: typeof opts.pluginId === 'string' ? opts.pluginId : null,
    provider,
  };

  if (!registrations.has(selector)) {
    registrations.set(selector, new Set());
  }
  registrations.get(selector).add(entry);

  ensureListener();

  return () => {
    const set = registrations.get(selector);
    if (set) {
      set.delete(entry);
      if (set.size === 0) registrations.delete(selector);
    }
    releaseListenerIfEmpty();
  };
}

/**
 *
 * 用于插件卸载时清理右键菜单，避免菜单项残留并调用已销毁的插件逻辑。
 *
 * @param {string} pluginId
 * @returns {number} 被移除的 provider 数量
 */
export function unregisterByPlugin(pluginId) {
  if (!pluginId || typeof pluginId !== 'string') return 0;

  let removed = 0;
  for (const [selector, set] of registrations.entries()) {
    for (const entry of Array.from(set)) {
      if (entry.pluginId === pluginId) {
        set.delete(entry);
        removed++;
      }
    }
    if (set.size === 0) {
      registrations.delete(selector);
    }
  }

  releaseListenerIfEmpty();
  return removed;
}

function hasMatchingSelector(target) {
  if (!target || typeof target.closest !== 'function') return false;
  for (const selector of registrations.keys()) {
    if (target.closest(selector)) return true;
  }
  return false;
}

function collectMatches(target) {
  const matched = [];
  for (const [selector, providerSet] of registrations.entries()) {
    const el = target.closest(selector);
    if (!el) continue;
    for (const entry of providerSet) {
      matched.push({ entry, target: el });
    }
  }
  return matched;
}

function handleContextMenu(e) {
  if (activeMenu && activeMenu.contains(e.target)) return;
  close();

  if (!hasMatchingSelector(e.target)) return;

  if (typeof e.preventDefault === 'function') e.preventDefault();
  if (typeof e.stopPropagation === 'function') e.stopPropagation();

  collectAndShowAsync(e);
}

async function collectAndShowAsync(e) {
  const myToken = ++_ctxToken;

  const matched = collectMatches(e.target);
  if (matched.length === 0) return;

  matched.sort((a, b) => a.entry.priority - b.entry.priority);

  const groups = [];
  for (const { entry, target } of matched) {
    let result;
    try {
      result = entry.provider(target, e);
      if (result instanceof Promise) {
        result = await result;
      }
    } catch (err) {
      console.error(`[ContextMenuRegistry] provider 执行失败 (${entry.selector}):`, err);
      continue;
    }

    if (myToken !== _ctxToken) return;

    if (!result || !Array.isArray(result) || result.length === 0) continue;

    for (const item of result) {
      if (item && typeof item === 'object' && !item.separator && !item._target) {
        item._target = target;
      }
    }

    if (entry.exclusive) {
      groups.length = 0;
      groups.push(result);
      break;
    }

    groups.push(result);
    if (entry.claim) break;
  }

  if (myToken !== _ctxToken) return;
  if (groups.length === 0) return;

  const finalItems = [];
  for (let i = 0; i < groups.length; i++) {
    if (i > 0) finalItems.push({ separator: true });
    finalItems.push(...groups[i]);
  }

  show(finalItems, e.clientX, e.clientY);
}

export async function trigger(target, x, y) {
  if (!target || typeof target.closest !== 'function') return;
  close();
  await collectAndShowAsync({
    target,
    clientX: x,
    clientY: y,
    preventDefault: () => {},
    stopPropagation: () => {},
  });
}

function buildMenuElement(items) {
  const menu = document.createElement('div');
  menu.className = 'message-context-menu';
  menu.style.position = 'fixed';

  for (const item of items) {
    if (!item) continue;

    if (item.separator) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height: 1px; background: var(--color-border); margin: 4px 0;';
      menu.appendChild(sep);
      continue;
    }

    const btn = document.createElement('button');
    btn.type = 'button';

    if (item.icon) {
      const icon = document.createElement('i');
      icon.className = `fas ${item.icon}`;
      icon.style.marginRight = '6px';
      btn.appendChild(icon);
    }

    btn.appendChild(document.createTextNode(item.label || ''));

    if (item.danger) btn.style.color = 'var(--color-danger)';

    const isDisabled = item.disabled === true || item._disabled === true;
    if (isDisabled) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    }

    const handler = item.onClick || item.action;
    if (typeof handler === 'function' && !isDisabled) {
      btn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        close();
        try {
          handler(evt, item._target || null);
        } catch (err) {
          console.error('[ContextMenuRegistry] 菜单项执行失败:', err);
        }
      });
    }

    menu.appendChild(btn);
  }

  return menu;
}

export function show(items, x, y) {
  close();

  if (!items || items.length === 0) return;

  const menu = buildMenuElement(items);
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const maxX = Math.max(0, window.innerWidth - rect.width - 8);
  const maxY = Math.max(0, window.innerHeight - rect.height - 8);

  menu.style.left = Math.min(x, maxX) + 'px';
  menu.style.top = Math.min(y, maxY) + 'px';

  activeMenu = menu;

  setTimeout(() => {
    if (!activeMenu) return;
    document.addEventListener('click', onGlobalClick, true);
    document.addEventListener('keydown', onGlobalKeydown, true);
    window.addEventListener('scroll', onGlobalScroll, true);
    window.addEventListener('resize', onGlobalResize);
  }, 10);
}

export function close() {
  if (!activeMenu) return;
  activeMenu.remove();
  activeMenu = null;
  document.removeEventListener('click', onGlobalClick, true);
  document.removeEventListener('keydown', onGlobalKeydown, true);
  window.removeEventListener('scroll', onGlobalScroll, true);
  window.removeEventListener('resize', onGlobalResize);
}

function onGlobalClick(e) {
  if (activeMenu && !activeMenu.contains(e.target)) close();
}

function onGlobalKeydown(e) {
  if (e.key === 'Escape') close();
}

function onGlobalScroll() { close(); }
function onGlobalResize() { close(); }

export function list() {
  const result = [];
  for (const [selector, set] of registrations.entries()) {
    for (const entry of set) {
      result.push({
        selector,
        priority: entry.priority,
        pluginId: entry.pluginId,
      });
    }
  }
  return result;
}

export default { register, unregisterByPlugin, trigger, show, close, list };