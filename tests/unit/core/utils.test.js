import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateUUID,
  deepClone,
  debounce,
  escapeHtml,
  formatTime,
  truncateText,
} from '../../../js/core/utils.js';

describe('core/utils', () => {
  describe('escapeHtml', () => {
    it('转义全部五个 HTML 特殊字符', () => {
      expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    it('null / undefined 返回空字符串，避免渲染出字面量', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('非字符串输入先做 String() 转换', () => {
      expect(escapeHtml(0)).toBe('0');
      expect(escapeHtml(false)).toBe('false');
      expect(escapeHtml(123)).toBe('123');
    });

    it('中和典型的 XSS 载荷', () => {
      const payload = '<img src=x onerror="alert(1)">';
      const safe = escapeHtml(payload);
      expect(safe).not.toContain('<');
      expect(safe).not.toContain('>');
      expect(safe).not.toContain('"');
    });

    it('& 优先转义，不会造成二次转义错乱', () => {
      expect(escapeHtml('a&amp;b')).toBe('a&amp;amp;b');
    });

    it('纯文本原样返回', () => {
      expect(escapeHtml('你好，世界 hello')).toBe('你好，世界 hello');
    });
  });

  describe('generateUUID', () => {
    it('生成符合 v4 格式的 UUID', () => {
      const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(generateUUID()).toMatch(pattern);
    });

    it('连续生成不重复', () => {
      const set = new Set(Array.from({ length: 200 }, () => generateUUID()));
      expect(set.size).toBe(200);
    });
  });

  describe('deepClone', () => {
    it('拷贝后修改嵌套值不影响原对象', () => {
      const original = { a: { b: [1, 2, 3] } };
      const copy = deepClone(original);
      copy.a.b.push(4);
      expect(original.a.b).toHaveLength(3);
      expect(copy.a.b).toHaveLength(4);
    });

    it('内容相等但引用不同', () => {
      const original = { a: 1 };
      const copy = deepClone(original);
      expect(copy).toEqual(original);
      expect(copy).not.toBe(original);
    });
  });

  describe('debounce', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('延迟未到时不执行', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced();
      expect(fn).not.toHaveBeenCalled();
    });

    it('延迟结束后执行一次', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced();
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('高频调用只保留最后一次，并透传其参数', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced('a');
      debounced('b');
      debounced('c');
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('c');
    });

    it('默认延迟为 300ms', () => {
      const fn = vi.fn();
      const debounced = debounce(fn);
      debounced();
      vi.advanceTimersByTime(299);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('truncateText', () => {
    it('超长文本截断并追加省略号', () => {
      expect(truncateText('abcdefghij', 5)).toBe('abcde...');
    });

    it('未超长时原样返回', () => {
      expect(truncateText('abc', 5)).toBe('abc');
    });

    it('长度正好等于上限时不截断', () => {
      expect(truncateText('abcde', 5)).toBe('abcde');
    });

    it('默认上限为 20', () => {
      const text = 'x'.repeat(21);
      expect(truncateText(text)).toBe('x'.repeat(20) + '...');
    });
  });

  describe('formatTime', () => {
    it('返回包含冒号的时间字符串', () => {
      const out = formatTime(new Date('2026-01-02T03:04:00Z').getTime());
      expect(typeof out).toBe('string');
      expect(out).toContain(':');
    });

    it('能接受时间戳数字', () => {
      expect(() => formatTime(1700000000000)).not.toThrow();
    });
  });
});
