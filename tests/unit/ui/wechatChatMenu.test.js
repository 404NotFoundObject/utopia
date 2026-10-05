import { describe, it, expect, beforeEach } from 'vitest';
import { ensureInjectedNodes } from '../../../js/ui/layout/wechatTheme.js';
import { getAppState } from '../../../js/core/state.js';

/**
 * 对话页右上角「···」菜单。
 *
 * 移动端微信主题下会话列表层被对话页盖住，列表卡片上的操作按钮
 * （角色：编辑 / 导出 / 删除；群组：群设置）在此前完全够不着，
 * 这些操作被搬进对话页的「···」下拉菜单。这里验证菜单项按当前
 * 会话生成，并且把点击转发给列表卡片里的原按钮（逻辑零改动复用）。
 */

const INJECTED_IDS = [
  'wxBackBtn', 'wxDockChatBtn', 'wxUserAvatar',
  'wxPlusBtn', 'wxPlusMenu', 'wxChatMoreBtn', 'wxChatMoreMenu',
];

const state = getAppState();

/** 挂载一个单聊列表项（含编辑 / 导出 / 删除三个按钮） */
function mountCharacterItem(id) {
  const li = document.createElement('li');
  li.className = 'character-item';
  li.dataset.id = id;
  li.innerHTML =
    '<button class="edit-btn"></button>' +
    '<button class="export-btn"></button>' +
    '<button class="delete-btn"></button>';
  document.getElementById('characterList').appendChild(li);
  return li;
}

/** 挂载一个群组列表项（含进入 / 设置按钮） */
function mountGroupItem(id) {
  const li = document.createElement('li');
  li.className = 'character-item group-item';
  li.dataset.id = id;
  li.innerHTML =
    '<button class="enter-btn"></button>' +
    '<button class="settings-btn"></button>';
  document.getElementById('characterList').appendChild(li);
  return li;
}

function menuItems() {
  return [...document.querySelectorAll('#wxChatMoreMenu .wx-menu-item')]
    .map((el) => el.textContent.trim());
}

beforeEach(() => {
  for (const id of INJECTED_IDS) document.getElementById(id)?.remove();
  state.set('currentMode', 'chat');
  state.set('currentCharacterId', null);
  state.set('currentGroupId', null);
});

describe('对话页 ··· 菜单', () => {
  it('单聊会话展开出 编辑 / 导出 / 删除 三项', () => {
    mountCharacterItem('c1');
    state.set('currentCharacterId', 'c1');
    ensureInjectedNodes();

    const btn = document.getElementById('wxChatMoreBtn');
    expect(btn).not.toBeNull();
    expect(document.getElementById('wxChatMoreMenu').classList.contains('open')).toBe(false);

    btn.click();
    expect(document.getElementById('wxChatMoreMenu').classList.contains('open')).toBe(true);
    expect(menuItems()).toEqual(['编辑', '导出', '删除']);
  });

  it('群聊会话只展开 群设置（对话页内再「进入群聊」无意义）', () => {
    mountGroupItem('g1');
    state.set('currentMode', 'group');
    state.set('currentGroupId', 'g1');
    ensureInjectedNodes();

    document.getElementById('wxChatMoreBtn').click();
    expect(menuItems()).toEqual(['群设置']);
  });

  it('点击菜单项转发给列表卡片上的原按钮（逻辑零改动复用）', () => {
    const li = mountCharacterItem('c1');
    const clicked = [];
    for (const cls of ['edit-btn', 'export-btn', 'delete-btn']) {
      li.querySelector('.' + cls).addEventListener('click', () => clicked.push(cls));
    }
    state.set('currentCharacterId', 'c1');
    ensureInjectedNodes();
    document.getElementById('wxChatMoreBtn').click();

    document.querySelectorAll('#wxChatMoreMenu .wx-menu-item')[1].click(); // 导出
    expect(clicked).toEqual(['export-btn']);
    // 转发后菜单收起
    expect(document.getElementById('wxChatMoreMenu').classList.contains('open')).toBe(false);
  });

  it('列表里找不到对应按钮时不渲染该项，全空时给出空态', () => {
    state.set('currentCharacterId', 'ghost');
    ensureInjectedNodes();
    document.getElementById('wxChatMoreBtn').click();

    const items = document.querySelectorAll('#wxChatMoreMenu .wx-menu-item');
    expect(items).toHaveLength(1);
    expect(items[0].classList.contains('wx-menu-empty')).toBe(true);
  });

  it('会话切换后重新展开菜单会重建菜单项（不残留上一次的会话）', () => {
    mountCharacterItem('c1');
    mountGroupItem('g1');
    ensureInjectedNodes();

    state.set('currentCharacterId', 'c1');
    document.getElementById('wxChatMoreBtn').click();
    expect(menuItems()).toEqual(['编辑', '导出', '删除']);

    // 「···」是 toggle：再点一次收起
    document.getElementById('wxChatMoreBtn').click();
    expect(document.getElementById('wxChatMoreMenu').classList.contains('open')).toBe(false);

    state.set('currentMode', 'group');
    state.set('currentCharacterId', null);
    state.set('currentGroupId', 'g1');
    // 重新展开时按新会话重建
    document.getElementById('wxChatMoreBtn').click();
    expect(menuItems()).toEqual(['群设置']);
  });
});
