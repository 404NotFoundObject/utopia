/**
 * @module worldBookEditLock
 * @description 世界书编辑器编辑锁
 *
 * 用途：
 *   编辑规则/组时，抑制 worldbook:* 事件触发的列表刷新，
 *   避免 renderWorldBookList 覆盖正在编辑的模态框导致未保存内容丢失。
 *
 * 为什么用计数器：
 *   支持未来嵌套场景（虽然当前不支持）。锁归零时视为"无编辑"。
 */

let _lockCount = 0;

export function acquireEditLock() {
  _lockCount++;
}

export function releaseEditLock() {
  _lockCount = Math.max(0, _lockCount - 1);
}

export function isEditLocked() {
  return _lockCount > 0;
}