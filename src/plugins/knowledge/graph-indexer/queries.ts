/**
 * GraphQueries — SQLite query helpers for the code graph.
 * Uses bun:sqlite's query() + named params API.
 */

import type { Database as BunDatabase } from 'bun:sqlite';
import type {
  GraphNode,
  GraphEdge,
  SymbolType,
  EdgeType,
  GraphSearchResult,
  CallGraphResult,
  ProjectStructure,
} from './types.js';

interface NodeRow {
  id: number;
  file_path: string;
  symbol_name: string;
  symbol_type: string;
  signature: string | null;
  line: number;
  col: number;
  end_line: number | null;
  end_col: number | null;
  language: string;
  node_data: string;
}

function rowToNode(r: NodeRow): GraphNode {
  return {
    id: r.id,
    filePath: r.file_path,
    symbolName: r.symbol_name,
    symbolType: r.symbol_type as SymbolType,
    signature: r.signature ?? undefined,
    line: r.line,
    column: r.col,
    endLine: r.end_line ?? undefined,
    endColumn: r.end_col ?? undefined,
    language: r.language as GraphNode['language'],
    metadata: JSON.parse(r.node_data || '{}'),
  };
}

export class GraphQueries {
  private db: BunDatabase;

  constructor(db: BunDatabase) {
    this.db = db;
  }

  // ─── Node operations ────────────────────────────────────────────────────────

  insertNode(
    filePath: string,
    symbolName: string,
    symbolType: SymbolType,
    line: number,
    col: number,
    language: string,
    signature?: string,
    endLine?: number,
    endCol?: number,
    nodeData?: Record<string, unknown>,
  ): number {
    const result = this.db
      .query(
        `INSERT INTO graph_nodes
           (file_path, symbol_name, symbol_type, signature, line, col,
            end_line, end_col, language, node_data)
         VALUES ($fp, $sn, $st, $sig, $line, $col, $el, $ec, $lang, $nd)`,
      )
      .run({
        $fp: filePath,
        $sn: symbolName,
        $st: symbolType,
        $sig: signature ?? null,
        $line: line,
        $col: col,
        $el: endLine ?? null,
        $ec: endCol ?? null,
        $lang: language,
        $nd: JSON.stringify(nodeData ?? {}),
      });
    return Number(result.lastInsertRowid);
  }

  upsertNode(
    filePath: string,
    symbolName: string,
    symbolType: SymbolType,
    line: number,
    col: number,
    language: string,
    signature?: string,
    endLine?: number,
    endCol?: number,
    nodeData?: Record<string, unknown>,
  ): number {
    const existing = this.db
      .query<{ id: number }>(
        `SELECT id FROM graph_nodes
         WHERE file_path = $fp AND symbol_name = $sn AND line = $line`,
      )
      .get({ $fp: filePath, $sn: symbolName, $line: line });

    if (existing) return existing.id;

    return this.insertNode(
      filePath, symbolName, symbolType, line, col, language,
      signature, endLine, endCol, nodeData,
    );
  }

  // ─── Edge operations ────────────────────────────────────────────────────────

  insertEdge(
    sourceId: number,
    targetId: number,
    edgeType: EdgeType,
    provenance: 'static' | 'heuristic' = 'static',
  ): void {
    if (sourceId === targetId) return;
    try {
      this.db
        .query(
          `INSERT OR IGNORE INTO graph_edges (source_id, target_id, edge_type, provenance)
           VALUES ($src, $tgt, $type, $prov)`,
        )
        .run({ $src: sourceId, $tgt: targetId, $type: edgeType, $prov: provenance });
    } catch {
      // Ignore constraint violations
    }
  }

  // ─── Queries ─────────────────────────────────────────────────────────────────

  findSymbol(name: string, fileScope?: string): GraphNode[] {
    const sql = fileScope
      ? `SELECT * FROM graph_nodes WHERE symbol_name = $name AND file_path LIKE $scope ORDER BY line`
      : `SELECT * FROM graph_nodes WHERE symbol_name = $name ORDER BY line`;

    const params = fileScope
      ? { $name: name, $scope: `${fileScope}%` }
      : { $name: name };

    const rows = this.db.query<NodeRow>(sql).all(params);
    return rows.map(rowToNode);
  }

  getFileSymbols(filePath: string): GraphNode[] {
    const rows = this.db
      .query<NodeRow>(`SELECT * FROM graph_nodes WHERE file_path = $fp ORDER BY line`)
      .all({ $fp: filePath });
    return rows.map(rowToNode);
  }

  /**
   * FTS5-powered symbol search.
   */
  search(query: string, limit = 50, type?: SymbolType): GraphSearchResult[] {
    if (!query.trim()) return [];

    const sql = type
      ? `
        SELECT graph_fts.rowid, bm25(graph_fts) AS score, gn.*
        FROM graph_fts
        JOIN graph_nodes gn ON gn.id = graph_fts.rowid
        WHERE graph_fts MATCH $q AND gn.symbol_type = $type
        ORDER BY score
        LIMIT $limit
      `
      : `
        SELECT graph_fts.rowid, bm25(graph_fts) AS score, gn.*
        FROM graph_fts
        JOIN graph_nodes gn ON gn.id = graph_fts.rowid
        WHERE graph_fts MATCH $q
        ORDER BY score
        LIMIT $limit
      `;

    const params: Record<string, unknown> = {
      $q: `${query}*`,
      $limit: limit,
      ...(type ? { $type: type } : {}),
    };

    const rows = this.db.query<NodeRow & { score: number }>(sql).all(params);
    return rows.map(r => ({
      node: rowToNode(r),
      score: Math.abs(r.score),
    }));
  }

  /**
   * Trace call graph.
   *   'up'    → who calls this symbol (incoming edges)
   *   'down'  → what does this symbol call (outgoing edges)
   *   'both'  → both directions
   */
  traceCallGraph(symbolName: string, direction: 'up' | 'down' | 'both'): CallGraphResult | null {
    const rows = this.db
      .query<NodeRow>(`SELECT * FROM graph_nodes WHERE symbol_name = $name LIMIT 1`)
      .all({ $name: symbolName });

    if (!rows.length) return null;

    const target = rowToNode(rows[0]);
    const callers: GraphEdge[] = [];
    const callees: GraphEdge[] = [];

    if (direction === 'up' || direction === 'both') {
      const upRows = this.db
        .query<{ id: number; source_id: number; target_id: number; edge_type: string; provenance: string }>(
          `SELECT * FROM graph_edges WHERE target_id = $tgt`,
        )
        .all({ $tgt: target.id });

      for (const r of upRows) {
        callers.push({
          id: r.id,
          sourceId: r.source_id,
          targetId: r.target_id,
          edgeType: r.edge_type as EdgeType,
          provenance: r.provenance as 'static' | 'heuristic',
        });
      }
    }

    if (direction === 'down' || direction === 'both') {
      const downRows = this.db
        .query<{ id: number; source_id: number; target_id: number; edge_type: string; provenance: string }>(
          `SELECT * FROM graph_edges WHERE source_id = $src`,
        )
        .all({ $src: target.id });

      for (const r of downRows) {
        callees.push({
          id: r.id,
          sourceId: r.source_id,
          targetId: r.target_id,
          edgeType: r.edge_type as EdgeType,
          provenance: r.provenance as 'static' | 'heuristic',
        });
      }
    }

    return { symbol: symbolName, direction, callers, callees };
  }

  /**
   * Get context about a symbol: definition + nearby symbols in same file.
   */
  getSymbolContext(symbolName: string, filePath?: string): { definition: GraphNode; neighbors: GraphNode[] } | null {
    const sql = filePath
      ? `SELECT * FROM graph_nodes WHERE symbol_name = $name AND file_path = $fp LIMIT 1`
      : `SELECT * FROM graph_nodes WHERE symbol_name = $name LIMIT 1`;

    const params = filePath ? { $name: symbolName, $fp: filePath } : { $name: symbolName };
    const rows = this.db.query<NodeRow>(sql).all(params);

    if (!rows.length) return null;

    const definition = rowToNode(rows[0]);
    const neighbors = this.db
      .query<NodeRow>(
        `SELECT * FROM graph_nodes
         WHERE file_path = $fp AND id != $id
         ORDER BY ABS(line - $line)
         LIMIT 10`,
      )
      .all({ $fp: definition.filePath, $id: definition.id, $line: definition.line });

    return { definition, neighbors: neighbors.map(rowToNode) };
  }

  /**
   * Project-wide stats.
   */
  getProjectStructure(): ProjectStructure {
    const fileRows = this.db
      .query<{ file_path: string }>(`SELECT DISTINCT file_path FROM graph_nodes ORDER BY file_path`)
      .all();

    const langRows = this.db
      .query<{ language: string }>(`SELECT DISTINCT language FROM graph_nodes`)
      .all();

    const nodeCount = (this.db.query<{ c: number }>(`SELECT COUNT(*) as c FROM graph_nodes`).get() ?? { c: 0 }).c;
    const edgeCount = (this.db.query<{ c: number }>(`SELECT COUNT(*) as c FROM graph_edges`).get() ?? { c: 0 }).c;

    return {
      files: fileRows.map(r => r.file_path),
      totalNodes: nodeCount,
      totalEdges: edgeCount,
      languages: langRows.map(r => r.language) as ProjectStructure['languages'],
    };
  }

  countByType(type: SymbolType): number {
    return (this.db.query<{ c: number }>(`SELECT COUNT(*) as c FROM graph_nodes WHERE symbol_type = $t`)
      .get({ $t: type }) ?? { c: 0 }).c;
  }

  countByFile(filePath: string): number {
    return (this.db.query<{ c: number }>(`SELECT COUNT(*) as c FROM graph_nodes WHERE file_path = $fp`)
      .get({ $fp: filePath }) ?? { c: 0 }).c;
  }
}