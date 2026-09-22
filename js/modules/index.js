/**
 * @module modules/index
 * @description 核心模块索引
 *
 * 用途：
 *   pluginApi.js 会从这个文件自动获取所有模块并包装。
 *   新增核心模块时，在下方追加一行 export * as ...
 *
 * 命名规则：
 *   - 导出名 = 插件 API 中使用的模块名（如 api.character.xxx）
 *   - 允许模块名与文件名不一致（如 emotion → emotionEngine.js）
 */

// ============================================================
// 核心模块索引
// ============================================================

export * as character from './character.js';
export * as conversation from './conversation.js';
export * as chat from './chat.js';
export * as groupChat from './groupChat.js';
export * as groupChatEngine from './groupChatEngine.js';
export * as groupChatOps from './groupChatOperations.js';
export * as emotion from './emotionEngine.js';
export * as bodyState from './bodyState.js';
export * as profileDefaults from './profileDefaults.js';
export * as memory from './memory.js';
export * as time from './time.js';
export * as worldBook from './worldBook.js';
export * as injector from './injector.js';
export * as personality from './personality.js';
export * as social from './social.js';
export * as proactiveChat from './proactiveChat.js';
export * as settings from './settings.js';
export * as commandEngine from './commandEngine.js';
export * as summary from './summary.js';
export * as suggestions from './suggestions.js';
export * as firstMessage from './firstMessage.js';

// ============================================================
// 扩展索引的说明
// ============================================================
//
// 新增核心模块：
//   1. 编写 js/modules/xxx.js
//   2. 在此文件追加：export * as xxx from './xxx.js';
//   3. 完成。插件系统自动识别，无需修改 pluginApi.js
//
// 模块不需要修改自己：
//   - 核心模块保持零插件感知（除非需要战略钩子）
//   - 所有包装逻辑都在 pluginApi.js 中完成
//
// 权限声明：
//   新模块的方法权限，需在 js/plugins/permissionChecker.js 的
//   METHOD_PERMISSIONS 中声明（例如 'xxx.doSomething': 'xxx:write'）