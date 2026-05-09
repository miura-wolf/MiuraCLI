import type { MiuraConfig, PaceConfig, Priority, Task, TaskStatus } from './types.js';
import { EventBus } from './event-bus.js';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

export const DEFAULT_PACE: PaceConfig = {
  maxConcurrent: 3,
  windowMs: 300_000,      // 5 minutes
  maxPerWindow: 10,
  baseBackoffMs: 30_000,
  maxBackoffMs: 600_000,
};

interface ScheduledTask extends Task {
  inputHash: string;
}

export class TaskScheduler {
  private queue: ScheduledTask[] = [];
  private running = new Map<string, ScheduledTask>();
  private completed: ScheduledTask[] = [];
  private eventBus: EventBus;
  private pace: PaceConfig;
  private recentStarts: number[] = [];

  constructor(eventBus: EventBus, pace?: Partial<PaceConfig>) {
    this.eventBus = eventBus;
    this.pace = { ...DEFAULT_PACE, ...pace };
  }

  createTask(
    input: string,
    type: Task['type'],
    priority: Priority = 'medium',
  ): Task {
    const inputHash = this.hashInput(type, input);

    // Deduplication
    const existing = this.queue.find((t) => t.inputHash === inputHash);
    if (existing) return existing;

    const task: ScheduledTask = {
      id: randomUUID(),
      type,
      input,
      priority,
      status: 'created',
      attempt: 0,
      inputHash,
      createdAt: Date.now(),
    };

    this.queue.push(task);
    this.sortQueue();

    task.status = 'queued';
    this.eventBus.emit('task.created', {
      taskId: task.id,
      priority,
      input,
    });

    this.eventBus.emit('task.queued', {
      taskId: task.id,
      position: this.queue.indexOf(task) + 1,
    });

    return task;
  }

  getNext(): Task | null {
    if (!this.canStart()) return null;

    const task = this.queue.shift();
    if (!task) return null;

    task.status = 'running';
    task.startedAt = Date.now();
    task.attempt++;
    this.running.set(task.id, task);
    this.recentStarts.push(Date.now());

    this.eventBus.emit('task.running', {
      taskId: task.id,
      agentId: '',
    });

    return task;
  }

  markCompleted(taskId: string, result: Task['result']): void {
    const task = this.running.get(taskId);
    if (!task) return;

    task.status = 'completed';
    task.completedAt = Date.now();
    task.result = result;

    this.running.delete(taskId);
    this.completed.push(task);

    this.eventBus.emit('task.completed', {
      taskId,
      result: result as { agentId: string; output: string; exitCode: 0 | 1; durationMs: number; tokenUsage: { prompt: number; completion: number }; model: ModelRef },
    });
  }

  markFailed(taskId: string, error: string): void {
    const task = this.running.get(taskId);
    if (!task) return;

    task.status = 'failed';
    task.completedAt = Date.now();
    task.error = error;

    this.running.delete(taskId);

    // Exponential backoff
    const backoffMs = Math.min(
      this.pace.baseBackoffMs * Math.pow(2, task.attempt - 1),
      this.pace.maxBackoffMs,
    );
    task.nextRetryAt = Date.now() + backoffMs;

    // Re-queue for retry
    task.status = 'queued';
    this.queue.push(task);
    this.sortQueue();

    this.eventBus.emit('task.failed', {
      taskId,
      error,
      attempt: task.attempt,
    });
  }

  getTask(id: string): Task | null {
    return (
      this.queue.find((t) => t.id === id) ??
      this.running.get(id) ??
      this.completed.find((t) => t.id === id) ??
      null
    );
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    const all: Task[] = [
      ...this.queue,
      ...Array.from(this.running.values()),
      ...this.completed,
    ];
    return all.filter((t) => t.status === status);
  }

  getStats(): { queued: number; running: number; completed: number; failed: number } {
    return {
      queued: this.queue.length,
      running: this.running.size,
      completed: this.completed.filter((t) => t.status === 'completed').length,
      failed: this.completed.filter((t) => t.status === 'failed').length,
    };
  }

  private canStart(): boolean {
    // Check concurrent limit
    if (this.running.size >= this.pace.maxConcurrent) return false;

    // Check rolling window
    const now = Date.now();
    const windowStart = now - this.pace.windowMs;
    this.recentStarts = this.recentStarts.filter((t) => t > windowStart);
    if (this.recentStarts.length >= this.pace.maxPerWindow) return false;

    return true;
  }

  private sortQueue(): void {
    const priorityOrder: Record<Priority, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };

    this.queue.sort((a, b) => {
      // By priority
      const pa = priorityOrder[a.priority] ?? 1;
      const pb = priorityOrder[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;

      // Then by creation time (FIFO within same priority)
      return a.createdAt - b.createdAt;
    });
  }

  private hashInput(type: string, input: string): string {
    return createHash('sha256').update(`${type}:${input}`).digest('hex').slice(0, 16);
  }
}

// Avoid unused import warning — ModelRef is used in markCompleted
type ModelRef = import('./types.js').ModelRef;
