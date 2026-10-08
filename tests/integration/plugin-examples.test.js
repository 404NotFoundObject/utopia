/**
 * 官方示例插件集成验证（PC / 移动端共用的核心逻辑）。
 *
 * 目标：在 jsdom 中加载两个插件**真实**的 ui.js 源码，配合 faithful 的宿主 uiApi 桩
 * 与**真实**的 contextMenuRegistry，验证它们修复后的行为：
 *
 *   1. emotion-radar v2.2.0
 *      - 单聊：必须展示「当前选中角色」，而非上一次打开过的角色。
 *      - 群聊：必须按 currentMode/currentGroupId 从群成员读取角色列表，
 *        提供角色切换下拉（多角色可切换），不再沿用全局/缓存角色。
 *   2. edit-reply v2.1.0
 *      - 单聊消息（.message.assistant）右键 → 出现「编辑此回复」→ 保存写入 conversations。
 *      - 群聊消息（.group-message[data-message-role=assistant]）右键 → 同样可编辑，
 *        保存写入 group_messages（这是 v2.1.0 的核心修复）。
 *      - 非 assistant 消息（用户消息）不应出现编辑项。
 *
 * 关于「移动端」：插件代码与视口无关；移动端的长按本质上就是向 contextMenuRegistry
 * 派发一次 contextmenu 流程，本测试用 registry.trigger() 模拟这一路径，等价于在
 * Pixel 5 上长按。因此这里对 .group-message 的 trigger 验证即覆盖了移动端长按路径。
 *
 * 真正的浏览器 + 响应式布局 + 真机长按由 tests/e2e/plugin-examples.spec.js 覆盖。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import radarUi from '../../plugin-examples/example-emotion-radar/example-emotion-radar/ui.js';
import editReplyUi from '../../plugin-examples/example-edit-reply/example-edit-reply/ui.js';
import contextMenuRegistry from '../../js/ui/components/contextMenuRegistry.js';

// ---- 浏览器 API 垫片 ----
// canvas 在 jsdom 下无 2d 上下文，drawRadarOnCanvas 会安全跳过。
// requestAnimationFrame 已由 tests/setup/vitest.setup.js 强制为可用的 setTimeout 垫片。
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
});

// 收集并清理插件注册的所有右键菜单（插件未传 pluginId，故用包装器记录 unregister）
let activeUnregisters = [];
afterEach(() => {
  for (const un of activeUnregisters) {
    try { un(); } catch (_) {}
  }
  activeUnregisters = [];
  contextMenuRegistry.close();
});

function tick(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// faithful 宿主 uiApi 桩
// ============================================================
function makeDom() {
  return {
    h(selector, attrs = {}) {
      const tagMatch = selector.match(/^([a-zA-Z0-9]+)/);
      const tag = tagMatch ? tagMatch[1] : 'div';
      const el = document.createElement(tag);
      const classAndId = selector.slice(tag.length);
      const tokens = classAndId.match(/[.#][\w-]+/g) || [];
      for (const tok of tokens) {
        if (tok[0] === '.') el.classList.add(tok.slice(1));
        else el.setAttribute('id', tok.slice(1));
      }
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else el.setAttribute(k, v);
      }
      return el;
    },
    createIcon(name) {
      const i = document.createElement('i');
      i.className = 'fas ' + name;
      return i;
    },
    escapeHtml(text) {
      const d = document.createElement('div');
      d.textContent = String(text == null ? '' : text);
      return d.innerHTML;
    },
    cssVar(_name, fallback) {
      return fallback != null ? fallback : '#000';
    },
  };
}

function makeModal() {
  return {
    open: async (html) => {
      const c = document.getElementById('modalContent');
      c.innerHTML = html;
      const ov = document.getElementById('modalOverlay');
      ov.classList.remove('hidden');
      return true;
    },
    close: async () => {
      const ov = document.getElementById('modalOverlay');
      ov.classList.add('hidden');
    },
  };
}

/**
 * 构造宿主 uiApi 桩。
 * @param {Object} opts
 *   - state: { currentMode, currentGroupId, currentCharacterId }
 *   - character: 单聊 getCurrentCharacter 返回的角色
 *   - groupMembers: 群成员数组（含 memberType / memberId）
 *   - characters: { [id]: characterObj } 群成员角色查询表
 *   - groupMessages: { [id]: messageObj } 群消息查询表
 *   - conversation: 单聊会话对象
 *   - editText: dialog.prompt 返回的新文本
 */
function makeUiApi(opts = {}) {
  const {
    state = {},
    character = null,
    groupMembers = [],
    characters = {},
    groupMessages = {},
    conversation = null,
    editText = '修改后的回复',
  } = opts;

  const stores = {
    conversations: {
      update: vi.fn(async (id, data) => ({ id, ...data })),
    },
    group_messages: {
      get: vi.fn(async (id) => groupMessages[id] || null),
      update: vi.fn(async (id, data) => ({ id, ...data })),
    },
    group_members: {
      getByIndex: vi.fn(async (_idx, _val) => groupMembers),
    },
    characters: {
      get: vi.fn(async (id) => characters[id] || null),
    },
  };

  const toasts = [];
  const eventSubs = [];

  const api = {
    state: { get: (k) => state[k] },
    character: { getCurrentCharacter: async () => character },
    db: { getStores: async () => stores },
    emotion: { getEmotionLabel: async () => '平静' },
    events: { on: vi.fn((evt, _h) => { eventSubs.push(evt); return () => {}; }) },
    conversation: { getCurrentConversation: async () => conversation },
    chat: { renderConversation: vi.fn(async () => {}) },
  };

  const uiApi = {
    logger: { info() {}, debug() {}, warn() {}, error() {} },
    dom: makeDom(),
    registerSlot: (name, factory) => {
      const slot = document.querySelector(`[data-plugin-slot="${name}"]`);
      if (!slot) throw new Error('slot not found: ' + name);
      const el = factory();
      slot.appendChild(el);
      return () => { if (el.parentNode) el.parentNode.removeChild(el); };
    },
    modal: makeModal(),
    contextMenu: {
      // 包装真实 registry，记录 unregister 以便清理
      register: (sel, prov, o) => {
        const un = contextMenuRegistry.register(sel, prov, o);
        activeUnregisters.push(un);
        return un;
      },
    },
    utils: {
      showToast: (msg, type) => toasts.push({ msg, type }),
      renderMarkdown: async (s) => '<p>' + makeDom().escapeHtml(s) + '</p>',
    },
    dialog: {
      prompt: async () => editText,
    },
    api,
  };

  return { uiApi, api, stores, toasts, eventSubs };
}

const RADAR_MANIFEST = { id: 'com.utopia.example-emotion-radar', name: '角色状态雷达图', version: '2.2.0' };
const EDIT_MANIFEST = { id: 'com.utopia.example-edit-reply', name: '回复编辑', version: '2.1.0' };

// 角色数据：带完整的 emotionState / bodyState，避免雷达图告警分支
function makeCharacter(id, name) {
  return {
    id,
    name,
    emotionState: {
      valence: 30, arousal: -10, dominance: 20, attention: 10,
      surprise: 5, energy: 40, affection: 60, trust: 70, intimacy: 50,
    },
    bodyState: { energy: 70, sleepiness: 20, health: 90, consciousness: '清醒', sleepStatus: '清醒' },
  };
}

beforeEach(() => {
  // 确保 chat-header-actions 槽位存在（骨架里只有 .header-actions，缺 data-plugin-slot）
  const ha = document.querySelector('.header-actions');
  if (ha && !ha.hasAttribute('data-plugin-slot')) {
    ha.setAttribute('data-plugin-slot', 'chat-header-actions');
  }
  // 清空槽位容器 + 清理上一次用例残留的注册，保证用例间隔离
  const slot = document.querySelector('[data-plugin-slot="chat-header-actions"]');
  if (slot) slot.innerHTML = '';
  for (const un of activeUnregisters) { try { un(); } catch (_) {} }
  activeUnregisters = [];
  contextMenuRegistry.close();
});

// ============================================================
// emotion-radar
// ============================================================
describe('emotion-radar v2.2.0 — 单聊 / 群聊修复', () => {
  it('单聊：展示当前选中角色，而非上一次打开过的角色', async () => {
    const char = makeCharacter('c-solo', '凌川');
    const { uiApi } = makeUiApi({
      state: { currentMode: 'single', currentCharacterId: 'c-solo' },
      character: char,
    });

    await radarUi.setup(uiApi, RADAR_MANIFEST);

    const btn = document.querySelector('[data-plugin-slot="chat-header-actions"] .radar-plugin-btn');
    expect(btn).not.toBeNull();

    btn.click();
    await tick(200); // 等 modal.open + rAF + 100ms 绘制

    const nameEl = document.getElementById('radar-char-name');
    expect(nameEl).not.toBeNull();
    expect(nameEl.textContent).toBe('凌川');
    // 单聊无群成员下拉
    expect(document.getElementById('radar-char-select')).toBeNull();
    // 画布存在（绘制流程跑通）
    expect(document.getElementById('radar-emotion-canvas')).not.toBeNull();
    expect(document.getElementById('radar-body-canvas')).not.toBeNull();
  });

  it('单聊：未选择角色时给出提示且不打开模态框', async () => {
    const { uiApi, toasts } = makeUiApi({
      state: { currentMode: 'single' },
      character: null,
    });
    await radarUi.setup(uiApi, RADAR_MANIFEST);

    const btn = document.querySelector('.radar-plugin-btn');
    btn.click();
    await tick(50);

    expect(toasts.some(t => t.msg.includes('请先选择一个角色'))).toBe(true);
    expect(document.getElementById('radar-char-name')).toBeNull();
  });

  it('群聊：从群成员读取角色列表并提供切换下拉，默认选第一个（不再沿用缓存角色）', async () => {
    const c1 = makeCharacter('c1', '凌川');
    const c2 = makeCharacter('c2', '小满');
    const { uiApi, stores } = makeUiApi({
      state: { currentMode: 'group', currentGroupId: 'g1' },
      groupMembers: [
        { memberType: 'character', memberId: 'c1' },
        { memberType: 'character', memberId: 'c2' },
      ],
      characters: { c1, c2 },
    });

    await radarUi.setup(uiApi, RADAR_MANIFEST);
    const btn = document.querySelector('.radar-plugin-btn');
    btn.click();
    await tick(200);

    // 默认展示第一个群成员
    expect(document.getElementById('radar-char-name').textContent).toBe('凌川');

    // 群成员查询被正确调用
    expect(stores.group_members.getByIndex).toHaveBeenCalledWith('groupId', 'g1');
    expect(stores.characters.get).toHaveBeenCalledWith('c1');
    expect(stores.characters.get).toHaveBeenCalledWith('c2');

    // 下拉存在且含两个角色
    const sel = document.getElementById('radar-char-select');
    expect(sel).not.toBeNull();
    expect(sel.querySelectorAll('option').length).toBe(2);

    // 切换到第二个角色
    sel.value = 'c2';
    sel.dispatchEvent(new Event('change'));
    await tick(50);

    expect(document.getElementById('radar-char-name').textContent).toBe('小满');
  });

  it('群聊：群内无角色成员时给出提示且不打开', async () => {
    const { uiApi, toasts } = makeUiApi({
      state: { currentMode: 'group', currentGroupId: 'g-empty' },
      groupMembers: [{ memberType: 'user', memberId: 'u1' }], // 只有真人，无角色
      characters: {},
    });
    await radarUi.setup(uiApi, RADAR_MANIFEST);
    document.querySelector('.radar-plugin-btn').click();
    await tick(50);

    expect(toasts.some(t => t.msg.includes('群聊中暂无可查看的角色'))).toBe(true);
    expect(document.getElementById('radar-char-name')).toBeNull();
  });
});

// ============================================================
// edit-reply
// ============================================================
describe('edit-reply v2.1.0 — 单聊 / 群聊修复（含移动端长按等价路径）', () => {
  function buildMessageEl({ group = false, assistant = true } = {}) {
    const wrap = document.createElement('div');
    if (group) {
      wrap.className = 'group-message';
      wrap.dataset.messageId = 'gm1';
      if (assistant) wrap.dataset.messageRole = 'assistant';
      else wrap.dataset.messageRole = 'user';
      const bubble = document.createElement('div');
      bubble.className = 'group-message-bubble';
      const content = document.createElement('div');
      content.className = 'content';
      content.textContent = assistant ? '群聊原始回复' : '群聊用户留言';
      const ts = document.createElement('span');
      ts.className = 'timestamp';
      ts.textContent = '12:00';
      bubble.appendChild(content);
      bubble.appendChild(ts);
      wrap.appendChild(bubble);
    } else {
      wrap.className = 'message' + (assistant ? ' assistant' : '');
      wrap.dataset.id = 'm1';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      const content = document.createElement('div');
      content.className = 'bubble-content';
      content.textContent = assistant ? '单聊原始回复' : '单聊用户留言';
      const ts = document.createElement('span');
      ts.className = 'timestamp';
      ts.textContent = '12:00';
      bubble.appendChild(content);
      bubble.appendChild(ts);
      wrap.appendChild(bubble);
    }
    document.body.appendChild(wrap);
    return wrap;
  }

  it('单聊 assistant 消息：右键出现编辑项，保存写入 conversations', async () => {
    const conversation = {
      id: 'conv1',
      messages: [{ id: 'm1', content: '单聊原始回复' }],
    };
    const { uiApi, api, stores, toasts } = makeUiApi({ conversation });
    await editReplyUi.setup(uiApi, EDIT_MANIFEST);

    const msg = buildMessageEl({ group: false, assistant: true });
    // 等价桌面右键 / 移动长按：向 registry 派发一次 contextmenu 流程
    await contextMenuRegistry.trigger(msg, 10, 10);
    await tick(20);

    const menu = document.querySelector('.message-context-menu');
    expect(menu).not.toBeNull();
    const editBtn = Array.from(menu.querySelectorAll('button'))
      .find(b => b.textContent.includes('编辑此回复'));
    expect(editBtn).toBeDefined();

    editBtn.click();
    await tick(50);

    expect(stores.conversations.update).toHaveBeenCalledTimes(1);
    const updated = stores.conversations.update.mock.calls[0][1];
    const edited = updated.messages.find(m => m.id === 'm1');
    expect(edited.content).toBe('修改后的回复');
    // 单聊主路径：保存后由宿主 renderConversation 重渲染（非本地刷新）
    expect(api.chat.renderConversation).toHaveBeenCalledWith('conv1');
    expect(toasts.some(t => t.msg === '已保存' && t.type === 'success')).toBe(true);
  });

  it('群聊 assistant 消息（v2.1.0 修复核心）：右键出现编辑项，保存写入 group_messages', async () => {
    const groupMessages = { gm1: { id: 'gm1', content: '群聊原始回复' } };
    const { uiApi, stores, toasts } = makeUiApi({ groupMessages });
    await editReplyUi.setup(uiApi, EDIT_MANIFEST);

    const msg = buildMessageEl({ group: true, assistant: true });
    await contextMenuRegistry.trigger(msg, 10, 10); // 移动端长按等价
    await tick(20);

    const menu = document.querySelector('.message-context-menu');
    expect(menu).not.toBeNull();
    const editBtn = Array.from(menu.querySelectorAll('button'))
      .find(b => b.textContent.includes('编辑此回复'));
    expect(editBtn).toBeDefined();

    editBtn.click();
    await tick(50);

    // 关键断言：群聊分支走 group_messages.update（而非 conversations）
    expect(stores.group_messages.update).toHaveBeenCalledTimes(1);
    expect(stores.conversations.update).not.toHaveBeenCalled();
    const saved = stores.group_messages.update.mock.calls[0][1];
    expect(saved.content).toBe('修改后的回复');
    expect(toasts.some(t => t.msg === '已保存' && t.type === 'success')).toBe(true);
    // 局部刷新（.content 容器，保留时间戳）
    expect(msg.querySelector('.content').innerHTML).toContain('修改后的回复');
    expect(msg.querySelector('.timestamp')).not.toBeNull();
  });

  it('非 assistant 消息：不出现编辑项（用户消息不可编辑）', async () => {
    const { uiApi } = makeUiApi({});
    await editReplyUi.setup(uiApi, EDIT_MANIFEST);

    const userMsg = buildMessageEl({ group: false, assistant: false });
    await contextMenuRegistry.trigger(userMsg, 10, 10);
    await tick(20);
    expect(document.querySelector('.message-context-menu')).toBeNull();

    const groupUserMsg = buildMessageEl({ group: true, assistant: false });
    await contextMenuRegistry.trigger(groupUserMsg, 10, 10);
    await tick(20);
    expect(document.querySelector('.message-context-menu')).toBeNull();
  });

  it('选择器覆盖 .message 与 .group-message 两类容器', async () => {
    const { uiApi } = makeUiApi({});
    await editReplyUi.setup(uiApi, EDIT_MANIFEST);

    const registered = contextMenuRegistry.list();
    const sel = registered.find(r => r.selector && r.selector.includes('.group-message'));
    expect(sel).toBeDefined();
    expect(sel.selector).toContain('.message');
  });
});
