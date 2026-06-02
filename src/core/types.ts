// MiuraSwarm Core Types
// All shared interfaces, types, and contracts

// Forward reference to ToolRegistry class (defined in tool-registry.ts)
import type { ToolRegistry } from "./tool-registry.js";

// === Priority ===
export type Priority = "high" | "medium" | "low";

// === Model References ===
export interface ModelRef {
	provider:
		| "claude"
		| "nvidia-nim"
		| "ollama"
		| "openai"
		| "openrouter"
		| "groq"
		| "google"
		| "cerebras"
		| "zyphra"
		| "cohere"
		| "sambanova"
		| "mistral"
		| "llama-server";
	model: string;
	maxTokens?: number;
	supportsToolUse?: boolean;
	supportsStreaming?: boolean;
}

// === Agent Types ===
export type AgentRole =
	| "planner"
	| "worker"
	| "researcher"
	| "reviewer"
	| "scout"
	| "context-builder"
	| "chat"
	| "oracle"
	| "delegate";

export type AgentStatus =
	| "spawning"
	| "running"
	| "completed"
	| "failed"
	| "timeout"
	| "killed";

export type AgentCapability =
	| "code"
	| "research"
	| "review"
	| "plan"
	| "scout"
	| "decision"
	| "context"
	| "delegate";

export interface AgentConfig {
	id: string;
	role: AgentRole;
	specialty: string;
	/** @description Reference only — ModelRouter.resolve() controls actual model selection. */
	defaultModel: ModelRef;
	/** @description Reference only — ModelRouter manages fallback chains. */
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
	 * Roles of stages that must complete before this stage can start.
	 */
	dependsOn?: AgentRole[];
}

export interface PipelineDefinition {
	stages: StageConfig[];
	maxIterations: number;
	stuckDetection?: StuckDetectionConfig;
}

export type PipelineProgressStatus =
	| "running"
	| "completed"
	| "failed"
	| "interrupted";

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
	status: "completed" | "skipped" | "failed";
	result?: AgentResult;
	error?: string;
	durationMs: number;
}

// === Stuck Detection ===
export type StuckType =
	| "error_loop"
	| "revision_loop"
	| "output_repeat"
	| "monologue";

export type StuckSuggestion =
	| "ESCALATE_MODEL"
	| "REFRAME_TASK"
	| "CHANGE_APPROACH"
	| "FORCE_REVIEW";

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
	| "created"
	| "queued"
	| "running"
	| "completed"
	| "failed";

export interface Task {
	id: string;
	type: "pipeline" | "agent" | "research";
	role?: AgentRole;
	pipelineDefinition?: PipelineDefinition;
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
	| "adapter"
	| "agent"
	| "memory"
	| "integration"
	| "knowledge"
	| "ui"
	| "tool";

export type PluginStatus =
	| "loaded"
	| "initialized"
	| "active"
	| "deactivated"
	| "unloaded"
	| "error";

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
	/** Returns the EventBus for low-level event subscription */
	getEventBus(): unknown;
	/** Returns the CLI CommandRegistry (if available) */
	getCommandRegistry?(): unknown;
}

// === State Store Interface ===
export interface IStateStore {
	initialize(): Promise<void>;
	close(): Promise<void>;
	createTask(task: Omit<Task, "id" | "createdAt">): Promise<Task>;
	getTask(id: string): Promise<Task | null>;
	updateTask(id: string, patch: Partial<Task>): Promise<void>;
	getNextTask(): Promise<Task | null>;
	getTasksByStatus(status: TaskStatus): Promise<Task[]>;
	countTasksByStatus(status: TaskStatus): Promise<number>;
	createAgentSession(session: AgentSession): Promise<void>;
	getAgentSession(id: string): Promise<AgentSession | null>;
	updateAgentSession(id: string, patch: Partial<AgentSession>): Promise<void>;
	createPipelineProgress(progress: PipelineProgress): Promise<void>;
	updatePipelineProgress(
		id: string,
		patch: Partial<PipelineProgress>,
	): Promise<void>;
	getPipelineProgress(id: string): Promise<PipelineProgress | null>;
	listInterruptedPipelines(limit?: number): Promise<PipelineProgress[]>;
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
	input: string;
	definition: PipelineDefinition;
	stages: StageResult[];
	iteration: number;
	status: PipelineProgressStatus;
	startedAt: number;
	updatedAt: number;
	history: PipelineIterationRecord[];
}

export interface PipelineMetrics {
	pipelineId: string;
	success: boolean;
	iterations: number;
	stageCount: number;
	retries: number;
	escalations: number;
	latencyMs: number;
}

export interface StoredEvent {
	id: number;
	type: string;
	payload: string;
	timestamp: number;
}

// === LLM Adapter ===
export interface LLMMessage {
	role: "system" | "user" | "assistant" | "tool" | "tool_use" | "tool_result";
	content?: string;
	/** Tool calls requested by an assistant turn (OpenAI tool-calling protocol). */
	toolCalls?: ToolCall[];
	/** Links a tool-result turn back to the assistant tool call that produced it. */
	toolCallId?: string;
	timestamp?: string;
	metadata?: Record<string, unknown>;
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

/**
 * A single chunk of a streaming chat-completions response.
 * Providers that implement `streamChat()` emit one or more of these
 * per token/decision. The loop accumulates them into a final LLMResult.
 */
export interface ChatChunk {
	/** Incremental text content. May arrive across many chunks. */
	content?: string;
	/** A single tool call being assembled across chunks. */
	toolCall?: ToolCall;
	/** Token usage if the provider reports it (usually on the last chunk). */
	usage?: { prompt?: number; completion?: number };
	/** Set on the final chunk so the loop knows when to stop iterating. */
	done?: boolean;
}

/**
 * LLM Adapter interface.
 * Each provider (claude, nvidia-nim, ollama, llama-server, etc.) implements this.
 */
export interface LLMAdapter {
	manifest: PluginManifest;
	initialize(host: PluginHostAPI): Promise<void>;
	activate(): Promise<void>;
	deactivate(): Promise<void>;
	unload(): Promise<void>;
	supports(model: ModelRef): boolean;
	prompt(
		model: ModelRef,
		messages: LLMMessage[],
		options: LLMOptions,
	): Promise<LLMResult>;
	/**
	 * Optional streaming entry point. When implemented, the agent loop
	 * will prefer this over `prompt()` so tokens render live and tool
	 * calls can be detected mid-stream. The default agent loop falls
	 * back to `prompt()` when this method is absent.
	 */
	streamChat?(
		model: ModelRef,
		messages: LLMMessage[],
		options: LLMOptions,
	): AsyncGenerator<ChatChunk>;
}

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface ToolCall {
	/** Provider-assigned id, echoed back in the matching tool-result turn. */
	id?: string;
	name: string;
	arguments: Record<string, unknown>;
	/**
	 * Set when the model's tool-call arguments couldn't be parsed as
	 * JSON, even after repair. The runAgent loop short-circuits execution
	 * for these calls and surfaces `invalidArgs.reason` to the model as
	 * the tool result so it can self-correct on the next turn.
	 */
	invalidArgs?: { reason: string; received: string };
}

export interface ToolResult {
	name: string;
	output: string;
	error?: string;
	durationMs: number;
}

export interface ToolHandler {
	definition: ToolDefinition;
	execute(
		args: Record<string, unknown>,
		ctx?: { requestedBy?: string },
	): Promise<ToolResult>;
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
	"task.created": { taskId: string; priority: Priority; input: string };
	"task.queued": { taskId: string; position: number };
	"task.running": { taskId: string; agentId: string };
	"task.completed": { taskId: string; result: AgentResult };
	"task.failed": { taskId: string; error: string; attempt: number };
	"agent.spawned": { agentId: string; role: AgentRole; model: ModelRef };
	"agent.completed": { agentId: string; result: AgentResult };
	"agent.failed": { agentId: string; error: string };
	"agent.timeout": { agentId: string; timeoutMs: number };
	"agent.unhealthy": { agentId: string; lastHeartbeat: number };
	"agent.toolCalled": {
		agentId: string;
		name: string;
		output: string;
		error?: string;
		durationMs: number;
	};
	"pipeline.started": { pipelineId: string; stages: string[] };
	"pipeline.stage": {
		pipelineId: string;
		stage: string;
		status: "running" | "skipped" | "done";
	};
	"pipeline.completed": { pipelineId: string; result: PipelineResult };
	"pipeline.stuck": { pipelineId: string; detector: StuckSignal };
	"pipeline.max_iterations": { pipelineId: string; iterations: number };
	"model.escalated": { from: ModelRef; to: ModelRef; reason: string };
	"plugin.loaded": { pluginId: string; type: PluginType };
	"plugin.failed": { pluginId: string; type: PluginType };
	"system.error": { error: string; source: string };
}

// === Compaction Types ===
export interface CompactionOptions {
	preserveSystem?: boolean;
	preserveToolCalls?: boolean;
	maxTokens?: number;
	strategy?: string;
}

export interface CompactionResult {
	compactedMessages: LLMMessage[];
	removedMessages: LLMMessage[];
	stats: {
		originalCount: number;
		compactedCount: number;
		removedCount: number;
		compressionRatio: number;
		strategyUsed: string;
		timestamp: string;
	};
}

export interface CompactionStrategy {
	compact(
		messages: LLMMessage[],
		contextWindow: number,
		options?: CompactionOptions,
	): CompactionResult;
}

export interface CompactionConfig {
	strategy:
		| "no_compaction"
		| "sliding_window"
		| "summarize"
		| "hybrid"
		| "safe_split_point";
	options?: {
		windowSize?: number;
		preserveSystem?: boolean;
		thresholdMessages?: number;
		keepMessages?: number;
		useSummarizeForOlder?: boolean;
	};
}

export interface SessionConfig {
	compaction: CompactionConfig;
	contextWindow: number;
	maxMessages?: number;
}

export interface CompactionMetrics {
	totalCompactions: number;
	messagesBefore: number;
	messagesAfter: number;
	compressionRatio: number;
	avgTimeMs: number;
	strategyUsage: Record<string, number>;
	contextWindowUsage: number;
	lastCompactionTime: string;
}

export interface CompactionReport {
	strategy: string;
	config: any;
	metrics: CompactionMetrics;
	recommendations?: string[];
}
