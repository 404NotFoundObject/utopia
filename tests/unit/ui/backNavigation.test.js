import { describe, it, expect, beforeEach } from 'vitest';
import { pushView, releaseView, discardView, viewDepth } from '../../../js/ui/layout/backNavigation.js';
import { openModal, closeModal } from '../../../js/ui/components/modal.js';

/**
 * 硬件返回支持（Android 返回手势/返回键）的栈行为测试。
 *
 * 真实的历史导航（back → popstate → 关闭视图）由 E2E
 * （wechat-theme.spec.js「返回手势逐级关闭二级页面」）覆盖；
 * 这里验证栈的同步语义与 modal.js 的集成。
 */

function modalFixture() {
  document.body.innerHTML =
    '<div id="modalOverlay" class="modal-overlay hidden"><div id="modalContent" class="modal-content"></div></div>';
}

/** 模拟浏览器返回：popstate 不带我们的状态 = 回到应用初始态 */
function simulateBackToBase() {
  window.dispatchEvent(new PopStateEvent('popstate'));
}

beforeEach(() => {
  modalFixture();
});

describe('backNavigation · 视图栈', () => {
  it('pushView 入栈、releaseView 出栈', () => {
    const before = viewDepth();
    const id = pushView('modal', () => {});
    expect(id).not.toBeNull();
    expect(viewDepth()).toBe(before + 1);

    expect(releaseView(id)).toBe(true);
    expect(viewDepth()).toBe(before);
  });

  it('releaseView 对未知 id 返回 false（重复关闭安全）', () => {
    const id = pushView('modal', () => {});
    releaseView(id);
    expect(releaseView(id)).toBe(false);
    discardView(id); // 幂等
  });

  it('popstate 回到初始态时关闭所有仍在栈里的视图（rawClose 被调用）', () => {
    const closed = [];
    pushView('wxchat', () => closed.push('wxchat'));
    pushView('modal', () => closed.push('modal'));

    simulateBackToBase();

    expect(closed).toEqual(['modal', 'wxchat']); // 后进先关
    expect(viewDepth()).toBe(0);
  });

  it('popstate 落在仍在栈里的视图条目上时，只关闭比它更深的视图', () => {
    const closed = [];
    const keepId = pushView('wxchat', () => closed.push('wxchat'));
    pushView('modal', () => closed.push('modal'));

    // 模拟 e.state 指向 wxchat 的历史条目（即 modal 那条被回退掉了）
    window.dispatchEvent(new PopStateEvent('popstate', {
      state: { __utopiaViewId: keepId },
    }));

    expect(closed).toEqual(['modal']);
    expect(viewDepth()).toBe(1);
    discardView(keepId);
  });
});

describe('modal.js · 历史栈集成', () => {
  it('openModal 占一条历史记录，closeModal 同步回收', () => {
    const before = viewDepth();
    openModal('<div class="modal-close">&times;</div><p>测试</p>');
    expect(viewDepth()).toBe(before + 1);
    expect(document.getElementById('modalOverlay').classList.contains('hidden')).toBe(false);

    closeModal();
    expect(viewDepth()).toBe(before);
    expect(document.getElementById('modalOverlay').classList.contains('hidden')).toBe(true);
  });

  it('连续 openModal（内容切换）不重复入栈', () => {
    const before = viewDepth();
    openModal('<p>第一页</p>');
    openModal('<p>第二页</p>');
    expect(viewDepth()).toBe(before + 1);

    closeModal();
    expect(viewDepth()).toBe(before);
  });

  it('硬件返回（popstate 回初始态）关闭当前模态', () => {
    openModal('<p>测试</p>');
    expect(document.getElementById('modalOverlay').classList.contains('hidden')).toBe(false);

    simulateBackToBase();

    expect(document.getElementById('modalOverlay').classList.contains('hidden')).toBe(true);
    expect(viewDepth()).toBe(0);

    // 此后再 closeModal（防御性调用）不得再次回退历史
    const depth = viewDepth();
    closeModal();
    expect(viewDepth()).toBe(depth);
  });
});
