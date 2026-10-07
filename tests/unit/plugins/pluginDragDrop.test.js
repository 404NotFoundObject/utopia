/**
 * js/plugins/pluginDragDrop.js · destroy() 的清理语义。
 *
 * ghostEl 若声明在 customDrag() 方法体内，destroy() 作为同一对象的
 * 另一个方法引用它会抛 ReferenceError: ghostEl is not defined。
 * 该错误被 uiBridge 的 try/catch 吞掉，表现为插件卸载时幽灵节点与监听器泄漏，
 * 且 `if (ghostEl)` 守卫挡不住——访问未声明变量在求值时即抛错。
 */
import { describe, it, expect } from 'vitest';
import { createPluginDragDrop } from '../../../js/plugins/pluginDragDrop.js';

describe('plugins/pluginDragDrop · destroy', () => {
  it('destroy() 不抛 ReferenceError', () => {
    const dd = createPluginDragDrop('test-plugin');
    // 旧实现在此处抛 ReferenceError（被上层 try/catch 吞掉）
    expect(() => dd.destroy()).not.toThrow();
  });

  it('customDrag 之后再 destroy 仍不抛错，且幽灵节点被清理', () => {
    const dd = createPluginDragDrop('test-plugin');

    const source = document.createElement('div');
    source.textContent = '拖拽源';
    document.body.appendChild(source);

    const before = document.body.querySelectorAll('*').length;

    // 启动一次自定义拖拽（会创建幽灵元素并挂到 body）
    const cleanup = dd.customDrag(source, { id: 'x' });

    expect(() => dd.destroy()).not.toThrow();

    // destroy 后不应残留新增的幽灵节点
    const after = document.body.querySelectorAll('*').length;
    expect(after).toBeLessThanOrEqual(before);

    if (typeof cleanup === 'function') cleanup();
    source.remove();
  });
});
