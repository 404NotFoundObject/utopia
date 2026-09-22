// js/core/eventBus.js - 全局事件总线
import { createEventBus } from '/lib/event-bus/index.js';

// 创建全局事件总线实例，保留最近 10 条事件历史（用于回放）
const globalEventBus = createEventBus({
  historySize: 10,
  onError: (error, eventName, subscriber) => {
    console.error('[EventBus] 事件处理错误:', eventName, error, subscriber);
  },
});

// 导出单例
export default globalEventBus;