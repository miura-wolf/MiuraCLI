/**
 * GraphIndexer — core indexing engine.
 *
 * Orchestrates: schema setup, file parsing, node/edge persistence.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import fastGlob from 'fast-glob';
import { GraphSchema } from './schema.js';
import { GraphQueries } from './queries.js';
import { parseFile, extractCallEdges, detectLanguage } from './parser.js';
import type {
  IndexOptions,
  IndexStats,
  Language as GraphLang,
  GraphNode,
} from './types.js';

const DEFAULT_EXCLUDE = [
  'node_modules/**',
  'dist/**',
  'build/**',
  '.git/**',
  '*.test.ts',
  '*.test.js',
  '*.spec.ts',
  '*.spec.js',
  'coverage/**',
];

const DEFAULT_LANGS: GraphLang[] = ['typescript', 'javascript', 'tsx', 'go', 'python'];

export class GraphIndexer {
  private schema: GraphSchema;
  private queries: GraphQueries;

  constructor(dbPath: string) {
    this.schema = new GraphSchema(dbPath);
    this.schema.initialize();
    this.queries = new GraphQueries(this.schema.db_);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async init(projectPath: string, options?: IndexOptions): Promise<void> {
    // Ensure db is ready (already initialized in constructor)
  }

  /** Index a single file. */
  async indexFile(filePath: string): Promise<{ nodes: number; edges: number }> {
    let source: string;
    try {
      source = readFileSync(filePath, 'utf-8');
    } catch {
      return { nodes: 0, edges: 0 };
    }

    const lang = detectLanguage(filePath);
    if (lang === 'unknown') return { nodes: 0, edges: 0 };

    // Remove existing nodes for this file (incremental re-index)
    this.schema.db_.query(`DELETE FROM graph_nodes WHERE file_path = $fp`).run({ $fp: filePath });

    const symbols = parseFile(source, filePath);
    const callEdges = extractCallEdges(source, symbols);

    let nodeCount = 0;
    let edgeCount = 0;

    // Persist nodes
    const nodeIds = new Map<string, number>();
    for (const sym of symbols) {
      const id = this.queries.upsertNode(
        filePath,
        sym.name,
        sym.type,
        sym.line,
        sym.column,
        lang,
        sym.signature,
        sym.endLine,
        sym.endColumn,
        {},
      );
      nodeIds.set(sym.name, id);
      nodeCount++;
    }

    // Persist call edges
    for (const { from, toName } of callEdges) {
      const fromId = nodeIds.get(from.name);
      const toId = nodeIds.get(toName);
      if (fromId && toId) {
        this.queries.insertEdge(fromId, toId, 'calls', 'heuristic');
        edgeCount++;
      }
    }

    // Update file hash (for change detection)
    try {
      const hash = String(statSync(filePath).mtimeMs);
      this.schema.setMeta(`hash:${filePath}`, hash);
    } catch { /* ignore */ }

    return { nodes: nodeCount, edges: edgeCount };
  }

  /** Remove a file from the index. */
  async removeFile(filePath: string): Promise<void> {
    this.schema.db_.query(`DELETE FROM graph_nodes WHERE file_path = $fp`).run({ $fp: filePath });
  }

  /** Check if file changed since last index. */
  hasFileChanged(filePath: string): boolean {
    try {
      const currentHash = String(statSync(filePath).mtimeMs);
      const storedHash = this.schema.getMeta(`hash:${filePath}`);
      return storedHash !== currentHash;
    } catch {
      return false;
    }
  }

  /** Full project re-index. */
  async indexAll(projectPath: string, options?: IndexOptions): Promise<IndexStats> {
    const start = Date.now();
    const errors: string[] = [];

    const langs = options?.languages ?? DEFAULT_LANGS;
    const exclude = [...DEFAULT_EXCLUDE, ...(options?.excludePatterns ?? [])];

    // Build glob patterns for supported extensions
    const patterns = langs.map(l => {
      switch (l) {
        case 'typescript': return '**/*.ts';
        case 'tsx':        return '**/*.tsx';
        case 'javascript': return '**/*.{js,mjs,cjs}';
        case 'go':         return '**/*.go';
        case 'python':     return '**/*.py';
        default:           return `**/*.${l}`;
      }
    });

    const allFiles: string[] = [];
    for (const p of patterns) {
      try {
        const hits = fastGlob.sync(p, { cwd: projectPath, ignore: exclude, absolute: true });
        allFiles.push(...hits);
      } catch {
        errors.push(`glob failed: ${p}`);
      }
    }

    // Deduplicate
    const files = [...new Set(allFiles)];

    let nodesCreated = 0;
    let edgesCreated = 0;
    let filesIndexed = 0;
    let filesSkipped = 0;

    for (const file of files) {
      if (this.hasFileChanged(file)) {
        try {
          const { nodes, edges } = await this.indexFile(file);
          nodesCreated += nodes;
          edgesCreated += edges;
          filesIndexed++;
        } catch (e: unknown) {
          errors.push(`index error ${file}: ${e}`);
          filesSkipped++;
        }
      } else {
        filesSkipped++;
      }
    }

    this.schema.setLastIndexedAt(Date.now());
    this.schema.setLastIndexedPath(projectPath);

    return {
      filesIndexed,
      filesSkipped,
      nodesCreated,
      edgesCreated,
      durationMs: Date.now() - start,
      errors,
    };
  }

  // ─── Query passthrough ────────────────────────────────────────────────────

  findSymbol(name: string, fileScope?: string): GraphNode[] {
    return this.queries.findSymbol(name, fileScope);
  }

  search(query: string, limit = 50) {
    return this.queries.search(query, limit);
  }

  traceCallGraph(symbol: string, direction: 'up' | 'down' | 'both') {
    return this.queries.traceCallGraph(symbol, direction);
  }

  getSymbolContext(symbol: string, file?: string) {
    return this.queries.getSymbolContext(symbol, file);
  }

  getProjectStructure() {
    return this.queries.getProjectStructure();
  }

  isStale(maxAgeMs = 10_000): boolean {
    return this.schema.isStale(maxAgeMs);
  }

  getLastIndexedAt(): number | null {
    return this.schema.getLastIndexedAt();
  }

  close(): void {
    this.schema.close();
  }
}