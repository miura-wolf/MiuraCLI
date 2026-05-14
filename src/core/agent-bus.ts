import type {
  AgentConfig,
  AgentResult,
  AgentRole,
  AgentSession,
  AgentStatus,
  ModelRef,
} from './types.js';

import { EventBus } from './event-bus.js';
import { randomUUID } from 'node:crypto';

interface ActiveAgent {
  session: AgentSession;
  config: AgentConfig;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  resolveResult?: (result: AgentResult) => void;
  rejectResult?: (error: Error) => void;
}

export class AgentBus {
  private agents = new Map<string, ActiveAgent>();
  private eventBus: EventBus;
  private defaultHeartbeatMs = 30_000;
  private defaultGraceMs = 5_000;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  async spawn(
    role: AgentRole,
    config: AgentConfig,
    execute: (config: AgentConfig, sessionId: string) => Promise<AgentResult>,
  ): Promise<AgentResult> {
    const sessionId = randomUUID();
    const session: AgentSession = {
      id: sessionId,
      agentRole: role,
      model: config.defaultModel,
      status: 'spawning',
      startedAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    const active: ActiveAgent = { session, config };
    this.agents.set(sessionId, active);

    // Setup heartbeat
    const heartbeatMs = config.heartbeatIntervalMs ?? this.defaultHeartbeatMs;
    active.heartbeatTimer = setInterval(() => {
      active.session.lastHeartbeat = Date.now();
    }, heartbeatMs);

    // Setup timeout
    if (config.timeoutMs > 0) {
      active.timeoutTimer = setTimeout(() => {
        this.handleTimeout(sessionId);
      }, config.timeoutMs);
    }

    // Emit spawned event
    this.eventBus.emit('agent.spawned', { agentId: sessionId, role, model: config.defaultModel });

    // Transition to running
    session.status = 'running';

    try {
      const result = await execute(config, sessionId);

      // Clear timers
      this.clearTimers(sessionId);

      // Update session
      session.status = 'completed';
      session.result = result;

      // Emit completed
      this.eventBus.emit('agent.completed', { agentId: sessionId, result });

      return result;
    } catch (error) {
      this.clearTimers(sessionId);
      const errorMessage = error instanceof Error ? error.message : String(error);
      session.status = 'failed';
      this.eventBus.emit('agent.failed', { agentId: sessionId, error: errorMessage });
      throw error;
    } finally {
      // Cleanup after a delay to allow result retrieval
      setTimeout(() => {
        this.agents.delete(sessionId);
      }, 60_000);
    }
  }

  /**
   * Spawn multiple agents concurrently with concurrency control.
   * Supports cancel-on-failure: if one agent fails, others are cancelled.
   */
  async spawnBatch(
    batchConfigs: Array<{ role: AgentRole; config: AgentConfig }>,
    execute: (config: AgentConfig, sessionId: string) => Promise<AgentResult>,
    options?: {
      maxConcurrent?: number;
      cancelOnFailure?: boolean;
    },
  ): Promise<AgentResult[]> {
    const maxConcurrent = options?.maxConcurrent ?? 10;
    const cancelOnFailure = options?.cancelOnFailure ?? false;

    const results: AgentResult[] = [];
    const errors: Array<{ role: AgentRole; error: Error }> = [];
    const sessionIds: string[] = [];

    // Concurrency limiter using a semaphore pattern
    const semaphore = {
      count: maxConcurrent,
      wait: async () => {
        while (semaphore.count === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        semaphore.count--;
      },
      release: () => {
        semaphore.count++;
      },
    };

    // Create promises for all agents
    const promises = batchConfigs.map(async (item) => {
      await semaphore.wait();
      const sessionId = randomUUID();
      sessionIds.push(sessionId);

      try {
        const result = await this.spawn(item.role, item.config, execute);
        results.push(result);
        return result;
      } catch (error) {
        errors.push({ role: item.role, error: error as Error });

        if (cancelOnFailure) {
          // Kill all other agents in the batch
          for (const id of sessionIds.filter((id) => id !== sessionId)) {
            this.kill(id);
          }
          throw error;
        }

        return null;
      } finally {
        semaphore.release();
      }
    });

    // Wait for all to complete
    await Promise.all(promises);

    // If there were errors and cancelOnFailure is true, throw the first error
    if (errors.length > 0 && cancelOnFailure) {
      throw errors[0].error;
    }

    return results;
  }

  kill(agentId: string, graceMs?: number): void {
    const active = this.agents.get(agentId);
    if (!active) return;

    const grace = graceMs ?? this.defaultGraceMs;

    // Mark as killed after grace period
    setTimeout(() => {
      if (this.agents.has(agentId)) {
        this.clearTimers(agentId);
        active.session.status = 'killed';
        this.agents.delete(agentId);
      }
    }, grace);
  }

  /**
   * Kill all agents in a batch, used for cancel-on-failure
   */
  killBatch(agentIds: string[], graceMs?: number): void {
    for (const agentId of agentIds) {
      this.kill(agentId, graceMs);
    }
  }

  getSession(agentId: string): AgentSession | null {
    return this.agents.get(agentId)?.session ?? null;
  }

  getActiveAgents(): AgentSession[] {
    return Array.from(this.agents.values()).map((a) => a.session);
  }

  getAgentsByRole(role: AgentRole): AgentSession[] {
    return Array.from(this.agents.values())
      .filter((a) => a.session.agentRole === role)
      .map((a) => a.session);
  }

  private handleTimeout(agentId: string): void {
    const active = this.agents.get(agentId);
    if (!active) return;

    active.session.status = 'timeout';
    this.clearTimers(agentId);
    this.eventBus.emit('agent.timeout', { agentId, timeoutMs: active.config.timeoutMs });
    this.agents.delete(agentId);
  }

  private clearTimers(agentId: string): void {
    const active = this.agents.get(agentId);
    if (!active) return;

    if (active.heartbeatTimer) {
      clearInterval(active.heartbeatTimer);
      active.heartbeatTimer = undefined;
    }

    if (active.timeoutTimer) {
      clearTimeout(active.timeoutTimer);
      active.timeoutTimer = undefined;
    }
  }
}
