/**
 * GraphIndexer — shared types.
 */

export type SymbolType = 'function' | 'class' | 'interface' | 'variable' | 'import' | 'type' | 'method' | 'enum';

export type EdgeType = 'calls' | 'imports' | 'extends' | 'implements' | 'references' | 'returns';

export type Provenance = 'static' | 'heuristic';

export type Language = 'typescript' | 'javascript' | 'go' | 'python' | 'tsx' | 'unknown';

export interface GraphNode {
  id: number;
  filePath: string;
  symbolName: string;
  symbolType: SymbolType;
  signature?: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  language: Language;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: number;
  sourceId: number;
  targetId: number;
  edgeType: EdgeType;
  provenance: Provenance;
}

export interface ParsedSymbol {
  name: string;
  type: SymbolType;
  signature?: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  children?: ParsedSymbol[];
}

export interface IndexOptions {
  languages?: Language[];
  excludePatterns?: string[];
  includeHeuristics?: boolean;
}

export interface IndexStats {
  filesIndexed: number;
  filesSkipped: number;
  nodesCreated: number;
  edgesCreated: number;
  durationMs: number;
  errors: string[];
}

export interface GraphSearchResult {
  node: GraphNode;
  score: number;
  snippet?: string;
}

export interface CallGraphResult {
  symbol: string;
  direction: 'up' | 'down' | 'both';
  callers: GraphEdge[];
  callees: GraphEdge[];
}

export interface ProjectStructure {
  files: string[];
  totalNodes: number;
  totalEdges: number;
  languages: Language[];
}