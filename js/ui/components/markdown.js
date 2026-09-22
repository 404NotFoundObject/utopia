// js/ui/components/markdown.js - Markdown 渲染（安全过滤 + 结构增强 + 流式优化）

// ============================================================
// 常量
// ============================================================

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'del',
  'code', 'pre', 'blockquote',
  'ul', 'ol', 'li',
  'a', 'img',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'span', 'button', 'i',
];

const ALLOWED_ATTR = [
  'href', 'target', 'rel', 'src', 'alt', 'title',
  'class', 'data-lang',
];

const MAX_CACHE_SIZE = 200;

// ============================================================
// 初始化（幂等）
// ============================================================

let initialized = false;

function ensureInit() {
  if (initialized) return;
  initialized = true;
  configureDOMPurify();
  configureMarked();
}

// ============================================================
// DOMPurify 配置
// ============================================================

function configureDOMPurify() {
  // 外链自动加 rel + target
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href');
      if (href && /^https?:\/\//i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });

  // 图片源白名单
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'src' && node.nodeName === 'IMG') {
      if (!isAllowedImageSrc(data.attrValue)) {
        data.keepAttr = false;
      }
    }
  });
}

function isAllowedImageSrc(src) {
  if (!src) return false;
  if (src.startsWith('data:image/')) return true;
  if (src.startsWith('blob:')) return true;
  if (src.startsWith('/') && !src.startsWith('//')) return true;
  if (src.startsWith('./') || src.startsWith('../')) return true;
  try {
    const url = new URL(src, location.href);
    return url.origin === location.origin;
  } catch {
    return false;
  }
}

// ============================================================
// Marked 配置
// ============================================================

function configureMarked() {
  marked.use({
    renderer: {
      // 代码块：加 header + 语言标签 + 复制按钮
      code(code, lang) {
        const rawLang = (lang || '').trim().toLowerCase();
        const langLabel = rawLang || '代码';
        const escapedCode = escapeHtml(code);
        const langClass = rawLang ? ` language-${escapeHtml(rawLang)}` : '';

        return `<div class="code-block" data-lang="${escapeHtml(rawLang)}">
  <div class="code-header">
    <span class="code-lang">${escapeHtml(langLabel)}</span>
    <button class="code-copy-btn" type="button" title="复制代码">
      <i class="fas fa-copy"></i>
    </button>
  </div>
  <pre><code class="hljs${langClass}">${escapedCode}</code></pre>
</div>`;
      },

      // 行内代码
      codespan(code) {
        return `<code class="inline-code">${escapeHtml(code)}</code>`;
      },
    },
    breaks: true,
    gfm: true,
    pedantic: false,
    smartypants: false,
  });
}

// ============================================================
// 工具函数
// ============================================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text == null ? '' : text);
  return div.innerHTML;
}

// ============================================================
// 流式渲染：检测未闭合的语法
// ============================================================

/**
 * 检测文本中是否存在未闭合的 Markdown 语法
 *
 * 只检测对渲染结果影响最大的几种：
 *   - 未闭合的代码块 ```
 *   - 未闭合的粗体 ** 或 __
 *   - 未闭合的行内代码 `
 */
function hasUnclosedSyntax(text) {
  if (!text) return false;

  // 未闭合的代码块（``` 数量为奇数）
  const fenceCount = (text.match(/^```/gm) || []).length;
  if (fenceCount % 2 !== 0) return true;

  // 先剥离完整的代码块，避免其内部的符号干扰
  const stripped = text.replace(/```[\s\S]*?```/g, '');

  // 未闭合的粗体（** 数量为奇数）
  const boldCount = (stripped.match(/\*\*/g) || []).length;
  if (boldCount % 2 !== 0) return true;

  // 未闭合的下划线粗体
  const boldUCount = (stripped.match(/__/g) || []).length;
  if (boldUCount % 2 !== 0) return true;

  // 未闭合的行内代码
  const codeCount = (stripped.match(/`/g) || []).length;
  if (codeCount % 2 !== 0) return true;

  return false;
}

// ============================================================
// 渲染缓存（LRU）
// ============================================================

const renderCache = new Map();

function getCached(key) {
  if (!renderCache.has(key)) return null;
  const value = renderCache.get(key);
  renderCache.delete(key);
  renderCache.set(key, value);
  return value;
}

function setCached(key, value) {
  if (renderCache.has(key)) {
    renderCache.delete(key);
  } else if (renderCache.size >= MAX_CACHE_SIZE) {
    const firstKey = renderCache.keys().next().value;
    renderCache.delete(firstKey);
  }
  renderCache.set(key, value);
}

/**
 * 清空渲染缓存（当消息内容被修改时调用）
 */
export function clearRenderCache() {
  renderCache.clear();
}

// ============================================================
// 主渲染函数
// ============================================================

/**
 * 渲染 Markdown 文本为安全 HTML
 *
 * 保持原签名不变：renderMarkdown(text) → string
 *
 * @param {string} text - Markdown 源文本
 * @returns {string} 安全的 HTML 字符串
 */
export function renderMarkdown(text) {
  if (!text) return '';
  ensureInit();

  const cacheKey = 'md::' + text;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  try {
    let html = marked.parse(text);
    html = DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ADD_ATTR: ['target', 'rel'],
    });
    setCached(cacheKey, html);
    return html;
  } catch (err) {
    console.error('[Markdown] 渲染失败:', err);
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
}

/**
 * 流式渲染 Markdown 文本
 *
 * 流式输出过程中，未闭合的语法会导致渲染结果抖动。
 * 本函数检测这种情况，未闭合时降级为纯文本，闭合后恢复正常渲染。
 *
 * @param {string} text - 当前已接收的完整文本
 * @param {boolean} isComplete - 流是否已完成
 * @returns {string} 安全的 HTML 字符串
 */
export function renderMarkdownStream(text, isComplete = false) {
  if (!text) return '';

  if (isComplete) {
    return renderMarkdown(text);
  }

  if (hasUnclosedSyntax(text)) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  return renderMarkdown(text);
}

// ============================================================
// 代码块复制按钮的事件委托
// ============================================================

let copyHandlerAttached = false;

/**
 * 初始化代码块复制按钮的事件委托
 *
 * 应在应用启动时调用一次。之后所有动态插入的代码块，
 * 只要在指定容器内，点击复制按钮都会自动生效。
 *
 * @param {HTMLElement} container - 事件委托的根容器（如 #chatMessages）
 */
export function initCodeCopyHandler(container) {
  if (copyHandlerAttached || !container) return;
  copyHandlerAttached = true;

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('.code-copy-btn');
    if (!btn) return;
    e.stopPropagation();

    const codeBlock = btn.closest('.code-block');
    if (!codeBlock) return;
    const codeEl = codeBlock.querySelector('pre > code');
    if (!codeEl) return;

    const code = codeEl.textContent || '';

    try {
      await navigator.clipboard.writeText(code);
      showCopyFeedback(btn, true);
    } catch (err) {
      console.warn('[Markdown] clipboard API 失败，尝试降级:', err);
      try {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        showCopyFeedback(btn, true);
      } catch (e2) {
        console.error('[Markdown] 复制失败:', e2);
        showCopyFeedback(btn, false);
      }
    }
  });
}

function showCopyFeedback(btn, success) {
  const icon = btn.querySelector('i');
  if (!icon) return;
  const originalClass = icon.className;
  icon.className = success ? 'fas fa-check' : 'fas fa-times';
  btn.classList.add(success ? 'copied' : 'copy-failed');
  setTimeout(() => {
    icon.className = originalClass;
    btn.classList.remove('copied', 'copy-failed');
  }, 1500);
}