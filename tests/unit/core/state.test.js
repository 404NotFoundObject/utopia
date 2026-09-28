import { describe, it, expect, vi } from 'vitest';
import { createState } from '../../../js/core/state.js';

describe('core/state · createState', () => {
  describe('读取', () => {
    it('不传路径时返回整个状态对象', () => {
      const state = createState({ a: 1, b: { c: 2 } });
      expect(state.get()).toEqual({ a: 1, b: { c: 2 } });
    });

    it('支持点号路径读取嵌套值', () => {
      const state = createState({ a: { b: { c: 42 } } });
      expect(state.get('a.b.c')).toBe(42);
    });

    it('路径不存在时返回 undefined 而不是抛错', () => {
      const state = createState({ a: 1 });
      expect(state.get('a.b.c')).toBeUndefined();
      expect(state.get('nope')).toBeUndefined();
    });

    it('读取 null 的深层路径不会崩溃', () => {
      const state = createState({ a: null });
      expect(state.get('a.b')).toBeUndefined();
    });
  });

  describe('写入', () => {
    it('写入顶层字段', () => {
      const state = createState({ a: 1 });
      state.set('a', 2);
      expect(state.get('a')).toBe(2);
    });

    it('写入已存在的嵌套路径', () => {
      const state = createState({ a: { b: 1 } });
      state.set('a.b', 9);
      expect(state.get('a.b')).toBe(9);
    });

    it('中间路径不存在时抛错，并提示 createMissing', () => {
      const state = createState({ a: 1 });
      expect(() => state.set('x.y', 1)).toThrow(/中间路径/);
      expect(() => state.set('x.y', 1)).toThrow(/createMissing/);
    });

    it('中间路径是原始值时抛错并说明实际类型', () => {
      const state = createState({ a: 1 });
      expect(() => state.set('a.b', 1)).toThrow(/不是对象/);
    });

    it('createMissing: true 时自动补建中间路径', () => {
      const state = createState({});
      state.set('x.y.z', 7, { createMissing: true });
      expect(state.get('x.y.z')).toBe(7);
    });

    it('createMissing 遇到原始值中间路径时会覆盖为对象', () => {
      const state = createState({ a: 1 });
      state.set('a.b', 5, { createMissing: true });
      expect(state.get('a.b')).toBe(5);
    });
  });

  describe('订阅通知', () => {
    it('值未变化时不触发回调', () => {
      const state = createState({ a: 1 });
      const spy = vi.fn();
      state.subscribe('a', spy);
      state.set('a', 1);
      expect(spy).not.toHaveBeenCalled();
    });

    it('force: true 时即使值相同也触发回调', () => {
      const state = createState({ a: 1 });
      const spy = vi.fn();
      state.subscribe('a', spy);
      state.set('a', 1, { force: true });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('精确路径订阅只在该路径变化时触发', () => {
      const state = createState({ a: 1, b: 2 });
      const spyA = vi.fn();
      state.subscribe('a', spyA);
      state.set('b', 3);
      expect(spyA).not.toHaveBeenCalled();
      state.set('a', 3);
      expect(spyA).toHaveBeenCalledTimes(1);
    });

    it('回调收到 (新值, 旧值)', () => {
      const state = createState({ a: 1 });
      const spy = vi.fn();
      state.subscribe('a', spy);
      state.set('a', 2);
      expect(spy).toHaveBeenCalledWith(2, 1);
    });

    it('subscribeAll 收到 (路径, 新值, 旧值)', () => {
      const state = createState({ a: { b: 1 } });
      const spy = vi.fn();
      state.subscribeAll(spy);
      state.set('a.b', 2);
      expect(spy).toHaveBeenCalledWith('a.b', 2, 1);
    });

    it('取消订阅后不再收到通知', () => {
      const state = createState({ a: 1 });
      const spy = vi.fn();
      const unsubscribe = state.subscribe('a', spy);
      state.set('a', 2);
      unsubscribe();
      state.set('a', 3);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('同一路径可挂多个订阅者', () => {
      const state = createState({ a: 1 });
      const s1 = vi.fn();
      const s2 = vi.fn();
      state.subscribe('a', s1);
      state.subscribe('a', s2);
      state.set('a', 2);
      expect(s1).toHaveBeenCalledTimes(1);
      expect(s2).toHaveBeenCalledTimes(1);
    });

    it('单个订阅者抛错不会阻断其他订阅者', () => {
      const state = createState({ a: 1 });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const bad = vi.fn(() => { throw new Error('boom'); });
      const good = vi.fn();
      state.subscribe('a', bad);
      state.subscribe('a', good);

      expect(() => state.set('a', 2)).not.toThrow();
      expect(good).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
