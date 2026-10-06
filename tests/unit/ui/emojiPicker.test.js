import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ensureEmojiButton,
  isEmojiPanelOpen,
  closeEmojiPanel,
  getRecentEmojis,
} from '../../../js/ui/components/emojiPicker.js';

/**
 * Emoji 托盘：入口按钮注入位置、面板开合、插入与最近使用持久化、
 * 删除键，以及 PC（弹出于按钮上方）/ 移动端（输入栏下方流式展开）
 * 两种挂载形态。
 *
 * jsdom 的 matchMedia 垫片返回 matches:false → 默认走 PC 路径；
 * 移动端路径用 vi.stubGlobal 覆盖 matchMedia 模拟 ≤768px。
 */

/** 模拟 app.js 注入语音按钮后的输入栏结构（textarea + 麦克风包在 .input-wrap 内） */
function mountInputRow() {
  const chatInput = document.getElementById('chatInput');
  chatInput.innerHTML =
    '<div class="input-wrap">' +
    '<textarea id="messageInput" rows="2"></textarea>' +
    '<button class="mic-btn"></button>' +
    '</div>' +
    '<button id="sendBtn" class="send-btn"></button>';
  return chatInput;
}

beforeEach(() => {
  localStorage.removeItem('utopia:emoji-recent');
  document.getElementById('emojiBtn')?.remove();
  document.getElementById('emojiPanel')?.remove();
  mountInputRow();
});

describe('入口按钮', () => {
  it('注入在输入框包裹层之后、发送按钮之前（语音按钮在包裹层内）', () => {
    const btn = ensureEmojiButton();
    expect(btn).not.toBeNull();
    const chatInput = document.getElementById('chatInput');
    const children = [...chatInput.children].map((el) => el.id || el.className);
    expect(children.indexOf('input-wrap')).toBeLessThan(children.indexOf('emojiBtn'));
    expect(children.indexOf('emojiBtn')).toBeLessThan(children.indexOf('sendBtn'));
    // 语音按钮框在 .input-wrap 内（移动端靠它定位进输入框），表情按钮排在其后
    expect(btn.previousElementSibling?.className).toBe('input-wrap');
  });

  it('幂等：重复调用不产生第二个按钮', () => {
    ensureEmojiButton();
    ensureEmojiButton();
    expect(document.querySelectorAll('#emojiBtn')).toHaveLength(1);
  });

  it('无发送按钮时不注入（聊天页未就绪）', () => {
    document.getElementById('sendBtn').remove();
    expect(ensureEmojiButton()).toBeNull();
  });
});

describe('面板开合（PC：挂 body，弹出在按钮上方）', () => {
  it('点击按钮打开/再点收起', () => {
    const btn = ensureEmojiButton();
    btn.click();
    expect(isEmojiPanelOpen()).toBe(true);
    const panel = document.getElementById('emojiPanel');
    expect(panel.hidden).toBe(false);
    expect(panel.parentNode).toBe(document.body);
    btn.click();
    expect(isEmojiPanelOpen()).toBe(false);
    expect(panel.hidden).toBe(true);
  });

  it('点击面板外部关闭；面板内部点击不关闭', () => {
    const btn = ensureEmojiButton();
    btn.click();
    const panel = document.getElementById('emojiPanel');
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(isEmojiPanelOpen()).toBe(false);

    btn.click();
    panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(isEmojiPanelOpen()).toBe(true);
    closeEmojiPanel();
  });

  it('Escape 关闭', () => {
    const btn = ensureEmojiButton();
    btn.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isEmojiPanelOpen()).toBe(false);
  });

  it('面板包含「最近使用」与「所有表情」两节', () => {
    ensureEmojiButton().click();
    const panel = document.getElementById('emojiPanel');
    expect(panel.querySelector('[data-section="recent"] .emoji-section-title').textContent).toBe('最近使用');
    expect(panel.querySelector('[data-section="all"] .emoji-section-title').textContent).toBe('所有表情');
    // 所有表情网格非空
    expect(panel.querySelectorAll('[data-grid="all"] .emoji-cell').length).toBeGreaterThan(50);
    closeEmojiPanel();
  });
});

describe('插入与最近使用', () => {
  it('点击表情插入输入框光标处并派发 input 事件', () => {
    const input = document.getElementById('messageInput');
    input.value = '你好';
    input.setSelectionRange(2, 2);
    const spy = vi.fn();
    input.addEventListener('input', spy);

    ensureEmojiButton().click();
    const cell = document.querySelector('[data-grid="all"] .emoji-cell');
    const emoji = cell.textContent;
    cell.click();

    expect(input.value).toBe('你好' + emoji);
    expect(spy).toHaveBeenCalled();
    closeEmojiPanel();
  });

  it('最近使用：去重置顶、持久化到 localStorage', () => {
    ensureEmojiButton().click();
    const cells = [...document.querySelectorAll('[data-grid="all"] .emoji-cell')];
    cells[0].click(); // 😄
    cells[1].click(); // 😃
    cells[0].click(); // 😄 再点 → 置顶去重
    expect(getRecentEmojis()[0]).toBe(cells[0].textContent);
    expect(getRecentEmojis()).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem('utopia:emoji-recent'))).toEqual(getRecentEmojis());
    closeEmojiPanel();
  });

  it('最近使用上限 24 个', () => {
    ensureEmojiButton().click();
    const cells = [...document.querySelectorAll('[data-grid="all"] .emoji-cell')];
    for (let i = 0; i < 30; i++) cells[i].click();
    expect(getRecentEmojis()).toHaveLength(24);
    closeEmojiPanel();
  });

  it('重开面板时「最近使用」节按持久化数据渲染', () => {
    localStorage.setItem('utopia:emoji-recent', JSON.stringify(['🎉', '🔥']));
    ensureEmojiButton().click();
    const recentCells = [...document.querySelectorAll('[data-grid="recent"] .emoji-cell')];
    expect(recentCells.map((c) => c.textContent)).toEqual(['🎉', '🔥']);
    closeEmojiPanel();
  });

  it('无历史时「最近使用」节隐藏', () => {
    ensureEmojiButton().click();
    expect(
      document.querySelector('[data-section="recent"]').style.display
    ).toBe('none');
    closeEmojiPanel();
  });
});

describe('删除键', () => {
  it('删除光标前一个字符并派发 input 事件', () => {
    const input = document.getElementById('messageInput');
    input.value = '好的😄';
    input.setSelectionRange(4, 4); // 光标在 😄 之后（😄 占 2 个码元）
    const spy = vi.fn();
    input.addEventListener('input', spy);

    ensureEmojiButton().click();
    document.querySelector('.emoji-del-key').click();

    expect(input.value).toBe('好的');
    expect(spy).toHaveBeenCalled();
    closeEmojiPanel();
  });
});

describe('移动端挂载形态（≤768px）', () => {
  it('面板挂在 #chatContainer 内、紧跟输入栏之后', () => {
    vi.stubGlobal('matchMedia', (query) => ({
      matches: query === '(max-width: 768px)',
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    const btn = ensureEmojiButton();
    btn.click();
    const panel = document.getElementById('emojiPanel');
    const chatContainer = document.getElementById('chatContainer');
    expect(panel.parentNode).toBe(chatContainer);
    expect(panel.previousElementSibling?.id).toBe('chatInput');
    expect(panel.classList.contains('mobile')).toBe(true);
    closeEmojiPanel();
    vi.unstubAllGlobals();
  });
});
