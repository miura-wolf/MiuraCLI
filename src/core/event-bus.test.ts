import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './event-bus.js';

describe('EventBus', () => {
  it('emits and receives events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('test.event', handler);

    bus.emit('test.event', { value: 42 });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ value: 42 });
  });

  it('supports multiple handlers for same event', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('test.event', h1);
    bus.on('test.event', h2);
    bus.emit('test.event', { x: 1 });

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops receiving events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsub = bus.on('test.event', handler);

    bus.emit('test.event', { a: 1 });
    unsub();
    bus.emit('test.event', { a: 2 });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ a: 1 });
  });

  it('once handler fires only once', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.once('test.event', handler);
    bus.emit('test.event', { x: 1 });
    bus.emit('test.event', { x: 2 });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('wildcard pattern matches events', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('agent.*', handler);
    bus.emit('agent.spawned', { id: '1' });
    bus.emit('agent.completed', { id: '1' });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('error in one handler does not affect others', () => {
    const bus = new EventBus();
    const goodHandler = vi.fn();
    const badHandler = vi.fn(() => { throw new Error('boom'); });

    bus.on('test.event', badHandler);
    bus.on('test.event', goodHandler);
    bus.emit('test.event', {});

    expect(badHandler).toHaveBeenCalledOnce();
    expect(goodHandler).toHaveBeenCalledOnce();
  });

  it('replay returns past events', () => {
    const bus = new EventBus();

    bus.emit('agent.spawned', { id: '1' });
    bus.emit('agent.completed', { id: '1' });
    bus.emit('test.other', { x: 1 });

    const agentEvents = bus.replay('agent.*');
    expect(agentEvents).toHaveLength(2);
  });
});
