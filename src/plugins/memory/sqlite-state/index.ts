import Database from 'better-sqlite3';
import type {
  AgentSession,
  PipelineProgress,
  StoredEvent,
  Task,
  TaskStatus,
} from '../../../core/types.js';
import { StateStore } from '../../../core/state-store.js';
import { migrations } from './migrations.js';
import { randomUUID } from 'node:crypto';

export class SqliteStateStore extends StateStore {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    super();
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);

    // Enable WAL mode for concurrent reads
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Run migrations
    this.runMigrations();
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  // === Tasks ===

  async createTask(task: Omit<Task, 'id' | 'createdAt'>): Promise<Task> {
    const id = randomUUID();
    const createdAt = Date.now();
    const full: Task = { ...task, id, createdAt } as Task;

    this.db!.prepare(
      `INSERT INTO task_queue (id, type, input, priority, status, agent_id, pipeline_id, attempt, result, error, next_retry_at, created_at, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      task.type,
      task.input,
      task.priority,
      task.status,
      task.agentId ?? null,
      task.pipelineId ?? null,
      task.attempt,
      task.result ? JSON.stringify(task.result) : null,
      task.error ?? null,
      task.nextRetryAt ?? null,
      createdAt,
      task.startedAt ?? null,
      task.completedAt ?? null,
    );

    return full;
  }

  async getTask(id: string): Promise<Task | null> {
    const row = this.db!.prepare('SELECT * FROM task_queue WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? this.rowToTask(row) : null;
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(patch)) {
      const column = this.camelToSnake(key);
      if (column === 'result') {
        sets.push(`${column} = ?`);
        values.push(value ? JSON.stringify(value) : null);
      } else {
        sets.push(`${column} = ?`);
        values.push(value);
      }
    }

    if (sets.length === 0) return;

    values.push(id);
    this.db!.prepare(`UPDATE task_queue SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  async getNextTask(): Promise<Task | null> {
    const row = this.db!.prepare(
      `SELECT * FROM task_queue
       WHERE status = 'queued'
       ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END, created_at ASC
       LIMIT 1`,
    ).get() as TaskRow | undefined;
    return row ? this.rowToTask(row) : null;
  }

  async getTasksByStatus(status: TaskStatus): Promise<Task[]> {
    const rows = this.db!.prepare('SELECT * FROM task_queue WHERE status = ?').all(status) as TaskRow[];
    return rows.map((r) => this.rowToTask(r));
  }

  // === Agent Sessions ===

  async createAgentSession(session: AgentSession): Promise<void> {
    this.db!.prepare(
      `INSERT INTO agent_sessions (id, agent_role, model_provider, model_name, status, task_id, started_at, last_heartbeat, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      session.id,
      session.agentRole,
      session.model.provider,
      session.model.model,
      session.status,
      session.taskId ?? null,
      session.startedAt,
      session.lastHeartbeat,
      session.result ? JSON.stringify(session.result) : null,
    );
  }

  async getAgentSession(id: string): Promise<AgentSession | null> {
    const row = this.db!.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) as AgentSessionRow | undefined;
    if (!row) return null;

    return {
      id: row.id,
      agentRole: row.agent_role as AgentSession['agentRole'],
      model: { provider: row.model_provider as AgentSession['model']['provider'], model: row.model_name },
      status: row.status as AgentSession['status'],
      taskId: row.task_id ?? undefined,
      startedAt: row.started_at,
      lastHeartbeat: row.last_heartbeat,
      result: row.result ? JSON.parse(row.result) : undefined,
    };
  }

  async updateAgentSession(id: string, patch: Partial<AgentSession>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(patch)) {
      const column = this.camelToSnake(key);
      if (column === 'model_provider' || column === 'model_name') {
        // Model is an object — skip these, update separately
        continue;
      }
      if (column === 'result') {
        sets.push(`${column} = ?`);
        values.push(value ? JSON.stringify(value) : null);
      } else {
        sets.push(`${column} = ?`);
        values.push(value);
      }
    }

    // Handle model updates
    if (patch.model) {
      sets.push('model_provider = ?', 'model_name = ?');
      values.push(patch.model.provider, patch.model.model);
    }

    if (sets.length === 0) return;

    values.push(id);
    this.db!.prepare(`UPDATE agent_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  // === Pipeline Progress ===

  async createPipelineProgress(progress: PipelineProgress): Promise<void> {
    this.db!.prepare(
      `INSERT INTO pipeline_progress (id, task_id, stages, iteration, started_at, history)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      progress.id,
      progress.taskId,
      JSON.stringify(progress.stages),
      progress.iteration,
      progress.startedAt,
      JSON.stringify(progress.history),
    );
  }

  async updatePipelineProgress(id: string, patch: Partial<PipelineProgress>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (patch.stages !== undefined) {
      sets.push('stages = ?');
      values.push(JSON.stringify(patch.stages));
    }
    if (patch.iteration !== undefined) {
      sets.push('iteration = ?');
      values.push(patch.iteration);
    }
    if (patch.history !== undefined) {
      sets.push('history = ?');
      values.push(JSON.stringify(patch.history));
    }

    if (sets.length === 0) return;

    values.push(id);
    this.db!.prepare(`UPDATE pipeline_progress SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  // === Event Log ===

  async appendEvent(event: StoredEvent): Promise<void> {
    this.db!.prepare(
      'INSERT INTO event_log (type, payload, timestamp) VALUES (?, ?, ?)',
    ).run(event.type, event.payload, event.timestamp);
  }

  async getEvents(since: number, limit = 100): Promise<StoredEvent[]> {
    const rows = this.db!.prepare(
      'SELECT * FROM event_log WHERE timestamp > ? ORDER BY timestamp ASC LIMIT ?',
    ).all(since, limit) as EventRow[];
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      payload: r.payload,
      timestamp: r.timestamp,
    }));
  }

  // === Private helpers ===

  private runMigrations(): void {
    const currentVersion = this.db!.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
    const current = currentVersion?.version ?? 0;

    for (const migration of migrations) {
      if (migration.version > current) {
        const transaction = this.db!.transaction(() => {
          for (const sql of migration.up) {
            this.db!.exec(sql);
          }
          this.db!.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(migration.version);
        });
        transaction();
      }
    }
  }

  private rowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      type: row.type as Task['type'],
      input: row.input,
      priority: row.priority as Task['priority'],
      status: row.status as TaskStatus,
      agentId: row.agent_id ?? undefined,
      pipelineId: row.pipeline_id ?? undefined,
      attempt: row.attempt,
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error ?? undefined,
      nextRetryAt: row.next_retry_at ?? undefined,
      createdAt: row.created_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
    };
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }
}

// Row type interfaces
interface TaskRow {
  id: string;
  type: string;
  input: string;
  priority: string;
  status: string;
  agent_id: string | null;
  pipeline_id: string | null;
  attempt: number;
  result: string | null;
  error: string | null;
  next_retry_at: number | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

interface AgentSessionRow {
  id: string;
  agent_role: string;
  model_provider: string;
  model_name: string;
  status: string;
  task_id: string | null;
  started_at: number;
  last_heartbeat: number;
  result: string | null;
}

interface EventRow {
  id: number;
  type: string;
  payload: string;
  timestamp: number;
}
