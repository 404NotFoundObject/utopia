import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showToast } from '../../js/ui/components/toast.js';

function getToasts() {
  return Array.from(document.querySelectorAll('#toastContainer .toast'));
}

describe('ui/components/toast · showToast', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('渲染', () => {
    it('把提示挂载到 #toastContainer 下', () => {
      showToast('保存成功');
      expect(getToasts()).toHaveLength(1);
      expect(document.getElementById('toastContainer').contains(getToasts()[0])).toBe(true);
    });

    it('文本渲染进 .toast-msg 节点', () => {
      showToast('保存成功');
      expect(document.querySelector('#toastContainer .toast-msg').textContent).toBe('保存成功');
    });

    it('多次调用依次堆叠，不覆盖已有提示', () => {
      showToast('第一条');
      showToast('第二条');
      showToast('第三条');
      expect(getToasts()).toHaveLength(3);
    });

    it('默认类型为 info', () => {
      showToast('默认');
      expect(getToasts()[0].className).toContain('toast-info');
    });
  });

  describe('type 白名单校验', () => {
    it.each(['success', 'error', 'warning', 'info'])('保留合法类型 %s', (type) => {
      showToast('内容', type);
      expect(getToasts()[0].className).toContain(`toast-${type}`);
    });

    it.each([
      'unknown',
      'SUCCESS',
      '',
      null,
      undefined,
      'info" onclick="alert(1)',
    ])('非法类型 %s 回退到 info', (type) => {
      showToast('内容', type);
      expect(getToasts()[0].className).toContain('toast-info');
    });

    it('恶意 type 不会注入额外属性', () => {
      showToast('内容', 'x" onclick="alert(1)');
      const toast = getToasts()[0];
      expect(toast.getAttribute('onclick')).toBeNull();
      expect(toast.className.split(' ').sort()).toEqual(['toast', 'toast-info']);
    });
  });

  describe('图标映射', () => {
    it.each([
      ['success', 'fa-check-circle'],
      ['error', 'fa-exclamation-circle'],
      ['warning', 'fa-exclamation-triangle'],
      ['info', 'fa-info-circle'],
    ])('%s 使用图标 %s', (type, icon) => {
      showToast('内容', type);
      expect(getToasts()[0].querySelector('i').className).toContain(icon);
    });
  });

  describe('XSS 防护', () => {
    it('HTML 标签被转义为纯文本', () => {
      showToast('<img src=x onerror="alert(1)">');
      const span = document.querySelector('#toastContainer .toast-msg');
      expect(span.textContent).toBe('<img src=x onerror="alert(1)">');
      expect(span.querySelector('img')).toBeNull();
    });

    it('script 标签不会被执行或插入', () => {
      showToast('<script>window.__pwned = true;</script>');
      expect(document.querySelector('#toastContainer script')).toBeNull();
      expect(window.__pwned).toBeUndefined();
    });

    it('属性注入被中和', () => {
      showToast('"><svg onload=alert(1)>');
      expect(document.querySelector('#toastContainer svg')).toBeNull();
    });

    it('null / undefined 渲染为空字符串而不是字面量', () => {
      showToast(null);
      expect(document.querySelector('#toastContainer .toast-msg').textContent).toBe('');
      showToast(undefined);
      const spans = document.querySelectorAll('#toastContainer .toast-msg');
      expect(spans[1].textContent).toBe('');
    });

    it('数字与布尔值被字符串化', () => {
      showToast(404);
      expect(document.querySelector('#toastContainer .toast-msg').textContent).toBe('404');
    });
  });

  describe('自动消失', () => {
    it('duration 到点后开始淡出', () => {
      showToast('稍后消失', 'info', 1000);
      const toast = getToasts()[0];
      vi.advanceTimersByTime(1000);
      expect(toast.style.opacity).toBe('0');
    });

    it('淡出动画结束后从 DOM 移除', () => {
      showToast('稍后消失', 'info', 1000);
      vi.advanceTimersByTime(1000 + 300);
      expect(getToasts()).toHaveLength(0);
    });

    it('duration 之前不会被移除', () => {
      showToast('保持', 'info', 5000);
      vi.advanceTimersByTime(4999);
      expect(getToasts()).toHaveLength(1);
    });

    it('默认 duration 为 3000ms', () => {
      showToast('默认时长');
      vi.advanceTimersByTime(2999);
      expect(getToasts()).toHaveLength(1);
      vi.advanceTimersByTime(1 + 300);
      expect(getToasts()).toHaveLength(0);
    });
  });
});
