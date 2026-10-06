/**
 * Emoji 托盘（表情选择面板）。
 *
 * 单例面板 + 单例入口按钮（#emojiBtn，插在语音按钮与发送按钮之间）：
 * - PC（>768px）：面板挂 body，弹出在入口按钮上方（微信桌面版样式）；
 * - 移动端（≤768px）：面板挂 #chatContainer（#chatInput 之后）流式展开，
 *   占据输入栏下方空间，带右下角删除键（微信手机版样式）。
 *
 * 「最近使用」持久化在 localStorage（键 utopia:emoji-recent，最多 24 个）。
 * 插入目标统一是 #messageInput 光标处，插入后派发 input 事件以触发
 * 输入框自动增高与 @ 提及检测等既有监听。
 */

const RECENT_KEY = 'utopia:emoji-recent';
const RECENT_MAX = 24;

// 常用表情（微信风格顺序：笑脸 → 手势 → 情绪符号 → 动物/物体）
const EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
  '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
  '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔',
  '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
  '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮',
  '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐',
  '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦', '😧',
  '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓',
  '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '💀', '💩', '🤡',
  '👋', '🤚', '✋', '👌', '🤌', '✌️', '🤞', '🤟', '🤘', '🤙',
  '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛',
  '🤜', '👏', '🙌', '🤝', '🙏', '💪', '💅',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❣️',
  '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💯', '💥', '✨',
  '🌟', '⭐', '🔥', '🎉', '🎊', '🎁', '🎈', '🍰', '☕', '🍵',
  '🌙', '☀️', '🌈', '⚡', '❄️', '🌸', '🌹', '🐶', '🐱', '🐼',
];

const state = {
  btn: null,
  panel: null,
  open: false,
};

// ---- 视口判定（微信主题与通用布局共用断点：768px） ----

function isMobileViewport() {
  return window.matchMedia('(max-width: 768px)').matches;
}

// ---- 最近使用 ----

export function getRecentEmojis() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((e) => typeof e === 'string') : [];
  } catch (e) {
    console.warn('[EmojiPicker] 读取最近使用失败:', e);
    return [];
  }
}

function saveRecentEmojis(list) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch (e) {
    console.warn('[EmojiPicker] 写入最近使用失败:', e);
  }
}

function pushRecent(emoji) {
  const list = getRecentEmojis().filter((e) => e !== emoji);
  list.unshift(emoji);
  saveRecentEmojis(list);
  renderRecent();
}

// ---- 输入框操作 ----

function insertEmoji(emoji) {
  const input = document.getElementById('messageInput');
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  if (typeof input.setRangeText === 'function') {
    input.setRangeText(emoji, start, end, 'end');
  } else {
    input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
  }
  input.focus();
  // 触发输入框自动增高、@提及检测等既有 input 监听
  input.dispatchEvent(new Event('input', { bubbles: true }));
  pushRecent(emoji);
}

function deleteOneChar() {
  const input = document.getElementById('messageInput');
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  if (start !== end) {
    input.setRangeText('', start, end, 'end');
  } else if (start > 0) {
    let delStart = start - 1;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      // 按字素删：emoji（代理对）、ZWJ 序列、变体选择符整体删除
      const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
      for (const segment of segmenter.segment(input.value.slice(0, start))) {
        delStart = segment.index;
      }
    } else {
      const code = input.value.charCodeAt(delStart);
      if (code >= 0xdc00 && code <= 0xdfff && delStart > 0) delStart -= 1;
    }
    input.setRangeText('', delStart, start, 'end');
  }
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---- 面板 DOM ----

function buildGrid(emojis) {
  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  for (const emoji of emojis) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'emoji-cell';
    cell.textContent = emoji;
    cell.addEventListener('click', () => insertEmoji(emoji));
    grid.appendChild(cell);
  }
  return grid;
}

function buildPanel() {
  const panel = document.createElement('div');
  panel.id = 'emojiPanel';
  panel.hidden = true;

  const body = document.createElement('div');
  body.className = 'emoji-panel-body';

  const recentSection = document.createElement('div');
  recentSection.className = 'emoji-section';
  recentSection.dataset.section = 'recent';
  const recentTitle = document.createElement('div');
  recentTitle.className = 'emoji-section-title';
  recentTitle.textContent = '最近使用';
  const recentGrid = document.createElement('div');
  recentGrid.className = 'emoji-grid';
  recentGrid.dataset.grid = 'recent';
  recentSection.appendChild(recentTitle);
  recentSection.appendChild(recentGrid);
  body.appendChild(recentSection);

  const allSection = document.createElement('div');
  allSection.className = 'emoji-section';
  allSection.dataset.section = 'all';
  const allTitle = document.createElement('div');
  allTitle.className = 'emoji-section-title';
  allTitle.textContent = '所有表情';
  const allGrid = buildGrid(EMOJIS);
  allGrid.dataset.grid = 'all';
  allSection.appendChild(allTitle);
  allSection.appendChild(allGrid);
  body.appendChild(allSection);

  panel.appendChild(body);

  // 右下角删除键（微信手机版；PC 上由 CSS 隐藏）
  const delKey = document.createElement('button');
  delKey.type = 'button';
  delKey.className = 'emoji-del-key';
  delKey.title = '删除';
  delKey.innerHTML = '<i class="fas fa-backspace"></i>';
  delKey.addEventListener('click', deleteOneChar);
  panel.appendChild(delKey);

  panel.addEventListener('mousedown', (e) => e.stopPropagation());
  return panel;
}

function renderRecent() {
  if (!state.panel) return;
  const section = state.panel.querySelector('[data-section="recent"]');
  const grid = state.panel.querySelector('[data-grid="recent"]');
  if (!section || !grid) return;
  const recent = getRecentEmojis();
  section.style.display = recent.length ? '' : 'none';
  grid.innerHTML = '';
  for (const emoji of recent) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'emoji-cell';
    cell.textContent = emoji;
    cell.addEventListener('click', () => insertEmoji(emoji));
    grid.appendChild(cell);
  }
}

// ---- 挂载点：PC 挂 body（弹出定位），移动端挂 #chatContainer（流式展开） ----

function mountPanel() {
  if (!state.panel) return;
  const mobile = isMobileViewport();
  const chatContainer = document.getElementById('chatContainer');
  const target = (mobile && chatContainer) ? chatContainer : document.body;
  if (state.panel.parentNode !== target) {
    if (mobile && chatContainer) {
      // 输入栏之后：面板在输入栏正下方展开
      const chatInput = document.getElementById('chatInput');
      if (chatInput && chatInput.parentNode === chatContainer) {
        chatContainer.insertBefore(state.panel, chatInput.nextSibling);
      } else {
        chatContainer.appendChild(state.panel);
      }
    } else {
      document.body.appendChild(state.panel);
    }
  }
  state.panel.classList.toggle('mobile', mobile);
}

function positionPanelPc() {
  if (!state.panel || !state.btn) return;
  const rect = state.btn.getBoundingClientRect();
  const panel = state.panel;
  panel.style.visibility = 'hidden';
  panel.hidden = false;
  const panelRect = panel.getBoundingClientRect();
  // 默认对齐按钮左缘；若超出右视口则右对齐按钮
  let left = rect.left;
  if (left + panelRect.width > window.innerWidth - 8) {
    left = Math.max(8, rect.right - panelRect.width);
  }
  panel.style.left = Math.round(left) + 'px';
  // 面板底边贴按钮上方 8px
  const top = rect.top - panelRect.height - 8;
  panel.style.top = Math.max(8, Math.round(top)) + 'px';
  panel.style.visibility = '';
}

// ---- 开合 ----

export function isEmojiPanelOpen() {
  return state.open;
}

function openPanel() {
  if (!state.panel) return;
  mountPanel();
  renderRecent();
  if (isMobileViewport()) {
    state.panel.classList.add('open');
    state.panel.hidden = false;
  } else {
    state.panel.classList.remove('open');
    positionPanelPc();
  }
  state.open = true;
  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('keydown', onEscKey, true);
}

export function closeEmojiPanel() {
  if (!state.panel || !state.open) return;
  state.panel.hidden = true;
  state.panel.classList.remove('open');
  state.open = false;
  document.removeEventListener('mousedown', onDocMouseDown, true);
  document.removeEventListener('keydown', onEscKey, true);
}

function togglePanel() {
  if (state.open) closeEmojiPanel();
  else openPanel();
}

function onDocMouseDown(e) {
  if (!state.open) return;
  const t = e.target;
  if (state.panel && state.panel.contains(t)) return;
  if (state.btn && state.btn.contains(t)) return;
  closeEmojiPanel();
}

function onEscKey(e) {
  if (e.key === 'Escape') closeEmojiPanel();
}

// ---- 视口切换：重新挂载（PC 弹出 / 移动端流式），开着就先收起 ----

let resizeTimer = null;
function onResize() {
  if (!state.panel) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.open) closeEmojiPanel();
    mountPanel();
  }, 150);
}

// ---- 入口按钮 ----

export function ensureEmojiButton() {
  if (state.btn && document.body.contains(state.btn)) return state.btn;
  const sendBtn = document.getElementById('sendBtn');
  if (!sendBtn) return null;
  const chatInput = document.getElementById('chatInput');
  if (!chatInput) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'emojiBtn';
  btn.className = 'emoji-btn';
  btn.title = '表情';
  btn.innerHTML = '<i class="far fa-smile"></i>';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanel();
  });
  // 顺序：… → 语音按钮 → 表情按钮 → 发送按钮
  const micBtn = chatInput.querySelector('.mic-btn');
  if (micBtn && micBtn.parentNode === chatInput) {
    micBtn.after(btn);
  } else {
    chatInput.insertBefore(btn, sendBtn);
  }

  if (!state.panel) {
    state.panel = buildPanel();
    renderRecent();
    window.addEventListener('resize', onResize);
  }
  state.btn = btn;
  mountPanel();
  return btn;
}
