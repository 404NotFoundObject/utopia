/**
 * lib/event-bus/event-bus-core 单元测试：off 语义。
 *
 * off 的语义是「一次只移除一个」：
 *  - 若用 filter 移除全部同名回调，两方共用同一 handler 时，一方 unsubscribe
 *    会把另一方的订阅一起注销（静默失效）。
 *  - 业界标准（Node EventEmitter、EventTarget.removeEventListener）同样如此。
 */
import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '../../../lib/event-bus/event-bus-core.js';

describe('lib/event-bus/event-bus-core · off', () => {
  it('两个订阅者共用同一回调引用时，off 只移除首个', () => {
    const bus = createEventBus();
    const cb = vi.fn();
    bus.on('evt', cb);
    bus.on('evt', cb); // 同一函数引用订阅两次

    bus.off('evt', cb); // 只解绑一次

    bus.emit('evt');
    // 关键：另一方订阅仍然存活，不能因为共用 handler 就被误伤
    expect(cb).toHaveBeenCalledTimes(1);
    expect(bus.getSubscribers('evt')).toHaveLength(1);

    // 再 off 一次才清空（要全清可重复调用，或只传事件名）
    bus.off('evt', cb);
    expect(bus.getSubscribers('evt')).toHaveLength(0);
  });

  it('只传事件名仍能一次性移除全部订阅', () => {
    const bus = createEventBus();
    const cb = vi.fn();
    bus.on('evt', cb);
    bus.on('evt', cb);

    bus.off('evt'); // 无回调参数 → 整体移除

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

  it('once 触发后只清理自己，不误删同函数的持久订阅', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('evt', handler);   // 持久订阅，先注册
    bus.once('evt', handler); // 一次性订阅，同一 handler

    bus.emit('evt');
    expect(handler).toHaveBeenCalledTimes(2); // 两者都被触发

    handler.mockClear();
    bus.emit('evt');
    // 关键：持久订阅必须存活；once 记录已被清掉，不再重复触发
    expect(handler).toHaveBeenCalledTimes(1);

    // 第三次发射：存活的必须是「持久订阅」。
    // 若清理时误删了持久订阅、反而留下 once 记录，这一轮会是 0 次——
    // 这样即使订阅数量同为 1，也能区分出「留下的是谁」。
    handler.mockClear();
    bus.emit('evt');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(bus.getSubscribers('evt')).toHaveLength(1);
  });

  it('on 返回的 unsubscribe 只解绑本次注册，不影响同函数的其它注册', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    const unsubA = bus.on('evt', handler); // 组件 A
    bus.on('evt', handler);                // 组件 B，共用 handler

    unsubA(); // 仅 A 退订

    bus.emit('evt');
    expect(handler).toHaveBeenCalledTimes(1); // B 仍存活
    expect(bus.getSubscribers('evt')).toHaveLength(1);
  });

  it('通配符订阅者能收到粘性重放', () => {
    const bus = createEventBus({ historySize: 5 });
    bus.emit('user:login', { id: 1 }); // 先产生历史
    bus.emit('user:logout', { id: 2 });

    const cb = vi.fn();
    bus.on('user:*', cb); // 通配符订阅，应收到回放

    expect(cb).toHaveBeenCalledTimes(1); // 默认只回放最后一条
    // 关键：首参是真实事件名，与 emit 时的参数形状一致
    expect(cb.mock.calls[0][0]).toBe('user:logout');
    expect(cb.mock.calls[0][1]).toEqual({ id: 2 });
  });

  it('粘性重放回放的是快照，不受发布后外部修改影响', () => {
    const bus = createEventBus({ historySize: 5 });
    const payload = { id: 1, tags: ['a'] };
    bus.emit('evt', payload);

    payload.id = 999;        // 发布后修改顶层
    payload.tags.push('b');  // 发布后修改嵌套

    const cb = vi.fn();
    bus.on('evt', cb);

    // 关键：回放必须拿到发布那一刻的值
    expect(cb.mock.calls[0][0]).toEqual({ id: 1, tags: ['a'] });
  });

  it('通配符订阅重放全部历史（replayAll）', () => {
    const bus = createEventBus({ historySize: 5 });
    bus.emit('user:login', { n: 1 });
    bus.emit('user:logout', { n: 2 });

    const cb = vi.fn();
    bus.on('user:*', cb, { replayAll: true });

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls.map(c => c[0])).toEqual(['user:login', 'user:logout']);
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
