/**
 * GraphIndexer — SQLite schema for code graph storage.
 *
 * Tables:
 *   graph_meta        — index metadata (project path, stats, last sync)
 *   graph_nodes       — symbol nodes (functions, classes, etc.)
 *   graph_edges       — relationships between nodes (calls, imports, etc.)
 *
 * FTS5 virtual table: graph_fts — for fast symbol search
 */

import { Database as BunDatabase } from 'bun:sqlite';

export class GraphSchema {
  private db: BunDatabase;

  constructor(dbPath: string) {
    this.db = new BunDatabase(dbPath);
  }

  initialize(): void {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');

    // Metadata table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Nodes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_nodes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path  TEXT    NOT NULL,
        symbol_name TEXT   NOT NULL,
        symbol_type TEXT   NOT NULL,
        signature   TEXT,
        line        INTEGER NOT NULL,
        col         INTEGER NOT NULL,
        end_line    INTEGER,
        end_col     INTEGER,
        language    TEXT    NOT NULL,
        node_data   TEXT    NOT NULL DEFAULT '{}',
        file_hash   TEXT,
        indexed_at  INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
      )
    `);

    // Edges table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_edges (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
        target_id INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
        edge_type TEXT    NOT NULL,
        provenance TEXT   NOT NULL DEFAULT 'static'
      )
    `);

    // Indexes
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_gn_file   ON graph_nodes(file_path)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_gn_name  ON graph_nodes(symbol_name)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_gn_type   ON graph_nodes(symbol_type)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ge_source ON graph_edges(source_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ge_target ON graph_edges(target_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ge_type   ON graph_edges(edge_type)`);

    // FTS5 virtual table for symbol search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS graph_fts USING fts5(
        symbol_name,
        symbol_type,
        content=graph_nodes,
        content_rowid=id,
        tokenize='porter unicode61'
      )
    `);

    // FTS5 sync triggers
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS graph_fts_insert
      AFTER INSERT ON graph_nodes BEGIN
        INSERT INTO graph_fts(rowid, symbol_name, symbol_type)
        VALUES (new.id, new.symbol_name, new.symbol_type);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS graph_fts_delete
      AFTER DELETE ON graph_nodes BEGIN
        INSERT INTO graph_fts(graph_fts, rowid, symbol_name, symbol_type)
        VALUES ('delete', old.id, old.symbol_name, old.symbol_type);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS graph_fts_update
      AFTER UPDATE ON graph_nodes BEGIN
        INSERT INTO graph_fts(graph_fts, rowid, symbol_name, symbol_type)
        VALUES ('delete', old.id, old.symbol_name, old.symbol_type);
        INSERT INTO graph_fts(rowid, symbol_name, symbol_type)
        VALUES (new.id, new.symbol_name, new.symbol_type);
      END
    `);
  }

  setMeta(key: string, value: string): void {
    this.db.query(`INSERT OR REPLACE INTO graph_meta(key, value) VALUES ($key, $value)`)
      .run({ $key: key, $value: value });
  }

  getMeta(key: string): string | null {
    const row = this.db.query<{ value: string }>(
      `SELECT value FROM graph_meta WHERE key = $key`,
    ).get({ $key: key });
    return row?.value ?? null;
  }

  getLastIndexedAt(): number | null {
    const v = this.getMeta('last_indexed_at');
    return v ? parseInt(v) : null;
  }

  setLastIndexedAt(ts: number): void {
    this.setMeta('last_indexed_at', String(ts));
  }

  getLastIndexedPath(): string | null {
    return this.getMeta('last_indexed_path');
  }

  setLastIndexedPath(path: string): void {
    this.setMeta('last_indexed_path', path);
  }

  isStale(maxAgeMs = 10_000): boolean {
    const last = this.getLastIndexedAt();
    if (last === null) return true;
    return Date.now() - last > maxAgeMs;
  }

  /** Expose raw db for GraphQueries (use with caution). */
  get db_(): BunDatabase {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}