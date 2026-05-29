/**
 * GraphIndexerPlugin — Plugin interface for the code graph.
 *
 * Provides:
 * - MCP tools: graph_search, graph_context, graph_trace
 * - File watcher with 2s debounce
 * - Lazy tree-sitter init on first use (avoids startup cost)
 *
 * CLI commands exposed via /graph init | search | trace
 */

import type { Plugin, PluginHostAPI, PluginManifest, ToolHandler } from '../../../core/types.js';
import { ToolRegistry } from '../../../core/tool-registry.js';
import { GraphIndexer } from './indexer.js';
import { GraphWatcher } from './watcher.js';
import { initParsers } from './parser.js';
import type { IndexStats, GraphSearchResult } from './types.js';

// ─── Plugin manifest ────────────────────────────────────────────────────────

export const MANIFEST: PluginManifest = {
  id: 'graph-indexer',
  name: 'Code Graph',
  version: '0.1.0',
  type: 'knowledge' as const,
  capabilities: ['graph-context', 'graph-trace', 'graph-search', 'symbol-index'],
  dependencies: [],
};

// ─── CLI command formatter ─────────────────────────────────────────────────

export function formatGraphSearch(results: GraphSearchResult[]): string {
  if (!results.length) return 'No symbols found.';
  return results
    .map(
      r =>
        `**${r.node.symbolName}** \`${r.node.symbolType}\` · ${r.node.filePath}:${r.node.line}`,
    )
    .join('\n');
}

export function formatTrace(result: NonNullable<ReturnType<GraphIndexer['traceCallGraph']>>): string {
  const lines = [`## Call graph: \`${result.symbol}\` (${result.direction})`];

  if (result.callers.length) {
    lines.push('\n**Called by:**');
    for (const e of result.callers) {
      lines.push(`  ← edge #${e.id} (${e.edgeType})`);
    }
  }

  if (result.callees.length) {
    lines.push('\n**Calls:**');
    for (const e of result.callees) {
      lines.push(`  → edge #${e.id} (${e.edgeType})`);
    }
  }

  if (!result.callers.length && !result.callees.length) {
    lines.push('\n_(no call graph edges found)_');
  }

  return lines.join('\n');
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

export class GraphIndexerPlugin implements Plugin {
  manifest = MANIFEST;

  private host: PluginHostAPI | null = null;
  private indexer: GraphIndexer | null = null;
  private watcher: GraphWatcher | null = null;
  private projectPath: string | null = null;
  private parsersReady = false;

  async initialize(host: PluginHostAPI): Promise<void> {
    this.host = host;

    const dataDir = process.env.MIURA_GRAPH_DB ?? '/tmp/miura-graph.db';

    this.indexer = new GraphIndexer(dataDir);

    // Register MCP tools
    const registry = host.getToolRegistry();
    registry.register(this.makeGraphSearchTool());
    registry.register(this.makeGraphContextTool());
    registry.register(this.makeGraphTraceTool());
  }

  async activate(): Promise<void> {
    // Lazy init parsers on first activation (not on plugin load)
    if (!this.parsersReady) {
      await initParsers();
      this.parsersReady = true;
    }
  }

  async deactivate(): Promise<void> {
    await this.watcher?.stop();
  }

  async unload(): Promise<void> {
    this.indexer?.close();
    this.indexer = null;
    this.watcher = null;
    this.host = null;
  }

  // ─── Public API (for CLI commands) ─────────────────────────────────────────

  getIndexer(): GraphIndexer | null {
    return this.indexer;
  }

  async runInit(projectPath: string): Promise<IndexStats> {
    if (!this.indexer) throw new Error('GraphIndexer not initialized');
    this.projectPath = projectPath;

    if (!this.parsersReady) {
      await initParsers();
      this.parsersReady = true;
    }

    const stats = await this.indexer.indexAll(projectPath);

    // Start watcher for incremental updates
    this.watcher = new GraphWatcher(this.indexer, projectPath);
    this.watcher.setStaleCallback(() => {
      this.host?.emit('graph:stale', null);
    });
    await this.watcher.start(['**/*.ts', '**/*.tsx', '**/*.js', '**/*.go', '**/*.py']);

    return stats;
  }

  isIndexStale(): boolean {
    return this.indexer?.isStale() ?? true;
  }

  getLastIndexedAt(): number | null {
    return this.indexer?.getLastIndexedAt() ?? null;
  }

  // ─── Tool factories ─────────────────────────────────────────────────────────

  private makeGraphSearchTool(): ToolHandler {
    return {
      definition: {
        name: 'graph_search',
        description: 'Full-text search across all indexed symbols (FTS5-powered)',
        parameters: {
          type: 'object',
          properties: {
            query:    { type: 'string', description: 'Search term' },
            limit:    { type: 'number', description: 'Max results (default 50)' },
            type:     { type: 'string', description: 'Filter by symbol type: function|class|interface|method|variable' },
          },
          required: ['query'],
        },
      },
      execute: async (args) => {
        const indexer = this.getIndexer();
        if (!indexer) return { name: 'graph_search', output: 'GraphIndexer not initialized', durationMs: 0 };

        const results = indexer.search(args.query as string, args.limit as number ?? 50);
        return {
          name: 'graph_search',
          output: results.length
            ? formatGraphSearch(results)
            : `No symbols matching "${args.query}"`,
          durationMs: 0,
        };
      },
    };
  }

  private makeGraphContextTool(): ToolHandler {
    return {
      definition: {
        name: 'graph_context',
        description: 'Get architectural context about a symbol (file, function, class)',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Symbol name to look up' },
            file:   { type: 'string', description: 'Optional: restrict to file path' },
          },
          required: ['symbol'],
        },
      },
      execute: async (args) => {
        const indexer = this.getIndexer();
        if (!indexer) return { name: 'graph_context', output: 'GraphIndexer not initialized', durationMs: 0 };

        const ctx = indexer.getSymbolContext(
          args.symbol as string,
          args.file as string | undefined,
        );

        if (!ctx) return { name: 'graph_context', output: `Symbol "${args.symbol}" not found`, durationMs: 0 };

        const { definition, neighbors } = ctx;
        const lines = [
          `## ${definition.symbolName}`,
          `**${definition.symbolType}** · \`${definition.language}\``,
          `File: ${definition.filePath}:${definition.line}`,
          definition.signature ? `Signature: ${definition.signature}` : '',
          '',
          '**Neighbors in same file:**',
          ...neighbors.map(
            n => `  ${n.symbolType.padEnd(10)} ${n.symbolName.padEnd(30)} :${n.line}`,
          ),
        ];

        return { name: 'graph_context', output: lines.join('\n'), durationMs: 0 };
      },
    };
  }

  private makeGraphTraceTool(): ToolHandler {
    return {
      definition: {
        name: 'graph_trace',
        description: 'Trace call graph (who calls this, what does this call)',
        parameters: {
          type: 'object',
          properties: {
            symbol:    { type: 'string',  description: 'Symbol to trace' },
            direction: { type: 'string',   description: 'up | down | both', enum: ['up', 'down', 'both'] },
          },
          required: ['symbol', 'direction'],
        },
      },
      execute: async (args) => {
        const indexer = this.getIndexer();
        if (!indexer) return { name: 'graph_trace', output: 'GraphIndexer not initialized', durationMs: 0 };

        const result = indexer.traceCallGraph(
          args.symbol as string,
          args.direction as 'up' | 'down' | 'both',
        );

        if (!result) return { name: 'graph_trace', output: `Symbol "${args.symbol}" not found`, durationMs: 0 };

        return { name: 'graph_trace', output: formatTrace(result), durationMs: 0 };
      },
    };
  }
}