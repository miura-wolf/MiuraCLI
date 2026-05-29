import { Database as BunDatabase } from 'bun:sqlite';
import type {
  AgentResult,
  AgentSession,
  PipelineIterationRecord,
  PipelineProgress,
  StoredEvent,
  Task,
  TaskStatus,
} from '../../../core/types.js';
import { StateStore } from '../../../core/state-store.js';
import { migrations } from './migrations.js';
import { randomUUID } from 'node:crypto';

export class SqliteStateStore extends StateStore {
  private db: BunDatabase | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    super();
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    this.db = new BunDatabase(this.dbPath);

    // Enable WAL mode for concurrent reads
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');

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

    this.db!.query(
      `INSERT INTO task_queue (id, type, input, priority, status, agent_id, pipeline_id, attempt, result, error, next_retry_at, created_at, started_at, completed_at)
       VALUES ($id, $type, $input, $priority, $status, $agentId, $pipelineId, $attempt, $result, $error, $nextRetryAt, $createdAt, $startedAt, $completedAt)`,
    ).run({
      $id: id,
      $type: task.type,
      $input: task.input,
      $priority: task.priority,
      $status: task.status,
      $agentId: task.agentId ?? null,
      $pipelineId: task.pipelineId ?? null,
      $attempt: task.attempt,
      $result: task.result ? JSON.stringify(task.result) : null,
      $error: task.error ?? null,
      $nextRetryAt: task.nextRetryAt ?? null,
      $createdAt: createdAt,
      $startedAt: task.startedAt ?? null,
      $completedAt: task.completedAt ?? null,
    });

    return full;
  }

  async getTask(id: string): Promise<Task | null> {
    const row = this.db!.query('SELECT * FROM task_queue WHERE id = $id').get({ $id: id }) as TaskRow | undefined;
    return row ? this.rowToTask(row) : null;
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<void> {
    const sets: string[] = [];
    const values: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(patch)) {
      const paramName = `$${key}`;
      if (key === 'result') {
        sets.push(`${this.camelToSnake(key)} = $result`);
        values.$result = value ? JSON.stringify(value) : null;
      } else {
        sets.push(`${this.camelToSnake(key)} = ${paramName}`);
        values[paramName] = value;
      }
    }

    if (sets.length === 0) return;

    values.$id = id;
    this.db!.query(`UPDATE task_queue SET ${sets.join(', ')} WHERE id = $id`).run(values);
  }

  async getNextTask(): Promise<Task | null> {
    const row = this.db!.query(
      `SELECT * FROM task_queue
       WHERE status = $status
       ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END, created_at ASC
       LIMIT 1`,
    ).get({ $status: 'queued' }) as TaskRow | undefined;
    return row ? this.rowToTask(row) : null;
  }

  async getTasksByStatus(status: TaskStatus): Promise<Task[]> {
    const rows = this.db!.query('SELECT * FROM task_queue WHERE status = $status').all({ $status: status }) as unknown as TaskRow[];
    return rows.map((r) => this.rowToTask(r));
  }

  async countTasksByStatus(status: TaskStatus): Promise<number> {
    const row = this.db!.query('SELECT COUNT(*) as count FROM task_queue WHERE status = $status').get({ $status: status }) as { count: number };
    return row.count;
  }

  // === Agent Sessions ===

  async createAgentSession(session: AgentSession): Promise<void> {
    this.db!.query(
      `INSERT INTO agent_sessions (id, agent_role, model_provider, model_name, status, task_id, started_at, last_heartbeat, result)
       VALUES ($id, $agentRole, $modelProvider, $modelName, $status, $taskId, $startedAt, $lastHeartbeat, $result)`,
    ).run({
      $id: session.id,
      $agentRole: session.agentRole,
      $modelProvider: session.model.provider,
      $modelName: session.model.model,
      $status: session.status,
      $taskId: session.taskId ?? null,
      $startedAt: session.startedAt,
      $lastHeartbeat: session.lastHeartbeat,
      $result: session.result ? JSON.stringify(session.result) : null,
    });
  }

  async getAgentSession(id: string): Promise<AgentSession | null> {
    const row = this.db!.query('SELECT * FROM agent_sessions WHERE id = $id').get({ $id: id }) as AgentSessionRow | undefined;
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
    const values: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(patch)) {
      const column = this.camelToSnake(key);
      if (column === 'model_provider' || column === 'model_name') {
        continue;
      }
      if (column === 'result') {
        sets.push(`${column} = $result`);
        values.$result = value ? JSON.stringify(value) : null;
      } else {
        const paramName = `$${key}`;
        sets.push(`${column} = ${paramName}`);
        values[paramName] = value;
      }
    }

    if (patch.model) {
      sets.push('model_provider = $modelProvider', 'model_name = $modelName');
      values.$modelProvider = patch.model.provider;
      values.$modelName = patch.model.model;
    }

    if (sets.length === 0) return;

    values.$id = id;
    this.db!.query(`UPDATE agent_sessions SET ${sets.join(', ')} WHERE id = $id`).run(values);
  }

  // === Pipeline Progress ===

  async createPipelineProgress(progress: PipelineProgress): Promise<void> {
    this.db!.query(
      `INSERT INTO pipeline_progress (id, task_id, input, definition, stages, iteration, status, started_at, updated_at, history)
       VALUES ($id, $taskId, $input, $definition, $stages, $iteration, $status, $startedAt, $updatedAt, $history)`,
    ).run({
      $id: progress.id,
      $taskId: progress.taskId,
      $input: progress.input,
      $definition: JSON.stringify(progress.definition),
      $stages: JSON.stringify(progress.stages),
      $iteration: progress.iteration,
      $status: progress.status,
      $startedAt: progress.startedAt,
      $updatedAt: progress.updatedAt,
      $history: JSON.stringify(this.serializeHistory(progress.history)),
    });
  }

  async updatePipelineProgress(id: string, patch: Partial<PipelineProgress>): Promise<void> {
    const sets: string[] = [];
    const values: Record<string, unknown> = { $id: id };

    if (patch.stages !== undefined) {
      sets.push('stages = $stages');
      values.$stages = JSON.stringify(patch.stages);
    }
    if (patch.input !== undefined) {
      sets.push('input = $input');
      values.$input = patch.input;
    }
    if (patch.definition !== undefined) {
      sets.push('definition = $definition');
      values.$definition = JSON.stringify(patch.definition);
    }
    if (patch.iteration !== undefined) {
      sets.push('iteration = $iteration');
      values.$iteration = patch.iteration;
    }
    if (patch.status !== undefined) {
      sets.push('status = $status');
      values.$status = patch.status;
    }
    if (patch.updatedAt !== undefined) {
      sets.push('updated_at = $updatedAt');
      values.$updatedAt = patch.updatedAt;
    }
    if (patch.history !== undefined) {
      sets.push('history = $history');
      values.$history = JSON.stringify(this.serializeHistory(patch.history));
    }

    if (sets.length === 0) return;

    this.db!.query(`UPDATE pipeline_progress SET ${sets.join(', ')} WHERE id = $id`).run(values);
  }

  async getPipelineProgress(id: string): Promise<PipelineProgress | null> {
    const row = this.db!.query('SELECT * FROM pipeline_progress WHERE id = $id').get({ $id: id }) as PipelineProgressRow | undefined;
    return row ? this.rowToPipelineProgress(row) : null;
  }

  async listInterruptedPipelines(limit = 20): Promise<PipelineProgress[]> {
    const rows = this.db!.query(
      `SELECT * FROM pipeline_progress
       WHERE status IN ('running', 'interrupted')
       ORDER BY updated_at DESC
       LIMIT $limit`,
    ).all({ $limit: limit }) as unknown as PipelineProgressRow[];
    return rows.map((row) => this.rowToPipelineProgress(row));
  }

  // === Event Log ===

  async appendEvent(event: StoredEvent): Promise<void> {
    this.db!.query(
      'INSERT INTO event_log (type, payload, timestamp) VALUES ($type, $payload, $timestamp)',
    ).run({ $type: event.type, $payload: event.payload, $timestamp: event.timestamp });
  }

  async getEvents(since: number, limit = 100): Promise<StoredEvent[]> {
    const rows = this.db!.query(
      'SELECT * FROM event_log WHERE timestamp > $since ORDER BY timestamp ASC LIMIT $limit',
    ).all({ $since: since, $limit: limit }) as unknown as EventRow[];
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      payload: r.payload,
      timestamp: r.timestamp,
    }));
  }

  // === Private helpers ===

  private runMigrations(): void {
    this.db!.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`);
    const currentVersion = this.db!.query('SELECT version FROM schema_version').get() as { version: number } | undefined;
    const current = currentVersion?.version ?? 0;

    for (const migration of migrations) {
      if (migration.version > current) {
        this.db!.exec('BEGIN');
        try {
          for (const sql of migration.up) {
            this.db!.exec(sql);
          }
          this.db!.query('INSERT OR REPLACE INTO schema_version (version) VALUES ($version)').run({ $version: migration.version });
          this.db!.exec('COMMIT');
        } catch (err) {
          this.db!.exec('ROLLBACK');
          throw err;
        }
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

  private serializeHistory(history: PipelineIterationRecord[]): Array<{
    iteration: number;
    reviewerApproved: boolean;
    stageResults: Array<[string, AgentResult]>;
  }> {
    return history.map((record) => ({
      iteration: record.iteration,
      reviewerApproved: record.reviewerApproved,
      stageResults: Array.from(record.stageResults.entries()),
    }));
  }

  private deserializeHistory(raw: string | null): PipelineIterationRecord[] {
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{
      iteration: number;
      reviewerApproved: boolean;
      stageResults: Array<[string, AgentResult]>;
    }>;
    return parsed.map((record) => ({
      iteration: record.iteration,
      reviewerApproved: record.reviewerApproved,
      stageResults: new Map(record.stageResults),
    }));
  }

  private rowToPipelineProgress(row: PipelineProgressRow): PipelineProgress {
    return {
      id: row.id,
      taskId: row.task_id,
      input: row.input ?? '',
      definition: row.definition ? JSON.parse(row.definition) : { stages: [], maxIterations: 1 },
      stages: row.stages ? JSON.parse(row.stages) : [],
      iteration: row.iteration,
      status: (row.status as PipelineProgress['status']) ?? 'running',
      startedAt: row.started_at,
      updatedAt: row.updated_at ?? row.started_at,
      history: this.deserializeHistory(row.history),
    };
  }
}

// Row type interfaces — used for type-casting raw query results
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

interface PipelineProgressRow {
  id: string;
  task_id: string;
  input: string | null;
  definition: string | null;
  stages: string | null;
  iteration: number;
  status: string | null;
  started_at: number;
  updated_at: number | null;
  history: string | null;
}
