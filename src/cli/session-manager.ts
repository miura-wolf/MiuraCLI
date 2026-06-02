/**
 * Session Manager — Persists REPL session history across restarts.
 *
 * The persisted message list captures the full ReAct loop, not just the
 * text of the final assistant turn. To support `/resume` (D.3), a single
 * agent turn can produce:
 *
 *   1. an `assistant` turn with optional `toolCalls` (the model's call)
 *   2. one `tool` turn per result, linked by `toolCallId`
 *   3. another `assistant` turn (the final text, may be empty)
 *
 * Older sessions persisted before this change don't carry these fields
 * and load fine because every new field is optional.
 */

export interface ToolCallRecord {
	id?: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface ToolResultRecord {
	name: string;
	output: string;
	error?: string;
}

export type SessionMessage =
	| {
			role: "user";
			content: string;
			timestamp: number;
	  }
	| {
			role: "assistant";
			content: string;
			timestamp: number;
			toolCalls?: ToolCallRecord[];
	  }
	| {
			role: "tool";
			content: string;
			timestamp: number;
			toolCallId: string;
			name: string;
			error?: string;
	  }
	| {
			role: "system";
			content: string;
			timestamp: number;
	  };

export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: SessionMessage[];
  metadata: SessionMetadata;
}

interface SessionMetadata {
  modelRef?: string;
  pipelineCount: number;
  agentCount: number;
}

export class SessionManager {
  private session: Session;
  private persistPath: string;
  private persistInterval: ReturnType<typeof setInterval> | null = null;
  /** User-selected provider/model override for this session (via /provider). */
  private _activeModel: { provider: string; model: string } | null = null;

  constructor(sessionId?: string) {
    this.session = {
      id: sessionId ?? generateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      metadata: { pipelineCount: 0, agentCount: 0 },
    };
    this.persistPath = resolveSessionPath(this.session.id);
  }

  get id(): string {
    return this.session.id;
  }

  get messages(): SessionMessage[] {
    return this.session.messages;
  }

  get messageCount(): number {
    return this.session.messages.length;
  }

  get pipelineCount(): number {
    return this.session.metadata.pipelineCount;
  }

  get agentCount(): number {
    return this.session.metadata.agentCount;
  }

  /** The active provider/model override, or null to use default routing. */
  get activeModel(): { provider: string; model: string } | null {
    return this._activeModel;
  }

  setActiveModel(model: { provider: string; model: string } | null): void {
    this._activeModel = model;
    this.session.metadata.modelRef = model
      ? `${model.provider}/${model.model}`
      : undefined;
  }

  /**
   * Load a previous session from disk (if exists), otherwise returns null.
   */
  static load(sessionId: string): Session | null {
    const path = resolveSessionPath(sessionId);
    try {
      const raw = readFileSync(path, 'utf-8');
      return JSON.parse(raw) as Session;
    } catch {
      return null;
    }
  }

  /**
   * List all saved session IDs.
   */
  static listSessions(): Array<{ id: string; createdAt: number; messageCount: number }> {
    const sessionsDir = getSessionsDir();
    try {
      const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
      return files.map(f => {
        try {
          const raw = readFileSync(join(sessionsDir, f), 'utf-8');
          const s = JSON.parse(raw) as Session;
          return { id: s.id, createdAt: s.createdAt, messageCount: s.messages.length };
        } catch {
          return null;
        }
      }).filter(Boolean) as Array<{ id: string; createdAt: number; messageCount: number }>;
    } catch {
      return [];
    }
  }

  /**
   * Add a user message.
   */
  addUser(content: string): void {
    this.add({ role: "user", content, timestamp: Date.now() });
  }

  /**
   * Add an assistant text-only message (no tool calls). Equivalent to
   * the pre-D.3 behavior — kept for command results and simple replies.
   */
  addAssistant(content: string): void {
    this.add({ role: "assistant", content, timestamp: Date.now() });
  }

  /**
   * Add an assistant turn that may include `toolCalls`. If `toolCalls`
   * is non-empty, this represents the model requesting tools; the
   * matching `tool` turns should be added afterwards with
   * `addToolResult` so the session can be replayed (and resumed) as
   * a coherent ReAct loop.
   */
  addAssistantTurn(content: string, toolCalls: ToolCallRecord[]): void {
		const msg: SessionMessage =
			toolCalls.length > 0
				? { role: "assistant", content, timestamp: Date.now(), toolCalls }
				: { role: "assistant", content, timestamp: Date.now() };
		this.add(msg);
  }

  /**
   * Add a tool-result turn linked to a specific tool_call by id.
   */
  addToolResult(
    toolCallId: string,
    name: string,
    content: string,
    error?: string,
  ): void {
    this.add({
      role: "tool",
      content,
      timestamp: Date.now(),
      toolCallId,
      name,
      error,
    });
  }

  /**
   * Add a system message (internal, not shown to user).
   */
  addSystem(content: string): void {
    this.add({ role: "system", content, timestamp: Date.now() });
  }

  /**
   * Increment pipeline counter.
   */
  incPipelines(): void {
    this.session.metadata.pipelineCount++;
  }

  /**
   * Increment agent call counter.
   */
  incAgents(): void {
    this.session.metadata.agentCount++;
  }

  /**
   * Set the model being used in this session.
   */
  setModelRef(modelRef: string): void {
    this.session.metadata.modelRef = modelRef;
  }

  /**
   * Start auto-persist (every 30s).
   */
  startAutoPersist(): void {
    this.persistInterval = setInterval(() => {
      this.persist();
    }, 30_000);
  }

  /**
   * Persist session to disk immediately.
   */
  persist(): void {
    this.session.updatedAt = Date.now();
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify(this.session, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[SessionManager] Failed to persist:', err);
    }
  }

  /**
   * Stop auto-persist and write final state.
   */
  close(): void {
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persistInterval = null;
    }
    this.persist();
  }

  /**
   * Get a formatted log of the last N messages for context injection.
   */
  getRecentMessages(n = 10): SessionMessage[] {
    return this.session.messages.slice(-n);
  }

  /**
   * Clear messages but keep session metadata.
   */
  clearMessages(): void {
    this.session.messages = [];
  }

  add(msg: SessionMessage): void {
    this.session.messages.push(msg);
    // Persist after every 5 messages
    if (this.session.messages.length % 5 === 0) {
      this.persist();
    }
  }

  /**
   * Reconstruct the conversation as a sequence of LLMMessage so it can
   * be re-injected into a fresh `runAgent` call (the `/resume` path).
   * System messages from this session are skipped — the agent's own
   * dynamic system prompt (built by context-builder) takes their place.
   */
  getHistoryAsLLMMessages(): Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    toolCalls?: Array<{
      id?: string;
      name: string;
      arguments: Record<string, unknown>;
    }>;
    toolCallId?: string;
  }> {
    const out: Array<{
      role: "user" | "assistant" | "tool";
      content: string;
      toolCalls?: Array<{
        id?: string;
        name: string;
        arguments: Record<string, unknown>;
      }>;
      toolCallId?: string;
    }> = [];
    for (const m of this.session.messages) {
      if (m.role === "user") {
        out.push({ role: "user", content: m.content });
      } else if (m.role === "assistant") {
        out.push({
          role: "assistant",
          content: m.content,
          toolCalls: m.toolCalls?.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
        });
      } else if (m.role === "tool") {
        out.push({
          role: "tool",
          content: m.content,
          toolCallId: m.toolCallId,
        });
      }
      // system messages are intentionally skipped
    }
    return out;
  }

  /**
   * Replace the in-memory state of this session with `other` (typically
   * loaded from disk). Used by `/resume <id>` so the next chat turn
   * continues the previous conversation.
   */
  replaceWith(other: Session): void {
    this.session = other;
    this.persistPath = resolveSessionPath(other.id);
  }
}

// === Helpers ===

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

function generateId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getSessionsDir(): string {
  return join(homedir(), '.miura', 'sessions');
}

function resolveSessionPath(sessionId: string): string {
  return join(getSessionsDir(), `${sessionId}.json`);
}