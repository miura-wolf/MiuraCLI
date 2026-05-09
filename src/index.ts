/**
 * MiuraSwarm — Autonomous AI Agent Orchestrator
 *
 * Main entry point. Wires EventBus, PluginHost, AgentBus,
 * TaskScheduler, Pipeline, and ModelRouter together.
 */

import { EventBus } from './core/event-bus.js';
import { PluginHost } from './core/plugin-host.js';
import { AgentBus } from './core/agent-bus.js';
import { TaskScheduler, DEFAULT_PACE } from './core/task-scheduler.js';
import { Pipeline } from './core/pipeline.js';
import { ModelRouter, DEFAULT_ROUTING } from './core/model-router.js';
import { StuckDetector } from './core/stuck-detector.js';

// Agent plugins
import { PlannerAgent } from './plugins/agents/planner/index.js';
import { WorkerAgent } from './plugins/agents/worker/index.js';
import { ResearcherAgent } from './plugins/agents/researcher/index.js';
import { ReviewerAgent } from './plugins/agents/reviewer/index.js';
import { ScoutAgent } from './plugins/agents/scout/index.js';
import { ContextBuilderAgent } from './plugins/agents/context-builder/index.js';
import { OracleAgent } from './plugins/agents/oracle/index.js';
import { DelegateAgent } from './plugins/agents/delegate/index.js';

// Adapter plugins
import { ClaudeAdapter } from './plugins/adapters/claude/index.js';
import { NvidiaNimAdapter } from './plugins/adapters/nvidia-nim/index.js';
import { OllamaAdapter } from './plugins/adapters/ollama/index.js';

// State store plugin
import { SqliteStateStore } from './plugins/memory/sqlite-state/index.js';

// Integration plugins
import { EngramReaderPlugin } from './plugins/integrations/engram-reader/index.js';

import type {
  AgentRole,
  AgentConfig,
  AgentResult,
  LLMAdapter,
  LLMMessage,
  LLMOptions,
  LLMResult,
  ModelRef,
  ModelRoutingConfig,
  PaceConfig,
  PipelineDefinition,
  PipelineResult,
  Plugin,
  PluginType,
} from './core/types.js';

export interface MiuraSwarmConfig {
  modelRouting?: Partial<ModelRoutingConfig>;
  pace?: Partial<PaceConfig>;
  dbPath?: string;
  plugins?: Plugin[];
}

export interface MiuraSwarmStatus {
  agents: { role: AgentRole; id: string; active: boolean }[];
  tasks: { pending: number; active: number; completed: number; failed: number };
  plugins: { id: string; type: string; active: boolean }[];
  modelRouting: ModelRoutingConfig;
}

export class MiuraSwarm {
  private eventBus: EventBus;
  private pluginHost: PluginHost;
  private agentBus: AgentBus;
  private taskScheduler: TaskScheduler;
  private modelRouter: ModelRouter;
  private stateStore: SqliteStateStore;
  private initialized = false;

  // Agent registry — maps role to agent plugin
  private agentPlugins = new Map<AgentRole, Plugin & { getConfig(): AgentConfig; getSystemPrompt(): string }>();

  // Adapter registry — maps provider to LLMAdapter
  private adapterMap = new Map<string, LLMAdapter>();

  constructor(private config: MiuraSwarmConfig = {}) {
    this.eventBus = new EventBus();
    this.pluginHost = new PluginHost(this.eventBus);
    this.modelRouter = new ModelRouter(config.modelRouting);
    this.taskScheduler = new TaskScheduler(this.eventBus, { ...DEFAULT_PACE, ...config.pace });
    this.stateStore = new SqliteStateStore(config.dbPath || '.miura/state.db');
    this.agentBus = new AgentBus(this.eventBus);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize state store
    await this.stateStore.initialize();
    this.pluginHost.setStateStore(this.stateStore);

    // Register built-in agent plugins
    const agents: Plugin[] = [
      new PlannerAgent(),
      new WorkerAgent(),
      new ResearcherAgent(),
      new ReviewerAgent(),
      new ScoutAgent(),
      new ContextBuilderAgent(),
      new OracleAgent(),
      new DelegateAgent(),
    ];

    for (const agent of agents) {
      await this.pluginHost.register(agent);
      const agentPlugin = agent as Plugin & { getConfig(): AgentConfig; getSystemPrompt(): string };
      this.agentPlugins.set(agentPlugin.getConfig().role, agentPlugin);
    }

    // Register adapter plugins and index by provider
    const adapters: LLMAdapter[] = [
      new ClaudeAdapter(),
      new NvidiaNimAdapter(),
      new OllamaAdapter(),
    ];

    for (const adapter of adapters) {
      await this.pluginHost.register(adapter);
      // Index the adapter by provider — extract from manifest id
      const provider = adapter.manifest.id.replace('adapter-', '');
      this.adapterMap.set(provider, adapter);
    }

    // Register engram reader
    await this.pluginHost.register(new EngramReaderPlugin());

    // Register user-provided plugins
    for (const plugin of (this.config.plugins ?? [])) {
      await this.pluginHost.register(plugin);
    }

    // Wire up event logging to state store
    this.eventBus.on('agent.spawned', (p: any) => {
      this.stateStore.appendEvent({
        id: 0,
        type: 'agent.spawned',
        payload: JSON.stringify(p),
        timestamp: Date.now(),
      });
    });
    this.eventBus.on('agent.completed', (p: any) => {
      this.stateStore.appendEvent({
        id: 0,
        type: 'agent.completed',
        payload: JSON.stringify(p),
        timestamp: Date.now(),
      });
    });
    this.eventBus.on('agent.failed', (p: any) => {
      this.stateStore.appendEvent({
        id: 0,
        type: 'agent.failed',
        payload: JSON.stringify(p),
        timestamp: Date.now(),
      });
    });

    this.initialized = true;
  }

  /**
   * Run a single agent by role with the given input.
   */
  async runAgent(role: AgentRole, input: string): Promise<AgentResult> {
    this.ensureInitialized();

    const agentPlugin = this.agentPlugins.get(role);
    if (!agentPlugin) {
      throw new Error(`No agent registered for role: ${role}`);
    }

    const agentConfig = agentPlugin.getConfig();
    const model = this.modelRouter.resolve(role);

    const result = await this.agentBus.spawn(role, agentConfig, async (cfg: AgentConfig) => {
      const systemPrompt = agentPlugin.getSystemPrompt();
      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ];
      const options: LLMOptions = {
        maxTokens: cfg.maxTokens,
      };

      const adapter = this.resolveAdapter(model.provider);
      const adapterResult = await adapter.prompt(model, messages, options);

      return {
        agentId: '',
        output: adapterResult.output,
        exitCode: 0 as const,
        durationMs: adapterResult.durationMs,
        tokenUsage: adapterResult.tokenUsage,
        model,
      };
    });

    // Report failures to model router for escalation
    if (result.exitCode !== 0) {
      this.modelRouter.reportFailure(role, model);
    }

    return result;
  }

  /**
   * Run a pipeline with the given stages.
   */
  async runPipeline(input: string, definition: PipelineDefinition): Promise<PipelineResult> {
    this.ensureInitialized();

    const pipeline = new Pipeline(this.eventBus);

    const executeAgent = async (role: AgentRole, model: ModelRef, agentInput: string): Promise<AgentResult> => {
      return this.runAgent(role, agentInput);
    };

    return pipeline.run({
      input,
      definition,
      agentBus: this.agentBus,
      modelRouter: this.modelRouter,
      executeAgent,
    });
  }

  /**
   * Get current system status.
   */
  getStatus(): MiuraSwarmStatus {
    this.ensureInitialized();

    const agents = Array.from(this.agentPlugins.entries()).map(([role, plugin]) => ({
      role,
      id: plugin.getConfig().id,
      active: true,
    }));

    const allPlugins = this.pluginHost.getAllPlugins();

    return {
      agents,
      tasks: { pending: 0, active: 0, completed: 0, failed: 0 },
      plugins: allPlugins.map((p) => ({
        id: p.manifest.id,
        type: p.manifest.type,
        active: p.status === 'active',
      })),
      modelRouting: DEFAULT_ROUTING,
    };
  }

  /**
   * Get current model routing config.
   */
  getConfig(): ModelRoutingConfig {
    return DEFAULT_ROUTING;
  }

  /**
   * Access the event bus for custom event wiring.
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Access the plugin host for runtime plugin management.
   */
  getPluginHost(): PluginHost {
    return this.pluginHost;
  }

  /**
   * Gracefully shut down all systems.
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    // Deactivate all plugins
    const allPlugins = this.pluginHost.getAllPlugins();
    for (const p of allPlugins) {
      if (p.status === 'active') {
        await this.pluginHost.unregister(p.manifest.id);
      }
    }

    await this.stateStore.close();
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('MiuraSwarm not initialized. Call initialize() first.');
    }
  }

  private resolveAdapter(provider: string): LLMAdapter {
    const adapter = this.adapterMap.get(provider);
    if (adapter) return adapter;

    // Try plugin host queryByType
    const adapters = this.pluginHost.queryByType('adapter' as PluginType);
    for (const plugin of adapters) {
      const llmAdapter = plugin as unknown as LLMAdapter;
      if (llmAdapter.supports?.({ provider, model: '' } as ModelRef)) {
        this.adapterMap.set(provider, llmAdapter);
        return llmAdapter;
      }
    }

    throw new Error(
      `No adapter registered for provider: ${provider}. ` +
      `Available: ${Array.from(this.adapterMap.keys()).join(', ') || 'none'}`
    );
  }
}

// Re-export core modules for advanced usage
export { EventBus } from './core/event-bus.js';
export { AgentBus } from './core/agent-bus.js';
export { TaskScheduler } from './core/task-scheduler.js';
export { Pipeline } from './core/pipeline.js';
export { ModelRouter } from './core/model-router.js';
export { StuckDetector } from './core/stuck-detector.js';
export { PluginHost } from './core/plugin-host.js';
export { SqliteStateStore } from './plugins/memory/sqlite-state/index.js';
export { ClaudeAdapter } from './plugins/adapters/claude/index.js';
export { NvidiaNimAdapter } from './plugins/adapters/nvidia-nim/index.js';
export { OllamaAdapter } from './plugins/adapters/ollama/index.js';
export * from './core/types.js';
