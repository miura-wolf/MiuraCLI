/**
 * Session Manager — Persists REPL session history across restarts.
 * Uses JSON lines format for append-friendly log storage.
 */

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

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
    this.add({ role: 'user', content, timestamp: Date.now() });
  }

  /**
   * Add an assistant (agent) message.
   */
  addAssistant(content: string): void {
    this.add({ role: 'assistant', content, timestamp: Date.now() });
  }

  /**
   * Add a system message (internal, not shown to user).
   */
  addSystem(content: string): void {
    this.add({ role: 'system', content, timestamp: Date.now() });
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