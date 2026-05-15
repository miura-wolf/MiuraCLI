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
import { StructuredLogger, MetricsCollector } from './core/observability.js';
import { getRuntimeConfig } from './config.js';

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
import { OpenRouterAdapter } from './plugins/adapters/openrouter/index.js';
import { GroqAdapter } from './plugins/adapters/groq/index.js';
import { GoogleAIAdapter } from './plugins/adapters/google-ai/index.js';
import { CerebrasAdapter } from './plugins/adapters/cerebras/index.js';
import { ZyphraAdapter } from './plugins/adapters/zyphra/index.js';
import { CohereAdapter } from './plugins/adapters/cohere/index.js';
import { SambaNovaAdapter } from './plugins/adapters/sambanova/index.js';
import { MistralAdapter } from './plugins/adapters/mistral/index.js';

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
  ModelRef,
  ModelRoutingConfig,
  PaceConfig,
  PipelineDefinition,
  PipelineResult,
  PipelineMetrics,
  Plugin,
  PluginType,
  ToolCall,
  ToolResult,
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
  private logger: StructuredLogger;
  private metrics: MetricsCollector;
  private runtime = getRuntimeConfig();
  private initialized = false;

  private agentPlugins = new Map<AgentRole, Plugin & { getConfig(): AgentConfig; getSystemPrompt(): string }>();
  private adapterMap = new Map<string, LLMAdapter>();

  constructor(private config: MiuraSwarmConfig = {}) {
    this.eventBus = new EventBus();
    this.pluginHost = new PluginHost(this.eventBus);
    this.modelRouter = new ModelRouter(config.modelRouting);
    this.taskScheduler = new TaskScheduler(this.eventBus, { ...DEFAULT_PACE, ...config.pace });
    this.stateStore = new SqliteStateStore(config.dbPath || this.runtime.stateDbPath);
    this.agentBus = new AgentBus(this.eventBus);
    this.logger = new StructuredLogger();
    this.metrics = new MetricsCollector();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.stateStore.initialize();
    await this.recoverInterruptedPipelines();
    this.pluginHost.setStateStore(this.stateStore);

    // Register agent plugins
    const agents: Plugin[] = [
      new PlannerAgent(), new WorkerAgent(), new ResearcherAgent(), new ReviewerAgent(),
      new ScoutAgent(), new ContextBuilderAgent(), new OracleAgent(), new DelegateAgent(),
    ];
    for (const agent of agents) {
      await this.pluginHost.register(agent);
      const ap = agent as Plugin & { getConfig(): AgentConfig; getSystemPrompt(): string };
      this.agentPlugins.set(ap.getConfig().role, ap);
    }

    // Register adapters — only if API key exists
    const adapterDefs: Array<{ provider: string; ctor: new (key?: string) => LLMAdapter; envKey: string }> = [
      { provider: 'nvidia-nim', ctor: NvidiaNimAdapter,  envKey: 'NVIDIA_NIM_API_KEY' },
      { provider: 'openrouter', ctor: OpenRouterAdapter,  envKey: 'OPENROUTER_API_KEY' },
      { provider: 'groq',       ctor: GroqAdapter,        envKey: 'GROQ_API_KEY' },
      { provider: 'google',     ctor: GoogleAIAdapter,    envKey: 'GOOGLE_AI_API_KEY' },
      { provider: 'cerebras',   ctor: CerebrasAdapter,    envKey: 'CEREBRAS_API_KEY' },
      { provider: 'zyphra',     ctor: ZyphraAdapter,      envKey: 'ZYPHRA_API_KEY' },
      { provider: 'cohere',     ctor: CohereAdapter,      envKey: 'COHERE_API_KEY' },
      { provider: 'sambanova',  ctor: SambaNovaAdapter,   envKey: 'SAMBANOVA_API_KEY' },
      { provider: 'mistral',    ctor: MistralAdapter,     envKey: 'MISTRAL_API_KEY' },
      { provider: 'claude',     ctor: ClaudeAdapter,      envKey: 'CLAUDE_API_KEY' },
      { provider: 'ollama',     ctor: OllamaAdapter,      envKey: 'OLLAMA_BASE_URL' },
    ];

    for (const { provider, ctor, envKey } of adapterDefs) {
      const apiKey = process.env[envKey];
      const hasKey = provider === 'ollama' ? true : Boolean(apiKey);
      if (!hasKey) continue;

      try {
        const adapter = new ctor(apiKey);
        await this.pluginHost.register(adapter);
        this.adapterMap.set(provider, adapter);
      } catch {
        // Skip adapters that fail to initialize
      }
    }

    await this.pluginHost.register(new EngramReaderPlugin());

    for (const plugin of (this.config.plugins ?? [])) {
      await this.pluginHost.register(plugin);
    }

    // Register tool plugin
    const fileToolPlugin = (await import('./plugins/tools/file-tool.js')).default;
    await this.pluginHost.register(fileToolPlugin);

    this.eventBus.on('agent.spawned', (p: any) => {
      this.logger.log({ timestamp: Date.now(), level: 'info', event: 'agent.spawned', metadata: p });
      this.stateStore.appendEvent({ id: 0, type: 'agent.spawned', payload: JSON.stringify(p), timestamp: Date.now() });
    });
    this.eventBus.on('agent.completed', (p: any) => {
      this.logger.log({ timestamp: Date.now(), level: 'info', event: 'agent.completed', metadata: p });
      this.stateStore.appendEvent({ id: 0, type: 'agent.completed', payload: JSON.stringify(p), timestamp: Date.now() });
    });
    this.eventBus.on('agent.failed', (p: any) => {
      this.logger.log({ timestamp: Date.now(), level: 'error', event: 'agent.failed', error: p?.error, metadata: p });
      this.stateStore.appendEvent({ id: 0, type: 'agent.failed', payload: JSON.stringify(p), timestamp: Date.now() });
    });

    this.initialized = true;
  }

  async runAgent(role: AgentRole, input: string, forcedModel?: ModelRef): Promise<AgentResult> {
    this.ensureInitialized();
    const agentPlugin = this.agentPlugins.get(role);
    if (!agentPlugin) throw new Error(`No agent registered for role: ${role}`);

    const agentConfig = agentPlugin.getConfig();
    const model = forcedModel ?? this.modelRouter.resolve(role);
    const registry = this.pluginHost.getToolRegistry();

    const result = await this.agentBus.spawn(role, agentConfig, async (cfg: AgentConfig, sessionId: string) => {
      const startTime = Date.now();

      // Build initial conversation
      const chat: LLMMessage[] = [
        { role: 'system', content: agentPlugin.getSystemPrompt() },
        { role: 'user', content: input },
      ];

      // ReAct loop with full tracking
      let iteration = 0;
      const maxIterations = 25;
      const maxTotalTokens = cfg.maxTokens ?? 50000; // Budget total de tokens
      let totalTokens = 0;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let lastOutput = '';
      let lastToolCalls: ToolCall[] = [];
      let lastToolResults: ToolResult[] = [];

      while (iteration < maxIterations) {
        // Check total token budget
        if (totalTokens > maxTotalTokens) {
          throw new Error(`Token budget exceeded: ${totalTokens}/${maxTotalTokens}`);
        }

        // Resolve model for this iteration (may change if escalation)
        const currentModel = forcedModel ?? this.modelRouter.resolve(role);
        const adapter = this.resolveAdapter(currentModel.provider);

        // Send messages + available tools
        const llmResult = await adapter.prompt(currentModel, chat, {
          maxTokens: cfg.maxTokens,
          tools: registry.list(),
        });

        // Accumulate token usage
        totalPromptTokens += llmResult.tokenUsage.prompt;
        totalCompletionTokens += llmResult.tokenUsage.completion;
        totalTokens = totalPromptTokens + totalCompletionTokens;

        // If no tool calls, we're done
        if (!llmResult.toolCalls || llmResult.toolCalls.length === 0) {
          lastOutput = llmResult.output;
          break;
        }

        // Execute all tool calls with error handling
        const toolResults = await registry.execute(llmResult.toolCalls);
        lastToolCalls = [...llmResult.toolCalls];
        lastToolResults = toolResults;

        // Emit tool call events for streaming
        toolResults.forEach(t => {
          this.eventBus.emit('agent.toolCalled' as any, {
            agentId: sessionId,
            name: t.name,
            output: t.output,
            error: t.error,
            durationMs: t.durationMs,
          });
        });

        // Append assistant + tool outputs back to conversation
        chat.push({ role: 'assistant', content: llmResult.output });
        toolResults.forEach(t => {
          chat.push({
            role: 'tool',
            content: t.error
              ? `> **${t.name}** ❌ Error: ${t.output}`
              : `> **${t.name}**\n${t.output}`,
          });
        });

        iteration++;
      }

      // Check if we hit max iterations without completing
      if (iteration >= maxIterations) {
        throw new Error(`ReAct loop exceeded max iterations (${maxIterations}). Possible infinite loop.`);
      }

      const totalDurationMs = Date.now() - startTime;

      // Return final AgentResult with full tracking
      return {
        agentId: sessionId,
        output: lastOutput,
        exitCode: 0 as const,
        durationMs: totalDurationMs,
        tokenUsage: { prompt: totalPromptTokens, completion: totalCompletionTokens },
        model,
        toolCalls: lastToolCalls,
        toolResults: lastToolResults,
      };
    });

    if (result.exitCode !== 0) this.modelRouter.reportFailure(role, model);
    return result;
  }

  async runPipeline(input: string, definition: PipelineDefinition): Promise<PipelineResult> {
    return this.runPipelineInternal(input, definition);
  }

  async resumePipeline(pipelineId: string): Promise<PipelineResult> {
    this.ensureInitialized();
    const progress = await this.stateStore.getPipelineProgress(pipelineId);
    if (!progress) throw new Error(`Pipeline progress not found for ${pipelineId}`);
    return this.runPipelineInternal(progress.input, progress.definition, progress);
  }

  async getLastPipelineMetrics(pipelineId: string): Promise<PipelineMetrics | null> {
    return this.metrics.getMetric(pipelineId);
  }

  private async runPipelineInternal(
    input: string,
    definition: PipelineDefinition,
    progress?: import('./core/types.js').PipelineProgress,
  ): Promise<PipelineResult> {
    this.ensureInitialized();
    const pipeline = new Pipeline(this.eventBus);
    const pipelineId = progress?.id;
    const start = Date.now();
    const id = pipelineId ?? `pipeline-${Date.now()}`;
    this.metrics.startPipeline(id);

    const result = await pipeline.run({
      input,
      definition,
      pipelineId,
      resumeFrom: progress ? {
        iteration: progress.iteration,
        history: progress.history,
        stages: progress.stages,
      } : undefined,
      onCheckpoint: async (checkpoint) => {
        this.logger.log({
          timestamp: Date.now(),
          level: 'info',
          event: 'pipeline.checkpoint',
          pipelineId: checkpoint.pipelineId,
          metadata: { iteration: checkpoint.iteration, status: checkpoint.status, stages: checkpoint.stages.length },
        });
        this.metrics.recordStage(checkpoint.pipelineId);
        if (checkpoint.iteration > 1) this.metrics.recordRetry(checkpoint.pipelineId);
        const existing = await this.stateStore.getPipelineProgress(checkpoint.pipelineId);
        const base = {
          id: checkpoint.pipelineId,
          taskId: checkpoint.pipelineId,
          input,
          definition,
          stages: checkpoint.stages,
          iteration: checkpoint.iteration,
          status: checkpoint.status,
          startedAt: existing?.startedAt ?? Date.now(),
          updatedAt: Date.now(),
          history: checkpoint.history,
        };
        if (!existing) await this.stateStore.createPipelineProgress(base);
        else await this.stateStore.updatePipelineProgress(checkpoint.pipelineId, base);
      },
      agentBus: this.agentBus,
      modelRouter: this.modelRouter,
      executeAgent: (role, model, agentInput) => this.runAgent(role, agentInput, model),
    });
    const latencyMs = Date.now() - start;
    const metric = this.metrics.finishPipeline(result.pipelineId, true, result.iterations, latencyMs);
    this.logger.log({
      timestamp: Date.now(),
      level: 'info',
      event: 'pipeline.completed',
      pipelineId: result.pipelineId,
      metadata: { latencyMs, iterations: result.iterations, metrics: metric },
    });
    return result;
  }

  getStatus(): MiuraSwarmStatus {
    this.ensureInitialized();
    return {
      agents: Array.from(this.agentPlugins.entries()).map(([role, p]) => ({
        role, id: p.getConfig().id, active: true,
      })),
      tasks: { pending: 0, active: 0, completed: 0, failed: 0 },
      plugins: this.pluginHost.getAllPlugins().map(p => ({
        id: p.manifest.id, type: p.manifest.type, active: p.status === 'active',
      })),
      modelRouting: DEFAULT_ROUTING,
    };
  }

  getConfig(): ModelRoutingConfig { return DEFAULT_ROUTING; }
  getEventBus(): EventBus { return this.eventBus; }
  getPluginHost(): PluginHost { return this.pluginHost; }
  getAdapters(): Map<string, LLMAdapter> { return this.adapterMap; }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    for (const p of this.pluginHost.getAllPlugins()) {
      if (p.status === 'active') await this.pluginHost.unregister(p.manifest.id);
    }
    await this.stateStore.close();
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) throw new Error('MiuraSwarm not initialized. Call initialize() first.');
  }

  private resolveAdapter(provider: string): LLMAdapter {
    const adapter = this.adapterMap.get(provider);
    if (adapter) return adapter;

    const adapters = this.pluginHost.queryByType('adapter' as PluginType);
    for (const plugin of adapters) {
      const llm = plugin as unknown as LLMAdapter;
      if (llm.supports?.({ provider: provider as any, model: '' } as ModelRef)) {
        this.adapterMap.set(provider, llm);
        return llm;
      }
    }

    throw new Error(`No adapter for "${provider}". Available: ${Array.from(this.adapterMap.keys()).join(', ') || 'none'}`);
  }

  private async recoverInterruptedPipelines(): Promise<void> {
    const interrupted = await this.stateStore.listInterruptedPipelines(100);
    for (const pipeline of interrupted) {
      await this.stateStore.updatePipelineProgress(pipeline.id, {
        status: 'interrupted',
        updatedAt: Date.now(),
      });
      this.logger.log({
        timestamp: Date.now(),
        level: 'warn',
        event: 'pipeline.recovered_as_interrupted',
        pipelineId: pipeline.id,
      });
    }
  }
}

// Re-exports
export { EventBus } from './core/event-bus.js';
export { AgentBus } from './core/agent-bus.js';
export { TaskScheduler } from './core/task-scheduler.js';
export { Pipeline } from './core/pipeline.js';
export { ModelRouter } from './core/model-router.js';
export { StuckDetector } from './core/stuck-detector.js';
export { PluginHost } from './core/plugin-host.js';
export { SqliteStateStore } from './plugins/memory/sqlite-state/index.js';
export { NvidiaNimAdapter } from './plugins/adapters/nvidia-nim/index.js';
export { OpenRouterAdapter } from './plugins/adapters/openrouter/index.js';
export { GroqAdapter } from './plugins/adapters/groq/index.js';
export { GoogleAIAdapter } from './plugins/adapters/google-ai/index.js';
export { CerebrasAdapter } from './plugins/adapters/cerebras/index.js';
export { ZyphraAdapter } from './plugins/adapters/zyphra/index.js';
export { CohereAdapter } from './plugins/adapters/cohere/index.js';
export { SambaNovaAdapter } from './plugins/adapters/sambanova/index.js';
export { MistralAdapter } from './plugins/adapters/mistral/index.js';
export { ClaudeAdapter } from './plugins/adapters/claude/index.js';
export { OllamaAdapter } from './plugins/adapters/ollama/index.js';
export { loadEnv } from './env.js';
export * from './core/types.js';
