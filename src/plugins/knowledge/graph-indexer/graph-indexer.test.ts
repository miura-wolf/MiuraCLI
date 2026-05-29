/**
 * GraphIndexer plugin tests.
 * Uses isolated temp SQLite files per describe block.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { GraphSchema } from './schema.js';
import { GraphQueries } from './queries.js';
import { GraphIndexer } from './indexer.js';
import { detectLanguage } from './parser.js';
import { formatGraphSearch, formatTrace } from './index.js';
import type { GraphSearchResult } from './types.js';

function freshDb(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

const S = '/tmp/gx-schema.db';
const Q = '/tmp/gx-queries.db';
const I = '/tmp/gx-indexer.db';

// ─── GraphSchema ──────────────────────────────────────────────────────────────

describe('GraphSchema', () => {
  let schema: GraphSchema;

  beforeEach(() => { freshDb(S); schema = new GraphSchema(S); schema.initialize(); });
  afterEach(() => { schema.close(); if (existsSync(S)) unlinkSync(S); });

  it('creates all required tables and indexes', () => {
    const db = schema.db_;
    db.query(`SELECT COUNT(*) as c FROM graph_nodes`).get();
    db.query(`SELECT COUNT(*) as c FROM graph_edges`).get();
    db.query(`SELECT COUNT(*) as c FROM graph_fts`).get();
    db.query(`SELECT COUNT(*) as c FROM graph_meta`).get();
  });

  it('creates FTS5 sync triggers (insert, delete, update)', () => {
    const db = schema.db_;
    const rows = db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'graph_fts_%'`,
    ).all();
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it('setMeta and getMeta work', () => {
    schema.setMeta('last_indexed_at', '1234567890');
    schema.setMeta('last_indexed_path', '/my/project');
    expect(schema.getMeta('last_indexed_at')).toBe('1234567890');
    expect(schema.getMeta('last_indexed_path')).toBe('/my/project');
    expect(schema.getMeta('nonexistent')).toBeNull();
  });

  it('isStale returns true when never indexed', () => {
    expect(schema.isStale()).toBe(true);
  });

  it('isStale returns false when recently indexed', () => {
    schema.setLastIndexedAt(Date.now());
    expect(schema.isStale(10_000)).toBe(false);
  });

  it('isStale returns true when stale', () => {
    schema.setLastIndexedAt(Date.now() - 20_000);
    expect(schema.isStale(10_000)).toBe(true);
  });
});

// ─── GraphQueries ─────────────────────────────────────────────────────────────

describe('GraphQueries', () => {
  let schema: GraphSchema;
  let queries: GraphQueries;

  beforeEach(() => { freshDb(Q); schema = new GraphSchema(Q); schema.initialize(); queries = new GraphQueries(schema.db_); });
  afterEach(() => { schema.close(); if (existsSync(Q)) unlinkSync(Q); });

  it('inserts a node and retrieves it by name', () => {
    const id = queries.insertNode('/src/foo.ts', 'myFunction', 'function', 10, 0, 'typescript', '(x: number): number', 15, 10, {});
    expect(id).toBeGreaterThan(0);
    const found = queries.findSymbol('myFunction');
    expect(found).toHaveLength(1);
    expect(found[0].symbolName).toBe('myFunction');
    expect(found[0].line).toBe(10);
    expect(found[0].column).toBe(0);
    expect(found[0].signature).toBe('(x: number): number');
  });

  it('generates unique IDs for each node', () => {
    const id1 = queries.insertNode('/a.ts', 'a', 'function', 1, 0, 'typescript');
    const id2 = queries.insertNode('/b.ts', 'b', 'function', 1, 0, 'typescript');
    expect(id1).not.toBe(id2);
  });

  it('inserts call graph edges and traces incoming', () => {
    const src = queries.insertNode('/a.ts', 'caller',  'function', 1, 0, 'typescript');
    const tgt = queries.insertNode('/b.ts', 'callee',  'function', 5, 0, 'typescript');
    queries.insertEdge(src, tgt, 'calls', 'static');

    const callers = queries.traceCallGraph('callee', 'up');
    expect(callers).not.toBeNull();
    expect(callers!.callers).toHaveLength(1);
    expect(callers!.callers[0].sourceId).toBe(src);
    expect(callers!.callers[0].edgeType).toBe('calls');
  });

  it('traces outgoing edges', () => {
    const src = queries.insertNode('/a.ts', 'parent', 'function', 1, 0, 'typescript');
    const tgt = queries.insertNode('/b.ts', 'child',  'function', 5, 0, 'typescript');
    queries.insertEdge(src, tgt, 'calls', 'heuristic');

    const callees = queries.traceCallGraph('parent', 'down');
    expect(callees).not.toBeNull();
    expect(callees!.callees).toHaveLength(1);
    expect(callees!.callees[0].targetId).toBe(tgt);
  });

  it('does not create self-referencing edges', () => {
    const id = queries.insertNode('/a.ts', 'self', 'function', 1, 0, 'typescript');
    queries.insertEdge(id, id, 'calls', 'static');
    const callers = queries.traceCallGraph('self', 'up');
    expect(callers!.callers).toHaveLength(0);
  });

  it('finds symbols in file scope', () => {
    queries.insertNode('/a.ts', 'foo', 'function', 1, 0, 'typescript');
    queries.insertNode('/b.ts', 'foo', 'function', 5, 0, 'javascript');
    const global = queries.findSymbol('foo');
    expect(global).toHaveLength(2);
    const scoped = queries.findSymbol('foo', '/a.ts');
    expect(scoped).toHaveLength(1);
    expect(scoped[0].filePath).toBe('/a.ts');
  });

  it('FTS5 search finds symbols by keyword', () => {
    queries.insertNode('/a.ts', 'processFile', 'function', 1, 0, 'typescript');
    queries.insertNode('/b.ts', 'processImage', 'function', 5, 0, 'typescript');
    queries.insertNode('/c.ts', 'handleError', 'function', 10, 0, 'typescript');

    const results = queries.search('process');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const names = results.map(r => r.node.symbolName);
    expect(names.some(n => n.includes('process'))).toBe(true);
  });

  it('search filters by symbol type', () => {
    queries.insertNode('/a.ts', 'MyClass', 'class',    1, 0, 'typescript');
    queries.insertNode('/b.ts', 'myFunc',  'function', 5, 0, 'typescript');

    const classes = queries.search('My', 50, 'class');
    expect(classes.length).toBeGreaterThanOrEqual(1);
    expect(classes[0].node.symbolType).toBe('class');
  });

  it('search returns empty for non-matching query', () => {
    queries.insertNode('/a.ts', 'foo', 'function', 1, 0, 'typescript');
    const results = queries.search('nonexistentSymbol12345');
    expect(results).toHaveLength(0);
  });

  it('getFileSymbols returns symbols in line order', () => {
    queries.insertNode('/a.ts', 'first',  'function', 3, 0, 'typescript');
    queries.insertNode('/a.ts', 'second', 'function', 7, 0, 'typescript');
    queries.insertNode('/a.ts', 'third',  'function', 1, 0, 'typescript');
    const symbols = queries.getFileSymbols('/a.ts');
    expect(symbols.map(s => s.symbolName)).toEqual(['third', 'first', 'second']);
  });

  it('getFileSymbols returns empty for unknown file', () => {
    expect(queries.getFileSymbols('/nonexistent.ts')).toHaveLength(0);
  });

  it('getSymbolContext returns definition and neighbors', () => {
    queries.insertNode('/a.ts', 'target', 'function', 5, 0, 'typescript');
    queries.insertNode('/a.ts', 'other1', 'function', 2, 0, 'typescript');
    queries.insertNode('/a.ts', 'other2', 'function', 9, 0, 'typescript');

    const ctx = queries.getSymbolContext('target', '/a.ts');
    expect(ctx).not.toBeNull();
    expect(ctx!.definition.symbolName).toBe('target');
    expect(ctx!.neighbors.length).toBeGreaterThanOrEqual(1);
  });

  it('getSymbolContext returns null for unknown symbol', () => {
    expect(queries.getSymbolContext('doesNotExist')).toBeNull();
  });

  it('traceCallGraph returns null for unknown symbol', () => {
    expect(queries.traceCallGraph('doesNotExist', 'up')).toBeNull();
  });

  it('getProjectStructure returns correct stats', () => {
    queries.insertNode('/a.ts', 'fn', 'function', 1, 0, 'typescript');
    queries.insertNode('/b.ts', 'cls', 'class',    2, 0, 'javascript');

    const structure = queries.getProjectStructure();
    expect(structure.totalNodes).toBe(2);
    expect(structure.totalEdges).toBe(0);
    expect(structure.files).toContain('/a.ts');
    expect(structure.files).toContain('/b.ts');
    expect(structure.languages).toContain('typescript');
    expect(structure.languages).toContain('javascript');
  });

  it('countByType returns correct counts', () => {
    queries.insertNode('/a.ts', 'fn1',  'function', 1, 0, 'typescript');
    queries.insertNode('/a.ts', 'fn2',  'function', 2, 0, 'typescript');
    queries.insertNode('/a.ts', 'cls1', 'class',    3, 0, 'typescript');
    expect(queries.countByType('function')).toBe(2);
    expect(queries.countByType('class')).toBe(1);
  });
});

// ─── GraphIndexer ─────────────────────────────────────────────────────────────

describe('GraphIndexer', () => {
  let indexer: GraphIndexer;

  beforeEach(() => { freshDb(I); indexer = new GraphIndexer(I); });
  afterEach(() => { indexer.close(); if (existsSync(I)) unlinkSync(I); });

  it('initializes without error', () => {
    expect(indexer).toBeDefined();
  });

  it('isStale returns true when no index exists', () => {
    expect(indexer.isStale()).toBe(true);
  });

  it('indexFile skips unknown file types without error', async () => {
    const result = await indexer.indexFile('/tmp/test.txt');
    expect(result.nodes).toBe(0);
    expect(result.edges).toBe(0);
  });
});

// ─── detectLanguage ──────────────────────────────────────────────────────────

describe('detectLanguage', () => {
  it('returns correct language for known extensions', () => {
    expect(detectLanguage('foo.ts')).toBe('typescript');
    expect(detectLanguage('bar.tsx')).toBe('tsx');
    expect(detectLanguage('baz.js')).toBe('javascript');
    expect(detectLanguage('app.mjs')).toBe('javascript');
    expect(detectLanguage('app.cjs')).toBe('javascript');
    expect(detectLanguage('main.go')).toBe('go');
    expect(detectLanguage('script.py')).toBe('python');
    expect(detectLanguage('noextension')).toBe('unknown');
    expect(detectLanguage('unknown.xyz')).toBe('unknown');
  });
});

// ─── formatGraphSearch ────────────────────────────────────────────────────────

describe('formatGraphSearch', () => {
  it('formats results as markdown', () => {
    const results: GraphSearchResult[] = [
      {
        node: { id: 1, filePath: '/a.ts', symbolName: 'myFunc', symbolType: 'function', line: 10, column: 0, language: 'typescript', metadata: {} },
        score: 0.5,
      },
    ];
    const output = formatGraphSearch(results);
    expect(output).toContain('**myFunc**');
    expect(output).toContain('function');
    expect(output).toContain('/a.ts:10');
  });

  it('returns "No symbols found" for empty results', () => {
    expect(formatGraphSearch([])).toBe('No symbols found.');
  });
});

// ─── formatTrace ──────────────────────────────────────────────────────────────

describe('formatTrace', () => {
  it('shows callers and callees', () => {
    const result = {
      symbol: 'foo',
      direction: 'both' as const,
      callers:  [{ id: 1, sourceId: 10, targetId: 20, edgeType: 'calls' as const, provenance: 'static' as const }],
      callees:  [{ id: 2, sourceId: 20, targetId: 30, edgeType: 'calls' as const, provenance: 'heuristic' as const }],
    };
    const output = formatTrace(result);
    expect(output).toContain('foo');
    expect(output).toContain('Called by');
    expect(output).toContain('Calls');
  });

  it('shows empty message when no edges', () => {
    const result = { symbol: 'orphan', direction: 'both' as const, callers: [], callees: [] };
    expect(formatTrace(result)).toContain('no call graph edges found');
  });
});