/**
 * @module event-bus
 * @description 事件总线入口，提供高性能的发布/订阅模式实现，支持优先级、通配符、粘性事件和异步触发。
 * @example
 * import { createEventBus } from './event-bus/index.js';
 * const bus = createEventBus({ historySize: 10 });
 * bus.on('user:login', (user) => console.log('登录', user));
 * bus.emit('user:login', { id: 1, name: 'Alice' });
 */

console.log('Utopia工具 EventBus 加载中...');

import { createEventBus } from './event-bus-core.js';

console.log('Utopia工具 EventBus 已加载');

export { createEventBus };