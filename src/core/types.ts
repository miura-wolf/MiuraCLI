// MiuraSwarm Core Types
// All shared interfaces, types, and contracts

// Forward reference to ToolRegistry class (defined in tool-registry.ts)
import type { ToolRegistry } from './tool-registry.js';

// === Priority ===
export type Priority = 'high' | 'medium' | 'low';

// === Model References ===
export interface ModelRef {
  provider: 'claude' | 'nvidia-nim' | 'ollama' | 'openai' | 'openrouter' | 'groq' | 'google' | 'cerebras' | 'zyphra' | 'cohere' | 'sambanova' | 'mistral';
  model: string;
  maxTokens?: number;
  supportsToolUse?: boolean;
  supportsStreaming?: boolean;
}

// === Agent Types ===
export type AgentRole =
  | 'planner'
  | 'worker'
  | 'researcher'
  | 'reviewer'
  | 'scout'
  | 'context-builder'
  | 'oracle'
  | 'delegate';

export type AgentStatus =
  | 'spawning'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'killed';

export type AgentCapability =
  | 'code'
  | 'research'
  | 'review'
  | 'plan'
  | 'scout'
  | 'decision'
  | 'context'
  | 'delegate';

export interface AgentConfig {
  id: string;
  role: AgentRole;
  specialty: string;
  defaultModel: ModelRef;
  fallbackModels: ModelRef[];
  maxTokens: number;
  timeoutMs: number;
  capabilities: AgentCapability[];
  heartbeatIntervalMs?: number;
}

export interface AgentResult {
  agentId: string;
  output: string;
  exitCode: 0 | 1;
  durationMs: number;
  tokenUsage: { prompt: number; completion: number };
  model: ModelRef;
  artifacts?: Record<string, string>;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

// === Pipeline ===
export interface StageConfig {
  role: AgentRole;
  model?: ModelRef;
  timeoutMs?: number;
  skipWhen?: (ctx: PipelineContext) => boolean;
  maxRetries?: number;
  /**
   * Stages that can run in parallel with this one.
   * When specified, these stages will execute concurrently using Promise.all.
   */
  parallelWith?: AgentRole[];
}

export interface PipelineDefinition {
  stages: StageConfig[];
  maxIterations: number;
  stuckDetection?: StuckDetectionConfig;
}

export interface PipelineContext {
  input: string;
  stageResults: Map<string, AgentResult>;
  iteration: number;
  history: PipelineIterationRecord[];
}

export interface PipelineIterationRecord {
  iteration: number;
  stageResults: Map<string, AgentResult>;
  reviewerApproved: boolean;
}

export interface PipelineResult {
  pipelineId: string;
  stages: StageResult[];
  iterations: number;
  totalDurationMs: number;
  totalTokenUsage: { prompt: number; completion: number };
  stuckEvents: StuckSignal[];
  finalOutput: string;
}

export interface StageResult {
  role: AgentRole;
  status: 'completed' | 'skipped' | 'failed';
  result?: AgentResult;
  durationMs: number;
}

// === Stuck Detection ===
export type StuckType =
  | 'error_loop'
  | 'revision_loop'
  | 'output_repeat'
  | 'monologue';

export type StuckSuggestion =
  | 'ESCALATE_MODEL'
  | 'REFRAME_TASK'
  | 'CHANGE_APPROACH'
  | 'FORCE_REVIEW';

export interface StuckSignal {
  type: StuckType;
  count: number;
  threshold: number;
  suggestion: StuckSuggestion;
  details: string;
}

export interface StuckDetectionConfig {
  enabled: boolean;
  historySize: number;
  errorLoopThreshold: number;
  revisionLoopThreshold: number;
  outputRepeatThreshold: number;
  monologueThreshold: number;
}

// === Tasks ===
export type TaskStatus =
  | 'created'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed';

export interface Task {
  id: string;
  type: 'pipeline' | 'agent' | 'research';
  input: string;
  priority: Priority;
  status: TaskStatus;
  agentId?: string;
  pipelineId?: string;
  attempt: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: AgentResult | PipelineResult;
  error?: string;
  nextRetryAt?: number;
}

// === Pace Control ===
export interface PaceConfig {
  maxConcurrent: number;
  windowMs: number;
  maxPerWindow: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

// === Plugin System ===
export type PluginType =
  | 'adapter'
  | 'agent'
  | 'memory'
  | 'integration'
  | 'knowledge'
  | 'ui'
  | 'tool';

export type PluginStatus =
  | 'loaded'
  | 'initialized'
  | 'active'
  | 'deactivated'
  | 'unloaded'
  | 'error';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  type: PluginType;
  capabilities: string[];
  dependencies?: string[];
}

export interface Plugin {
  manifest: PluginManifest;
  initialize?(host: PluginHostAPI): Promise<void>;
  activate?(): Promise<void>;
  deactivate?(): Promise<void>;
  unload?(): Promise<void>;
}

export interface PluginHostAPI {
  on(event: string, handler: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
  getPlugin(id: string): Plugin | undefined;
  query(capability: string): Plugin[];
  getStateStore(): IStateStore;
  /** Returns the singleton ToolRegistry */
  getToolRegistry(): ToolRegistry;
}

// === State Store Interface ===
export interface IStateStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  createTask(task: Omit<Task, 'id' | 'createdAt'>): Promise<Task>;
  getTask(id: string): Promise<Task | null>;
  updateTask(id: string, patch: Partial<Task>): Promise<void>;
  getNextTask(): Promise<Task | null>;
  getTasksByStatus(status: TaskStatus): Promise<Task[]>;
  createAgentSession(session: AgentSession): Promise<void>;
  getAgentSession(id: string): Promise<AgentSession | null>;
  updateAgentSession(id: string, patch: Partial<AgentSession>): Promise<void>;
  createPipelineProgress(progress: PipelineProgress): Promise<void>;
  updatePipelineProgress(id: string, patch: Partial<PipelineProgress>): Promise<void>;
  appendEvent(event: StoredEvent): Promise<void>;
  getEvents(since: number, limit?: number): Promise<StoredEvent[]>;
}

export interface AgentSession {
  id: string;
  agentRole: AgentRole;
  model: ModelRef;
  status: AgentStatus;
  taskId?: string;
  startedAt: number;
  lastHeartbeat: number;
  result?: AgentResult;
}

export interface PipelineProgress {
  id: string;
  taskId: string;
  stages: StageResult[];
  iteration: number;
  startedAt: number;
  history: PipelineIterationRecord[];
}

export interface StoredEvent {
  id: number;
  type: string;
  payload: string;
  timestamp: number;
}

// === LLM Adapter ===
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
}

export interface LLMResult {
  output: string;
  tokenUsage: { prompt: number; completion: number };
  model: string;
  durationMs: number;
  toolCalls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMAdapter extends Plugin {
  prompt(
    model: ModelRef,
    messages: LLMMessage[],
    options: LLMOptions,
  ): Promise<LLMResult>;
  stream?(
    model: ModelRef,
    messages: LLMMessage[],
    options: LLMOptions,
  ): AsyncGenerator<string>;
  supports(model: ModelRef): boolean;
}

export interface ToolResult {
  name: string;
  output: string;
  error?: string;
  durationMs: number;
}

export interface ToolHandler {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

// === Model Router Config ===
export interface ModelRoutingConfig {
  defaults: Record<AgentRole, ModelRef>;
  fallbacks: Record<AgentRole, ModelRef[]>;
  capabilities: Record<string, string[]>;
}

// === MiuraSwarm Config ===
export interface MiuraConfig {
  models: ModelRoutingConfig;
  pace: PaceConfig;
  stuckDetection: StuckDetectionConfig;
  plugins: {
    adapters?: string[];
    agents?: string[];
    memory?: string[];
    integrations?: string[];
  };
}

// === Event Map ===
export interface EventMap {
  'task.created': { taskId: string; priority: Priority; input: string };
  'task.queued': { taskId: string; position: number };
  'task.running': { taskId: string; agentId: string };
  'task.completed': { taskId: string; result: AgentResult };
  'task.failed': { taskId: string; error: string; attempt: number };
  'agent.spawned': { agentId: string; role: AgentRole; model: ModelRef };
  'agent.completed': { agentId: string; result: AgentResult };
  'agent.failed': { agentId: string; error: string };
  'agent.timeout': { agentId: string; timeoutMs: number };
  'agent.unhealthy': { agentId: string; lastHeartbeat: number };
  'agent.toolCalled': { agentId: string; name: string; output: string; error?: string; durationMs: number };
  'pipeline.started': { pipelineId: string; stages: string[] };
  'pipeline.stage': {
    pipelineId: string;
    stage: string;
    status: 'running' | 'skipped' | 'done';
  };
  'pipeline.completed': { pipelineId: string; result: PipelineResult };
  'pipeline.stuck': { pipelineId: string; detector: StuckSignal };
  'pipeline.max_iterations': {
    pipelineId: string;
    iterations: number;
  };
  'model.escalated': { from: ModelRef; to: ModelRef; reason: string };
  'plugin.loaded': { pluginId: string; type: PluginType };
  'plugin.failed': { pluginId: string; error: string };
  'system.error': { error: string; source: string };
}
