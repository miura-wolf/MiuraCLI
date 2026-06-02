import type { AgentRole, ModelRef, ModelRoutingConfig } from "./types.js";
import { getGlobalRotator } from "./api-key-rotator.js";

// SDD phase types for per-phase routing
export type SDDPhase =
	| "propose"
	| "spec"
	| "design"
	| "tasks"
	| "apply"
	| "verify"
	| "archive";

// NVIDIA NIM-first routing — free tier, 100+ models
// Fallback: Ollama (local)

// Per-phase model overrides — different models for different SDD phases
const SDD_PHASE_MODELS: Record<
	SDDPhase,
	{ provider: ModelRef["provider"]; model: string; maxTokens: number }
> = {
	propose: {
		provider: "nvidia-nim",
		model: "nvidia/llama-3.1-nemotron-nano-8b-v1",
		maxTokens: 8_192,
	}, // Lightweight, fast
	spec: {
		provider: "nvidia-nim",
		model: "nvidia/llama-3.3-nemotron-super-49b-v1",
		maxTokens: 32_768,
	}, // Detailed spec writing
	design: {
		provider: "nvidia-nim",
		model: "nvidia/llama-3.3-nemotron-super-49b-v1",
		maxTokens: 65_536,
	}, // Heavy reasoning
	tasks: {
		provider: "nvidia-nim",
		model: "nvidia/llama-3.3-nemotron-super-49b-v1",
		maxTokens: 32_768,
	}, // Task breakdown
	apply: {
		provider: "nvidia-nim",
		model: "nvidia/llama-3.3-nemotron-super-49b-v1",
		maxTokens: 65_536,
	}, // Code generation
	verify: {
		provider: "nvidia-nim",
		model: "nvidia/llama-3.3-nemotron-super-49b-v1",
		maxTokens: 16_384,
	}, // Review/testing
	archive: {
		provider: "nvidia-nim",
		model: "nvidia/llama-3.1-nemotron-nano-8b-v1",
		maxTokens: 8_192,
	}, // Lightweight finalization
};

// Phase description for /model command
export const SDD_PHASE_DESCRIPTIONS: Record<SDDPhase, string> = {
	propose: "Fast, lightweight — decide what to build",
	spec: "Detailed — write SPEC.md with requirements",
	design: "Reasoning-heavy — architectural decisions",
	tasks: "Break down into concrete tasks",
	apply: "Code generation — write files",
	verify: "Review and testing",
	archive: "Finalize and document",
};

export const DEFAULT_ROUTING: ModelRoutingConfig = {
	defaults: {
		planner: {
			provider: "nvidia-nim",
			model: "nvidia/llama-3.3-nemotron-super-49b-v1",
			maxTokens: 32_768,
		},
		worker: {
			provider: "nvidia-nim",
			model: "nvidia/llama-3.3-nemotron-super-49b-v1",
			maxTokens: 65_536,
		},
		researcher: {
			provider: "nvidia-nim",
			model: "nvidia/llama-3.3-nemotron-super-49b-v1",
			maxTokens: 32_768,
		},
		reviewer: {
			provider: "nvidia-nim",
			model: "nvidia/llama-3.3-nemotron-super-49b-v1",
			maxTokens: 16_384,
		},
		scout: {
			provider: "nvidia-nim",
			model: "nvidia/llama-3.1-nemotron-nano-8b-v1",
			maxTokens: 8_192,
		},
		"context-builder": {
			provider: "nvidia-nim",
			model: "nvidia/llama-3.3-nemotron-super-49b-v1",
			maxTokens: 32_768,
		},
		chat: {
			// Coder-specialized: best tool-use + agentic on the free tier.
			// Reasoning 49B was too slow/verbose for interactive chat.
			provider: "nvidia-nim",
			model: "qwen/qwen3-coder-480b-a35b-instruct",
			maxTokens: 8192,
		},
		oracle: {
			provider: "nvidia-nim",
			model: "nvidia/llama-3.3-nemotron-super-49b-v1",
			maxTokens: 16_384,
		},
		delegate: {
			provider: "nvidia-nim",
			model: "nvidia/llama-3.1-nemotron-nano-8b-v1",
			maxTokens: 8_192,
		},
	},
	fallbacks: {
		planner: [{ provider: "ollama", model: "qwen2.5-coder-7b" }],
		worker: [{ provider: "ollama", model: "qwen2.5-coder-7b" }],
		researcher: [{ provider: "ollama", model: "qwen2.5-coder-7b" }],
		reviewer: [{ provider: "ollama", model: "qwen2.5-coder-7b" }],
		scout: [{ provider: "ollama", model: "qwen2.5-coder-7b" }],
		"context-builder": [{ provider: "ollama", model: "qwen2.5-coder-7b" }],
		chat: [
			{ provider: "ollama", model: "qwen2.5-coder-7b" },
			{ provider: "lmstudio", model: "qwen2.5-coder-7b" },
			{ provider: "llama-server", model: "qwen2.5-coder-7b-q4_k_m" },
		],
		oracle: [{ provider: "ollama", model: "qwen2.5-coder-7b" }],
		delegate: [{ provider: "ollama", model: "qwen2.5-coder-7b" }],
	},
	capabilities: {
		// NVIDIA NIM models
		"nvidia/llama-3.3-nemotron-super-49b-v1": [
			"code",
			"plan",
			"review",
			"decision",
			"reasoning",
		],
		"nvidia/llama-3.1-nemotron-nano-8b-v1": [
			"code",
			"delegate",
			"scout",
			"fast",
		],
		"nvidia/llama-3.3-nemotron-super-49b-v1.5": [
			"code",
			"plan",
			"review",
			"decision",
			"reasoning",
		],
		"nvidia/nemotron-3-super-120b-a12b": ["code", "plan", "review", "decision"],
		"nvidia/nemotron-4-340b-instruct": ["code", "plan", "review", "decision"],
		"qwen/qwen3-coder-480b-a35b-instruct": [
			"code",
			"plan",
			"review",
			"tool_use",
			"agentic",
		],
		"deepseek-ai/deepseek-v4-pro": [
			"code",
			"plan",
			"review",
			"decision",
			"research",
			"reasoning",
			"tool_use",
			"agentic",
		],
		"deepseek-ai/deepseek-v4-flash": [
			"code",
			"plan",
			"review",
			"decision",
			"research",
			"reasoning",
			"tool_use",
			"agentic",
		],
		"moonshotai/kimi-k2.6": [
			"code",
			"plan",
			"review",
			"decision",
			"agentic",
			"vision",
		],
		"z-ai/glm-5.1": [
			"code",
			"plan",
			"review",
			"decision",
			"reasoning",
			"agentic",
		],
		"minimaxai/minimax-m2.7": ["code", "research", "plan", "reasoning"],
		"google/gemma-4-31b-it": [
			"code",
			"delegate",
			"scout",
			"vision",
			"multimodal",
		],
		"qwen/qwen3.5-397b-a17b": [
			"code",
			"plan",
			"review",
			"reasoning",
			"agentic",
		],
		"qwen/qwen3.5-122b-a10b": ["code", "plan", "review", "reasoning"],
		"meta/llama-3.3-70b-instruct": ["code", "plan", "review", "decision"],
		"meta/llama-3.1-70b-instruct": ["code", "plan", "review"],
		"meta/llama-3.1-8b-instruct": ["code", "delegate", "scout"],
		"mistralai/mistral-large-3-675b-instruct-2512": [
			"code",
			"plan",
			"review",
			"decision",
			"reasoning",
		],
		// Groq (if API key provided)
		"llama-3.3-70b-versatile": ["code", "plan", "review", "decision", "fast"],
		"qwen/qwen3-32b": ["code", "plan", "research", "fast"],
		// Local models
		local: [
			"code",
			"plan",
			"review",
			"decision",
			"reasoning",
			"tool_use",
			"agentic",
		],
	},
};

interface FailureRecord {
	model: ModelRef;
	count: number;
	lastFailure: number;
}

export class ModelRouter {
	private config: ModelRoutingConfig;
	private failures = new Map<string, FailureRecord>();
	private maxFailuresBeforeEscalation = 2;
	private rotator = getGlobalRotator();

	constructor(config?: Partial<ModelRoutingConfig>) {
		this.config = {
			defaults: {
				...DEFAULT_ROUTING.defaults,
				...config?.defaults,
			},
			fallbacks: {
				...DEFAULT_ROUTING.fallbacks,
				...config?.fallbacks,
			},
			capabilities: {
				...DEFAULT_ROUTING.capabilities,
				...config?.capabilities,
			},
		};
	}

	resolve(role: AgentRole, requiredCapability?: string): ModelRef {
		const defaultModel = this.config.defaults[role];
		if (!defaultModel)
			throw new Error(`No default model configured for role: ${role}`);

		const failureKey = this.failureKey(role, defaultModel);
		const failure = this.failures.get(failureKey);

		if (!failure || failure.count < this.maxFailuresBeforeEscalation) {
			if (
				!requiredCapability ||
				this.hasCapability(defaultModel, requiredCapability)
			)
				return defaultModel;
		}

		const fallbacks = this.config.fallbacks[role] ?? [];
		for (const fallback of fallbacks) {
			const fbKey = this.failureKey(role, fallback);
			const fbFailure = this.failures.get(fbKey);
			if (fbFailure && fbFailure.count >= this.maxFailuresBeforeEscalation)
				continue;
			if (
				requiredCapability &&
				!this.hasCapability(fallback, requiredCapability)
			)
				continue;
			return fallback;
		}

		this.resetRoleFailures(role);
		return defaultModel;
	}

	reportFailure(role: AgentRole, model: ModelRef): void {
		const key = this.failureKey(role, model);
		const existing = this.failures.get(key);

		if (existing) {
			existing.count++;
			existing.lastFailure = Date.now();
		} else {
			this.failures.set(key, { model, count: 1, lastFailure: Date.now() });
		}

		const apiKey = this.getApiKeyForModel(model);
		if (apiKey) {
			this.rotator.reportFailure(apiKey);
		}
	}

	getFallbackChain(role: AgentRole): ModelRef[] {
		return [this.config.defaults[role], ...(this.config.fallbacks[role] ?? [])];
	}

	/**
	 * Resolve model for a specific SDD phase.
	 * Uses phase-specific models for optimized routing per ADR-001 Section 11.2.
	 */
	resolveForPhase(
		phase: SDDPhase,
		fallbackRole: AgentRole = "worker",
	): ModelRef {
		const phaseModel = SDD_PHASE_MODELS[phase];
		if (!phaseModel) {
			// Fallback to role-based routing
			return this.resolve(fallbackRole);
		}

		const modelRef: ModelRef = {
			provider: phaseModel.provider,
			model: phaseModel.model,
			maxTokens: phaseModel.maxTokens,
		};

		// Check if we have this model available
		const failureKey = this.failureKey(fallbackRole, modelRef);
		const failure = this.failures.get(failureKey);

		if (!failure || failure.count < this.maxFailuresBeforeEscalation) {
			return modelRef;
		}

		// Fallback to role default if phase model failed
		return this.resolve(fallbackRole);
	}

	/**
	 * Get all phase models for display.
	 */
	getPhaseModels(): Array<{
		phase: SDDPhase;
		model: ModelRef;
		description: string;
	}> {
		return (Object.keys(SDD_PHASE_MODELS) as SDDPhase[]).map((phase) => ({
			phase,
			model: SDD_PHASE_MODELS[phase],
			description: SDD_PHASE_DESCRIPTIONS[phase],
		}));
	}

	getApiKeyStats() {
		return this.rotator.getStats();
	}

	private hasCapability(model: ModelRef, capability: string): boolean {
		const caps = this.config.capabilities[model.model];
		if (!caps) return true;
		return caps.includes(capability);
	}

	private failureKey(role: AgentRole, model: ModelRef): string {
		return `${role}:${model.provider}:${model.model}`;
	}

	private resetRoleFailures(role: AgentRole): void {
		const prefix = `${role}:`;
		for (const key of this.failures.keys()) {
			if (key.startsWith(prefix)) this.failures.delete(key);
		}
	}

	private getApiKeyForModel(model: ModelRef): string | null {
		const keyEntry = this.rotator.getKey(model.provider);
		return keyEntry?.key ?? null;
	}
}
