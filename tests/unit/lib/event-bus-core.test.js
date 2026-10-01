/**
 * lib/event-bus/event-bus-core 单元测试：off 全量移除匹配回调（P2-25）。
 */
import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '../../../lib/event-bus/event-bus-core.js';

describe('lib/event-bus/event-bus-core · off', () => {
  it('两个订阅者共用同一回调引用时，off 全部移除', () => {
    const bus = createEventBus();
    const cb = vi.fn();
    bus.on('evt', cb);
    bus.on('evt', cb); // 同一函数引用订阅两次

    bus.off('evt', cb);

    bus.emit('evt');
    expect(cb).not.toHaveBeenCalled();
    expect(bus.getSubscribers('evt')).toHaveLength(0);
  });

  it('off 只移除匹配回调，不影响其他回调', () => {
    const bus = createEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('evt', a);
    bus.on('evt', b);

    bus.off('evt', a);

    bus.emit('evt');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('无回调参数时移除整个事件', () => {
    const bus = createEventBus();
    bus.on('evt', vi.fn());
    bus.off('evt');
    expect(bus.getEventNames()).not.toContain('evt');
  });

  it('通配符订阅中移除匹配回调', () => {
    const bus = createEventBus();
    const cb = vi.fn();
    bus.on('user:*', cb);
    bus.emit('user:login'); // 先触发一次确认订阅生效
    cb.mockClear();

    bus.off('user:login', cb);
    bus.emit('user:login');
    expect(cb).not.toHaveBeenCalled();
  });
});
