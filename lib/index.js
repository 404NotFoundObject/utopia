/**
 * @module context-injector
 * @description 上下文注入工具入口，提供基于规则的动态内容注入能力。
 * @example
 * import { createContextInjector } from './context-injector/index.js';
 * const injector = createContextInjector({ rules: [...] });
 * const messages = await injector.buildMessages(chatMessages, { user: {...} });
 */

console.log('Utopia工具 Context Injector 加载中...');

import { createContextInjector } from './context-injector-core.js';

console.log('Utopia工具 Context Injector 已加载');

export { createContextInjector };