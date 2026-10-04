// js/core/appMeta.js - 应用版本元信息的唯一真源
//
// 为什么单独成文件：
//   版本号此前写在 app.js 内部，app.js 想 probe 自身版本、设置页想展示版本、
//   Service Worker 想据此命名缓存时都得从 app.js 反向 import（会形成循环依赖），
//   于是各自复制了一份 —— P3-10 阶段 A 清掉的就是这类重复。这里统一出口，
//   发版时只改这一处（配合 scripts/release.mjs 会更稳）。

/** 当前应用版本（语义化版本，与 version.json 对齐） */
export const APP_VERSION = '3.9.5';

/** localStorage 键：已落地的版本号 */
export const STORAGE_VERSION_KEY = 'utopia_app_version';

/** localStorage 键：用户点过「稍后」的远端版本，避免同一版本反复打扰 */
export const DISMISSED_UPDATE_KEY = 'utopia_update_dismissed';

/** localStorage 键：最近一次检查远端版本的时间（ISO 字符串） */
export const LAST_CHECK_KEY = 'utopia_update_last_check';
