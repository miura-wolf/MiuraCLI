export interface Migration {
  version: number;
  up: string[];
}

export const migrations: Migration[] = [
  {
    version: 1,
    up: [
      `CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      )`,
      `CREATE TABLE IF NOT EXISTS task_queue (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        input TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        agent_id TEXT,
        pipeline_id TEXT,
        attempt INTEGER DEFAULT 0,
        result TEXT,
        error TEXT,
        next_retry_at INTEGER,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_task_status ON task_queue(status)`,
      `CREATE INDEX IF NOT EXISTS idx_task_priority ON task_queue(priority, created_at)`,
      `CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        agent_role TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        model_name TEXT NOT NULL,
        status TEXT NOT NULL,
        task_id TEXT,
        started_at INTEGER NOT NULL,
        last_heartbeat INTEGER NOT NULL,
        result TEXT,
        FOREIGN KEY (task_id) REFERENCES task_queue(id)
      )`,
      `CREATE TABLE IF NOT EXISTS pipeline_progress (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        stages TEXT NOT NULL,
        iteration INTEGER DEFAULT 0,
        started_at INTEGER NOT NULL,
        history TEXT,
        FOREIGN KEY (task_id) REFERENCES task_queue(id)
      )`,
      `CREATE TABLE IF NOT EXISTS model_routing (
        role TEXT PRIMARY KEY,
        default_provider TEXT NOT NULL,
        default_model TEXT NOT NULL,
        fallback_chain TEXT NOT NULL,
        capabilities TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS context_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_event_timestamp ON event_log(timestamp)`,
    ],
  },
];
