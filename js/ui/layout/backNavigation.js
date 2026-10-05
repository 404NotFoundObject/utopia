// js/ui/layout/backNavigation.js - 二级页面的硬件返回支持（Android 返回手势/返回键）
//
// 背景：本应用是纯 DOM 切屏的 SPA（朋友圈模态、微信主题的列表层↔对话页），
// 不产生任何历史记录，PWA standalone 下按返回键/返回手势会直接退出应用。
//
// 方案：每个「二级页面」打开时 pushState 占一条历史记录；用户按返回键触发
// popstate 时，关闭对应视图而不是退出应用。UI 上的关闭按钮走同步关闭 +
// history.back()，栈与历史保持一致。
//
// 设计要点：
// - 栈条目带自增 id，popstate 用 e.state 里的 id 校验目标条目，天然免疫
//   「closeModal() 后立刻 openModal()」的竞态（back 的 popstate 异步到达时，
//   当前状态已是新推入的条目，校验不匹配即忽略）。
// - rawClose 是「纯关闭」：只改视图状态，绝不调用 history.back()——
//   它只会被 popstate（浏览器已回退）调用。UI 主动关闭走 releaseView。
// - 历史栈为空时按返回键 = 退出应用，保持系统默认行为不变。

/** 视图栈：{ id, name, rawClose }，栈顶是当前页面 */
const stack = [];

let uid = 0;
let listening = false;

function ensureListener() {
  if (listening) return;
  listening = true;
  window.addEventListener('popstate', (e) => {
    // 回退后落在哪条历史记录上：null = 应用初始态；否则是某个仍在栈里的视图
    const targetId = e.state && e.state.__utopiaViewId ? e.state.__utopiaViewId : null;
    // 关闭所有比目标条目更深的视图（正常路径至多一个）
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (targetId !== null && top.id === targetId) break;
      stack.pop();
      try {
        top.rawClose();
      } catch (err) {
        console.error('[BackNav] 关闭视图失败:', err);
      }
    }
  });
}

/**
 * 打开一个二级页面并占一条历史记录。
 * @param {string} name - 视图名（调试用，如 'modal' / 'wxchat'）
 * @param {Function} rawClose - 纯关闭函数（只改视图状态，不做历史导航）
 * @returns {number|null} 视图 id（releaseView 用）；pushState 失败时为 null
 */
export function pushView(name, rawClose) {
  ensureListener();
  const id = ++uid;
  stack.push({ id, name, rawClose });
  try {
    history.pushState({ __utopiaViewId: id, __utopiaView: name }, '');
  } catch (_) {
    stack.pop();
    return null;
  }
  return id;
}

/**
 * UI 主动关闭（关闭按钮 / overlay 点击等）：把视图移出栈并回退历史。
 * 视图本身的关闭动作由调用方同步完成；这里的 history.back() 只回收
 * 历史条目，popstate 到达时栈中已无对应条目，不会重复关闭。
 * @param {number} id - pushView 返回的 id
 * @returns {boolean} 是否确实回收了一条记录
 */
export function releaseView(id) {
  const idx = stack.findIndex(v => v.id === id);
  if (idx === -1) return false;
  stack.splice(idx, 1);
  try {
    history.back();
  } catch (_) {
    /* jsdom 等环境无真实历史，忽略 */
  }
  return true;
}

/**
 * 静默丢弃视图（不做历史导航）：视图状态被外部清除时用
 * （如切主题、回桌面端导致 clearMobileView）。残留的历史条目由
 * popstate 的 id 校验兜底——回退到它时栈中无对应视图，是空操作。
 * @param {number} id - pushView 返回的 id
 */
export function discardView(id) {
  const idx = stack.findIndex(v => v.id === id);
  if (idx !== -1) stack.splice(idx, 1);
}

/** 当前栈深度（测试用） */
export function viewDepth() {
  return stack.length;
}
