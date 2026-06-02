/**
 * BrainManager — Long-term memory plugin with SQLite persistence.
 *
 * Auto-captures: commits, Oracle decisions, stuck events, pipeline summaries.
 * Query API for agents to retrieve relevant context.
 */

import type {
	Plugin,
	PluginManifest,
	PluginHostAPI,
} from "../../../core/types.js";
import type { EventBus } from "../../../core/event-bus.js";
import type { PipelineResult, StuckSignal } from "../../../core/types.js";
import type { BrainEntry, BrainEntryType } from "./brain-types.js";
import { BrainStore } from "./brain-store.js";
import { AutoCaptureService } from "./auto-capture.js";

export interface BrainManagerConfig {
	/** Project name for scoping memories. Defaults to repo name from cwd. */
	projectName?: string;
	/** Auto-capture threshold: min token significance to auto-save. Default 50. */
	minTokensForAutoCapture?: number;
	/** Enable auto-capture of stuck detection events. Default true. */
	captureStuckEvents?: boolean;
	/** Enable auto-capture of pipeline completions. Default true. */
	capturePipelineEvents?: boolean;
}

export const DEFAULT_BRAIN_CONFIG: Required<
	Omit<BrainManagerConfig, "projectName">
> = {
	minTokensForAutoCapture: 50,
	captureStuckEvents: true,
	capturePipelineEvents: true,
};

export class BrainManager implements Plugin {
	readonly manifest: PluginManifest = {
		id: "brain",
		name: "Brain Memory",
		version: "0.1.0",
		type: "memory",
		capabilities: ["memory", "context", "search"],
	};

	private config: Required<Omit<BrainManagerConfig, "projectName">> & {
		projectName: string;
	};
	private store: BrainStore;
	private autoCaptureService: AutoCaptureService | null = null;
	private host: PluginHostAPI | null = null;
	private eventBus: EventBus | null = null;
	private boundHandlers = {
		onStuck: this.onPipelineStuck.bind(this),
		onCompleted: this.onPipelineCompleted.bind(this),
		onFailed: this.onPipelineFailed.bind(this),
	};

	constructor(dbPath: string, config: BrainManagerConfig = {}) {
		const projectName = config.projectName ?? this.detectProjectName();
		this.config = { ...DEFAULT_BRAIN_CONFIG, ...config, projectName };
		this.store = new BrainStore(dbPath);
	}

	async initialize(host: PluginHostAPI): Promise<void> {
		this.host = host;
		this.eventBus = this.host.getEventBus() as EventBus;
		await this.store.initialize();
		this.registerEventListeners();
		// Initialize auto-capture service
		this.autoCaptureService = new AutoCaptureService(this, {
			enabled: this.config.capturePipelineEvents,
		});
	}

	async activate(): Promise<void> {
		this.autoCaptureService?.start(this.eventBus!);
	}

	async deactivate(): Promise<void> {
		this.autoCaptureService?.stop(this.eventBus!);
	}

	async unload(): Promise<void> {
		this.deregisterEventListeners();
		await this.store.close();
	}

	// === Public API ===

	/**
	 * Query brain entries matching a search term.
	 */
	async search(
		query: string,
		opts: { limit?: number; type?: BrainEntryType } = {},
	): Promise<BrainEntry[]> {
		return this.store.search(query, {
			project: this.config.projectName,
			...opts,
		});
	}

	/**
	 * Get recent entries for a topic.
	 */
	async getByTopic(topicKey: string): Promise<BrainEntry[]> {
		return this.store.getByTopic(topicKey, this.config.projectName);
	}

	/**
	 * Save a memory entry directly.
	 */
	async save(
		entry: Omit<BrainEntry, "id" | "createdAt" | "project">,
	): Promise<BrainEntry> {
		return this.store.insert({
			...entry,
			project: this.config.projectName,
		});
	}

	/**
	 * Save a decision (architectural choice).
	 */
	async saveDecision(
		title: string,
		content: string,
		sessionId?: string,
	): Promise<BrainEntry> {
		return this.save({
			type: "decision",
			topicKey: title.toLowerCase().replace(/\s+/g, "-"),
			title,
			content,
			sessionId,
			metadata: {},
		});
	}

	/**
	 * Save an architectural note.
	 */
	async saveArchitecture(
		title: string,
		content: string,
		sessionId?: string,
	): Promise<BrainEntry> {
		return this.save({
			type: "architecture",
			topicKey: title.toLowerCase().replace(/\s+/g, "-"),
			title,
			content,
			sessionId,
			metadata: {},
		});
	}

	/**
	 * Save a bug fix with root cause.
	 */
	async saveBugFix(
		title: string,
		what: string,
		why: string,
		where: string,
		sessionId?: string,
	): Promise<BrainEntry> {
		const content = `**What**: ${what}\n**Why**: ${why}\n**Where**: ${where}`;
		return this.save({
			type: "bugfix",
			topicKey: title.toLowerCase().replace(/\s+/g, "-"),
			title: `Fix: ${title}`,
			content,
			sessionId,
			metadata: { bug_title: title },
		});
	}

	/**
	 * Save a discovered pattern or gotcha.
	 */
	async savePattern(
		title: string,
		content: string,
		sessionId?: string,
	): Promise<BrainEntry> {
		return this.save({
			type: "pattern",
			topicKey: title.toLowerCase().replace(/\s+/g, "-"),
			title,
			content,
			sessionId,
			metadata: {},
		});
	}

	/**
	 * Get entry count for a type.
	 */
	async countByType(type?: BrainEntryType): Promise<number> {
		return this.store.count({ project: this.config.projectName, type });
	}

	/**
	 * Get recent entries across all types.
	 */
	async getRecent(limit = 10): Promise<BrainEntry[]> {
		return this.store.getRecent(this.config.projectName, limit);
	}

	/**
	 * Get session summary.
	 */
	async getSessionSummary(
		sessionId: string,
	): Promise<{ entries: number; types: Record<string, number> }> {
		const entries = await this.store.getBySession(
			sessionId,
			this.config.projectName,
		);
		const types: Record<string, number> = {};
		for (const e of entries) {
			types[e.type] = (types[e.type] ?? 0) + 1;
		}
		return { entries: entries.length, types };
	}

	/**
	 * Search and return as agent-context string.
	 */
	async getRelevantContext(query: string, maxEntries = 5): Promise<string> {
		const entries = await this.search(query, { limit: maxEntries });
		if (entries.length === 0) return "";

		const lines = ["## Relevant memories:", ""];
		for (const e of entries) {
			lines.push(`**[${e.type}] ${e.title}**`);
			lines.push(
				e.content.slice(0, 400) + (e.content.length > 400 ? "..." : ""),
			);
			lines.push("");
		}
		return lines.join("\n");
	}

	// === Private ===

	private registerEventListeners(): void {
		if (!this.eventBus) return;

		if (this.config.captureStuckEvents) {
			this.eventBus!.on("pipeline.stuck", this.boundHandlers.onStuck as any);
		}
		if (this.config.capturePipelineEvents) {
			this.eventBus!.on(
				"pipeline.completed",
				this.boundHandlers.onCompleted as any,
			);
			this.eventBus!.on("pipeline.failed", this.boundHandlers.onFailed as any);
		}
	}

	private deregisterEventListeners(): void {
		if (!this.eventBus) return;
		this.eventBus.off("pipeline.stuck", this.boundHandlers.onStuck as any);
		this.eventBus.off(
			"pipeline.completed",
			this.boundHandlers.onCompleted as any,
		);
		this.eventBus.off("pipeline.failed", this.boundHandlers.onFailed as any);
	}

	private onPipelineStuck(payload: {
		pipelineId: string;
		detector: StuckSignal;
	}): void {
		const { pipelineId, detector } = payload;
		this.save({
			type: "discovery",
			topicKey: `stuck-${detector.type}`,
			title: `Pipeline stuck: ${pipelineId}`,
			content:
				`Pipeline ${pipelineId} got stuck.\n` +
				`Type: ${detector.type}\n` +
				`Suggestion: ${detector.suggestion}\n` +
				`Details: ${detector.details}`,
			sessionId: undefined,
			metadata: { pipelineId, stuckType: detector.type },
		}).catch((err) => {
			this.host?.emit("system.error", {
				error: String(err),
				source: "BrainManager.onPipelineStuck",
			});
		});
	}

	private onPipelineCompleted(payload: {
		pipelineId: string;
		result: PipelineResult;
	}): void {
		const { pipelineId, result } = payload;
		this.save({
			type: "discovery",
			topicKey: `pipeline-${pipelineId}`,
			title: `Pipeline completed: ${pipelineId}`,
			content:
				`Pipeline ${pipelineId} completed in ${result.iterations} iterations (${result.totalDurationMs}ms).\n` +
				`Stages: ${result.stages.map((s) => `${s.role}:${s.status}`).join(", ")}\n` +
				`Output: ${result.finalOutput.slice(0, 200)}`,
			sessionId: undefined,
			metadata: {
				pipelineId,
				iterations: result.iterations,
				durationMs: result.totalDurationMs,
				success: result.stages.every((s) => s.status === "completed"),
			},
		}).catch((err) => {
			this.host?.emit("system.error", {
				error: String(err),
				source: "BrainManager.onPipelineCompleted",
			});
		});
	}

	private onPipelineFailed(payload: {
		pipelineId: string;
		error: string;
	}): void {
		const { pipelineId, error } = payload;
		this.save({
			type: "discovery",
			topicKey: `pipeline-failed-${pipelineId}`,
			title: `Pipeline failed: ${pipelineId}`,
			content: `Pipeline ${pipelineId} failed: ${error}`,
			sessionId: undefined,
			metadata: { pipelineId, failed: true },
		}).catch(() => {
			/* swallow */
		});
	}

	private detectProjectName(): string {
		try {
			const { readFileSync } = require("fs") as typeof import("fs");
			const pkgPath = require("path").join(process.cwd(), "package.json");
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
			return pkg.name ?? "unknown-project";
		} catch {
			return "unknown-project";
		}
	}
}
