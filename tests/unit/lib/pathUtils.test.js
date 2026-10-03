/**
 * lib/pathUtils.js 单测。
 *
 * 审计 P3-5：路径取值此前有两份实现（api-adapter/utils.getByPath 与
 * context-injector-core 的私有 safeGetByPath），现收敛到本模块。
 * 这里锁定两者共有的调用形式（`a.b.c` / `a[0].b` / `a.b[0].c`）与容错行为。
 */
import { describe, it, expect } from 'vitest';
import { getByPath, getByPathArr } from '../../../lib/pathUtils.js';

describe('lib/pathUtils#getByPath', () => {
  const source = { a: { b: [{ c: 'deep' }] }, x: { y: 0 }, empty: null };

  it('点号路径取值', () => {
    expect(getByPath(source, 'a.b')).toEqual([{ c: 'deep' }]);
  });

  it('方括号索引 + 点号混合', () => {
    expect(getByPath(source, 'a.b[0].c')).toBe('deep');
  });

  it('方括号紧跟在根之后', () => {
    expect(getByPath([{ v: 1 }, { v: 2 }], '[1].v')).toBe(2);
  });

  it('取到 0 / 空字符串等假值时不被吞掉', () => {
    expect(getByPath(source, 'x.y')).toBe(0);
    expect(getByPath({ s: '' }, 's')).toBe('');
  });

  it('路径不存在 → undefined', () => {
    expect(getByPath(source, 'a.nope.c')).toBeUndefined();
  });

  it('中间环节为 null → undefined（不抛错）', () => {
    expect(getByPath(source, 'empty.deep')).toBeUndefined();
  });

  it('源为空或 path 非字符串 → undefined', () => {
    expect(getByPath(null, 'a')).toBeUndefined();
    expect(getByPath(undefined, 'a')).toBeUndefined();
    expect(getByPath(source, null)).toBeUndefined();
    expect(getByPath(source, 123)).toBeUndefined();
  });

  it('混合路径（context-injector 实际用法）', () => {
    expect(getByPath({ character: { id: 'c1' } }, 'character.id')).toBe('c1');
    expect(getByPath({ group: { id: 'g9' } }, 'group.id')).toBe('g9');
  });
});

describe('lib/pathUtils#getByPathArr', () => {
  const source = { a: { b: [{ c: 42 }] } };

  it('按路径数组取值', () => {
    expect(getByPathArr(source, ['a', 'b', '0', 'c'])).toBe(42);
  });

  it('路径不存在 → undefined', () => {
    expect(getByPathArr(source, ['a', 'z'])).toBeUndefined();
  });

  it('遇到 null 中途返回 undefined', () => {
    expect(getByPathArr({ a: null }, ['a', 'b'])).toBeUndefined();
  });
});
