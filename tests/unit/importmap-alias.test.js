/**
 * importmap 别名守护测试。
 *
 * index.html 通过 importmap 把 "/js/" 与 "/lib/" 映射到项目根目录：
 *   { "imports": { "/js/": "./js/", "/lib/": "./lib/" } }
 * 应用源码里有 9 处依赖该映射的绝对路径导入（core/api.js、core/eventBus.js、
 * modules/injector.js、modules/memory.js 等）。Node 默认会把前导斜杠当成文件系统根路径，
 * 因此 vitest.config.js 必须复刻同样的别名，否则这些模块在测试环境下无法解析。
 *
 * 本文件用与源码完全一致的写法导入，一旦别名配置被改动或删除，这里会直接解析失败。
 */
import { describe, it, expect } from 'vitest';

import { createState } from '/js/core/state.js';
import { createEventBus } from '/lib/event-bus/index.js';
import globalEventBus from '/js/core/eventBus.js';

describe('importmap 别名解析', () => {
  it('"/js/" 前缀解析到项目 js/ 目录', () => {
    expect(typeof createState).toBe('function');
  });

  it('"/lib/" 前缀解析到项目 lib/ 目录', () => {
    expect(typeof createEventBus).toBe('function');
  });

  it('源码自身通过绝对路径导入的事件总线可正常加载', () => {
    expect(globalEventBus).toBeDefined();
    expect(typeof globalEventBus.on).toBe('function');
    expect(typeof globalEventBus.emit).toBe('function');
  });

  it('别名解析出的模块与相对路径导入的是同一实例', async () => {
    const viaRelative = (await import('../../js/core/state.js')).createState;
    expect(viaRelative).toBe(createState);
  });
});
