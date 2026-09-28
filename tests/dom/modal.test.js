import { describe, it, expect, vi } from 'vitest';
import { openModal, closeModal, createModal } from '../../js/ui/components/modal.js';

const overlay = () => document.getElementById('modalOverlay');
const content = () => document.getElementById('modalContent');

describe('ui/components/modal · 模态框', () => {
  describe('openModal / closeModal', () => {
    it('初始状态为隐藏', () => {
      expect(overlay().classList.contains('hidden')).toBe(true);
    });

    it('打开后注入内容并移除 hidden', () => {
      openModal('<p>内容</p>');
      expect(content().innerHTML).toContain('<p>内容</p>');
      expect(overlay().classList.contains('hidden')).toBe(false);
    });

    it('关闭后恢复 hidden', () => {
      openModal('<p>内容</p>');
      closeModal();
      expect(overlay().classList.contains('hidden')).toBe(true);
    });

    it('重复打开会替换上一次的内容', () => {
      openModal('<p>第一次</p>');
      openModal('<p>第二次</p>');
      expect(content().innerHTML).not.toContain('第一次');
      expect(content().innerHTML).toContain('第二次');
    });
  });

  describe('onClose 回调', () => {
    it('closeModal 时触发回调', () => {
      const onClose = vi.fn();
      openModal('<p>x</p>', onClose);
      closeModal();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('回调只触发一次，重复关闭不会重复调用', () => {
      const onClose = vi.fn();
      openModal('<p>x</p>', onClose);
      closeModal();
      closeModal();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('打开新模态框时先触发上一个的回调', () => {
      const first = vi.fn();
      const second = vi.fn();
      openModal('<p>1</p>', first);
      openModal('<p>2</p>', second);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();
    });

    it('回调抛错不会阻断关闭流程', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      openModal('<p>x</p>', () => { throw new Error('boom'); });
      expect(() => closeModal()).not.toThrow();
      expect(overlay().classList.contains('hidden')).toBe(true);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('传入非函数时被忽略', () => {
      expect(() => openModal('<p>x</p>', 'not-a-function')).not.toThrow();
      expect(() => closeModal()).not.toThrow();
    });
  });

  describe('关闭途径', () => {
    it('点击遮罩层自身关闭', () => {
      const onClose = vi.fn();
      openModal('<p>x</p>', onClose);
      overlay().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(overlay().classList.contains('hidden')).toBe(true);
    });

    it('点击内容区域不会误关', () => {
      const onClose = vi.fn();
      openModal('<p>点这里</p>', onClose);
      content().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onClose).not.toHaveBeenCalled();
      expect(overlay().classList.contains('hidden')).toBe(false);
    });

    it('存在 .modal-close 按钮时点击可关闭', () => {
      const onClose = vi.fn();
      openModal(createModal('标题', '<p>正文</p>'), onClose);
      content().querySelector('.modal-close')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('关闭后遮罩层不再响应点击', () => {
      const onClose = vi.fn();
      openModal('<p>x</p>', onClose);
      closeModal();
      // 关闭时已解绑，重新打开前点击不应触发已消费的回调
      overlay().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('createModal', () => {
    it('转义标题中的 HTML', () => {
      const html = createModal('<img src=x onerror=alert(1)>', '');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(html).not.toContain('<img');
    });

    it('bodyHtml 按 HTML 语义原样透传（由调用方负责安全）', () => {
      const html = createModal('标题', '<p class="x">正文</p>');
      expect(html).toContain('<p class="x">正文</p>');
    });

    it('始终输出关闭按钮与标题节点', () => {
      const html = createModal('标题', '');
      expect(html).toContain('class="modal-close"');
      expect(html).toContain('class="modal-title"');
    });

    it('未传 footerHtml 时不输出 footer 容器', () => {
      expect(createModal('标题', '')).not.toContain('modal-footer');
    });

    it('传入 footerHtml 时包裹在 .modal-footer 中', () => {
      const html = createModal('标题', '', '<button>确定</button>');
      expect(html).toContain('modal-footer');
      expect(html).toContain('<button>确定</button>');
    });

    it('产出可被 openModal 正常挂载', () => {
      openModal(createModal('测试标题', '<p>正文</p>'));
      expect(content().querySelector('.modal-title').textContent).toBe('测试标题');
      expect(overlay().classList.contains('hidden')).toBe(false);
    });
  });
});
