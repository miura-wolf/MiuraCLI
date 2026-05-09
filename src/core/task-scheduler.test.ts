import { describe, it, expect, beforeEach } from 'vitest';
import { TaskScheduler, DEFAULT_PACE } from './task-scheduler.js';
import { EventBus } from './event-bus.js';

describe('TaskScheduler', () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    const bus = new EventBus();
    scheduler = new TaskScheduler(bus, { ...DEFAULT_PACE, maxConcurrent: 10, maxPerWindow: 100 });
  });

  it('creates a task with generated id', () => {
    const task = scheduler.createTask('fix the login bug', 'pipeline', 'high');

    expect(task.id).toBeTruthy();
    expect(task.input).toBe('fix the login bug');
    expect(task.priority).toBe('high');
    expect(task.status).toBe('queued');
  });

  it('deduplicates identical tasks', () => {
    const t1 = scheduler.createTask('fix the login bug', 'pipeline', 'high');
    const t2 = scheduler.createTask('fix the login bug', 'pipeline', 'high');

    expect(t1.id).toBe(t2.id);
  });

  it('respects priority ordering', () => {
    scheduler.createTask('low task', 'pipeline', 'low');
    scheduler.createTask('high task', 'pipeline', 'high');
    scheduler.createTask('medium task', 'pipeline', 'medium');

    const next = scheduler.getNext();
    expect(next).toBeDefined();
    expect(next!.priority).toBe('high');
  });

  it('marks task as completed', () => {
    const task = scheduler.createTask('test task', 'pipeline', 'medium');
    const running = scheduler.getNext();
    expect(running).not.toBeNull();

    scheduler.markCompleted(task.id, {
      agentId: 'test-agent',
      output: 'done',
      exitCode: 0,
      durationMs: 100,
      tokenUsage: { prompt: 10, completion: 20 },
      model: { provider: 'claude', model: 'sonnet' },
    });

    const retrieved = scheduler.getTask(task.id);
    expect(retrieved?.status).toBe('completed');
  });

  it('marks task as failed with re-queue', () => {
    const task = scheduler.createTask('failing task', 'pipeline', 'medium');
    const running = scheduler.getNext();
    expect(running).not.toBeNull();

    scheduler.markFailed(task.id, 'something went wrong');

    // After failure, task is re-queued
    const retrieved = scheduler.getTask(task.id);
    expect(retrieved).toBeDefined();
  });

  it('returns null when no tasks available', () => {
    const next = scheduler.getNext();
    expect(next).toBeNull();
  });

  it('getStats returns correct counts', () => {
    scheduler.createTask('task1', 'pipeline', 'high');
    scheduler.createTask('task2', 'pipeline', 'medium');

    const stats = scheduler.getStats();
    expect(stats.queued).toBe(2);
    expect(stats.running).toBe(0);
  });
});
