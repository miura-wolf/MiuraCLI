/**
 * Brain Types — Shared type definitions for the Brain memory system.
 */

export type BrainEntryType =
  | 'decision'      // Architectural decisions, tradeoffs made
  | 'architecture' // Architecture notes, design patterns
  | 'bugfix'        // Bug fixes with root cause
  | 'pattern'       // Discovered patterns, conventions, gotchas
  | 'discovery'     // Non-obvious technical findings
  | 'config'        // Configuration decisions
  | 'learning';     // General learnings

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

export interface BrainSearchResult {
  entry: BrainEntry;
  score: number;
  snippet?: string;
}

export interface BrainStats {
  total: number;
  byType: Record<BrainEntryType, number>;
  byTopic: Record<string, number>;
}