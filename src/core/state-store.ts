import type { IStateStore, Task, TaskStatus, AgentSession, PipelineProgress, StoredEvent } from './types.js';

/**
 * Abstract StateStore interface.
 * Implementations live in plugins (e.g., sqlite-state).
 * Core never imports an implementation directly.
 */
export abstract class StateStore implements IStateStore {
  abstract initialize(): Promise<void>;
  abstract close(): Promise<void>;

  // Tasks
  abstract createTask(task: Omit<Task, 'id' | 'createdAt'>): Promise<Task>;
  abstract getTask(id: string): Promise<Task | null>;
  abstract updateTask(id: string, patch: Partial<Task>): Promise<void>;
  abstract getNextTask(): Promise<Task | null>;
  abstract getTasksByStatus(status: TaskStatus): Promise<Task[]>;

  // Agent sessions
  abstract createAgentSession(session: AgentSession): Promise<void>;
  abstract getAgentSession(id: string): Promise<AgentSession | null>;
  abstract updateAgentSession(id: string, patch: Partial<AgentSession>): Promise<void>;

  // Pipeline progress
  abstract createPipelineProgress(progress: PipelineProgress): Promise<void>;
  abstract updatePipelineProgress(id: string, patch: Partial<PipelineProgress>): Promise<void>;

  // Event log
  abstract appendEvent(event: StoredEvent): Promise<void>;
  abstract getEvents(since: number, limit?: number): Promise<StoredEvent[]>;
}
