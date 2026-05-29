/**
 * BrainStore — SQLite persistence layer for Brain memory entries.
 *
 * Tables:
 *   brain_entries    — primary storage
 *   brain_topics     — aggregated topic metadata
 *
 * FTS5 virtual table: brain_fts — for fast semantic search
 */

import { Database as BunDatabase } from 'bun:sqlite';
import type { BrainEntryType } from './brain-types.js';

export interface BrainEntry {
  id: string;
  project: string;
  sessionId?: string;
  type: BrainEntryType;
  topicKey: string;
  title: string;
  content: string;
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface BrainSearchOptions {
  project?: string;
  type?: BrainEntryType;
  limit?: number;
}

export class BrainStore {
  private db: BunDatabase;

  constructor(dbPath: string) {
    this.db = new BunDatabase(dbPath);
  }

  async initialize(): Promise<void> {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS brain_entries (
        id          TEXT PRIMARY KEY,
        project     TEXT NOT NULL,
        session_id  TEXT,
        type        TEXT NOT NULL,
        topic_key   TEXT NOT NULL,
        title       TEXT NOT NULL,
        content     TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        metadata    TEXT NOT NULL DEFAULT '{}'
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS brain_topics (
        topic_key   TEXT NOT NULL,
        project     TEXT NOT NULL,
        type        TEXT NOT NULL,
        entry_count INTEGER NOT NULL DEFAULT 1,
        last_entry_at INTEGER NOT NULL,
        PRIMARY KEY (topic_key, project)
      )
    `);

    // FTS5 virtual table for full-text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS brain_fts USING fts5(
        title,
        content,
        content='brain_entries',
        content_rowid='rowid',
        tokenize='porter unicode61'
      )
    `);

    // Keep FTS index in sync via triggers
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS brain_fts_insert
      AFTER INSERT ON brain_entries BEGIN
        INSERT INTO brain_fts(rowid, title, content)
        VALUES (NEW.rowid, NEW.title, NEW.content);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS brain_fts_delete
      AFTER DELETE ON brain_entries BEGIN
        INSERT INTO brain_fts(brain_fts, rowid, title, content)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.content);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS brain_fts_update
      AFTER UPDATE ON brain_entries BEGIN
        INSERT INTO brain_fts(brain_fts, rowid, title, content)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.content);
        INSERT INTO brain_fts(rowid, title, content)
        VALUES (NEW.rowid, NEW.title, NEW.content);
      END
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_brain_project ON brain_entries(project)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_brain_type ON brain_entries(type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_brain_session ON brain_entries(session_id)`);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // === CRUD ===

  insert(entry: Omit<BrainEntry, 'id' | 'createdAt'>): BrainEntry {
    const id = `brain_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const full: BrainEntry = { ...entry, id, createdAt: now };

    this.db.query(`
      INSERT INTO brain_entries (id, project, session_id, type, topic_key, title, content, created_at, metadata)
      VALUES ($id, $project, $sessionId, $type, $topicKey, $title, $content, $createdAt, $metadata)
    `).run({
      $id: full.id,
      $project: full.project,
      $sessionId: full.sessionId ?? null,
      $type: full.type,
      $topicKey: full.topicKey,
      $title: full.title,
      $content: full.content,
      $createdAt: full.createdAt,
      $metadata: JSON.stringify(full.metadata),
    });

    // Upsert topic metadata
    this.db.query(`
      INSERT INTO brain_topics (topic_key, project, type, entry_count, last_entry_at)
      VALUES ($topicKey, $project, $type, 1, $lastEntryAt)
      ON CONFLICT(topic_key, project) DO UPDATE SET
        entry_count = entry_count + 1,
        last_entry_at = $lastEntryAt
    `).run({
      $topicKey: full.topicKey,
      $project: full.project,
      $type: full.type,
      $lastEntryAt: now,
    });

    return full;
  }

  search(query: string, opts: BrainSearchOptions = {}): BrainEntry[] {
    const { project, type, limit = 10 } = opts;
    const ftsQuery = this.buildFtsQuery(query);

    let sql = `
      SELECT e.id, e.project, e.session_id, e.type, e.topic_key, e.title, e.content, e.created_at, e.metadata
      FROM brain_entries e
      JOIN brain_fts f ON f.rowid = e.rowid
      WHERE brain_fts MATCH $ftsQuery
    `;
    const params: Record<string, unknown> = { $ftsQuery: ftsQuery };

    if (project) { sql += ' AND e.project = $project'; params.$project = project; }
    if (type) { sql += ' AND e.type = $type'; params.$type = type; }

    sql += ' ORDER BY rank LIMIT $limit';
    params.$limit = limit;

    return this.all<BrainRow>(sql, params).map(r => this.rowToEntry(r));
  }

  getByTopic(topicKey: string, project: string): BrainEntry[] {
    return this.all<BrainRow>(
      `SELECT * FROM brain_entries WHERE topic_key = $topicKey AND project = $project ORDER BY created_at DESC`,
      { $topicKey: topicKey, $project: project },
    ).map(r => this.rowToEntry(r));
  }

  getBySession(sessionId: string, project: string): BrainEntry[] {
    return this.all<BrainRow>(
      `SELECT * FROM brain_entries WHERE session_id = $sessionId AND project = $project ORDER BY created_at DESC`,
      { $sessionId: sessionId, $project: project },
    ).map(r => this.rowToEntry(r));
  }

  getRecent(project: string, limit = 20): BrainEntry[] {
    return this.all<BrainRow>(
      `SELECT * FROM brain_entries WHERE project = $project ORDER BY created_at DESC LIMIT $limit`,
      { $project: project, $limit: limit },
    ).map(r => this.rowToEntry(r));
  }

  count(opts: { project: string; type?: BrainEntryType }): number {
    const { project, type } = opts;
    const sql = type
      ? `SELECT COUNT(*) as cnt FROM brain_entries WHERE project = $project AND type = $type`
      : `SELECT COUNT(*) as cnt FROM brain_entries WHERE project = $project`;
    const row = this.db.query(sql).get({ $project: project, $type: type }) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  delete(id: string): void {
    this.db.query('DELETE FROM brain_entries WHERE id = $id').run({ $id: id });
  }

  // === Helpers ===

  private all<T>(sql: string, params: Record<string, unknown> = {}): T[] {
    return this.db.query(sql).all(params) as T[];
  }

  private buildFtsQuery(query: string): string {
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return '""';
    return terms.map(t => `"${t}"*`).join(' OR ');
  }

  private rowToEntry(row: BrainRow): BrainEntry {
    return {
      id: row.id,
      project: row.project,
      sessionId: row.session_id ?? undefined,
      type: row.type as BrainEntryType,
      topicKey: row.topic_key,
      title: row.title,
      content: row.content,
      createdAt: row.created_at,
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }
}

interface BrainRow {
  id: string;
  project: string;
  session_id: string | null;
  type: string;
  topic_key: string;
  title: string;
  content: string;
  created_at: number;
  metadata: string;
}