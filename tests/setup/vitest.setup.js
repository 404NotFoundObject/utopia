/**
 * Vitest 全局前置。
 *
 * 执行时机：在 environment 建立之后、测试文件模块图加载之前。
 * 因此这里完成的事情都能被待测模块在导入期正确感知：
 *   1. 安装 fake-indexeddb（jsdom 不提供 indexedDB）
 *   2. 注入 DOM 骨架（modal.js / toast.js 在模块作用域读取节点）
 *   3. 补齐 jsdom 缺失的少量浏览器 API
 *
 * ── 关于数据库隔离（重要）────────────────────────────────────
 * 本项目有 6 个模块在模块作用域缓存了一份 stores 对象，绑定到具体的
 * IDBDatabase 连接：character.js / chatOperations.js / conversation.js /
 * settings.js / social.js / worldBook.js（均为 `let _stores = null`）。
 * 这些缓存没有对外的失效接口，一旦底层的库被删除或替换，缓存中的
 * store 句柄随之失效，后续操作会抛 InvalidStateError。
 *
 * 因此**不要**在用例之间替换 globalThis.indexedDB 或反复删库。
 * 正确做法是依赖 Vitest 的按文件隔离：每个测试文件拥有独立的模块注册表，
 * 也就天然拥有全新的 fake-indexeddb 实例与全新的模块级缓存。
 * 需要清理数据的用例请使用唯一 ID，而不是重建整个库。
 */
import { afterEach, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { installDomSkeleton, resetDom } from '../helpers/dom-skeleton.js';

// ---- 浏览器 API 垫片 ----
// jsdom 未实现 requestAnimationFrame（banner.js 用它触发进场动画），且某些
// 配置下即便提供了函数也不会真正回调，会导致 `await new Promise(rAF…)` 永久挂起。
// 故无条件强制一个基于 setTimeout 的可用垫片：语义足够（回调最终执行一次）。
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

// jsdom 未实现 matchMedia（主题模块用于探测暗色偏好）
if (typeof globalThis.matchMedia !== 'function') {
  globalThis.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom 未实现 scrollTo / 滚动相关方法在部分节点上缺失
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// DOM 骨架必须先于测试模块图完成注入
installDomSkeleton();

beforeEach(() => {
  // 应用内含约 200 处诊断日志，全部放行会淹没测试输出。
  // 只静音 log / debug（纯诊断），保留 warn / error 以便真实问题可见。
  // 用例若需断言日志，自行 vi.spyOn 覆盖即可（restoreAllMocks 会统一收尾）。
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  resetDom();
});
