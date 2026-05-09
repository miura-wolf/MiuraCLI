import type {
  AgentRole,
  ModelRef,
  ModelRoutingConfig,
} from './types.js';

export const DEFAULT_ROUTING: ModelRoutingConfig = {
  defaults: {
    planner: { provider: 'claude', model: 'opus', maxTokens: 32_768 },
    worker: { provider: 'claude', model: 'sonnet', maxTokens: 65_536 },
    researcher: { provider: 'nvidia-nim', model: 'deepseek-v4-pro', maxTokens: 32_768 },
    reviewer: { provider: 'claude', model: 'opus', maxTokens: 16_384 },
    scout: { provider: 'claude', model: 'haiku', maxTokens: 8_192 },
    'context-builder': { provider: 'claude', model: 'opus', maxTokens: 32_768 },
    oracle: { provider: 'claude', model: 'opus', maxTokens: 16_384 },
    delegate: { provider: 'nvidia-nim', model: 'gemma-4-31b-it', maxTokens: 8_192 },
  },
  fallbacks: {
    planner: [{ provider: 'nvidia-nim', model: 'kimi-k2.5' }],
    worker: [
      { provider: 'nvidia-nim', model: 'deepseek-v4-pro' },
      { provider: 'ollama', model: 'qwen3' },
    ],
    researcher: [{ provider: 'claude', model: 'sonnet' }],
    reviewer: [{ provider: 'nvidia-nim', model: 'kimi-k2.5' }],
    scout: [{ provider: 'nvidia-nim', model: 'gemma-4-31b-it' }],
    'context-builder': [{ provider: 'nvidia-nim', model: 'kimi-k2.5' }],
    oracle: [{ provider: 'nvidia-nim', model: 'kimi-k2.5' }],
    delegate: [{ provider: 'ollama', model: 'qwen3' }],
  },
  capabilities: {
    'opus': ['code', 'plan', 'review', 'decision', 'context', 'tool_use', 'streaming'],
    'sonnet': ['code', 'plan', 'review', 'tool_use', 'streaming'],
    'haiku': ['code', 'delegate', 'streaming'],
    'deepseek-v4-pro': ['code', 'research', 'tool_use'],
    'gemma-4-31b-it': ['delegate', 'scout'],
    'kimi-k2.5': ['code', 'plan', 'review', 'decision'],
    'minimax-m2.7': ['code', 'research'],
    'glm-5.1': ['code', 'delegate', 'scout'],
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

  constructor(config?: Partial<ModelRoutingConfig>) {
    this.config = {
      defaults: { ...DEFAULT_ROUTING.defaults, ...config?.defaults },
      fallbacks: { ...DEFAULT_ROUTING.fallbacks, ...config?.fallbacks },
      capabilities: { ...DEFAULT_ROUTING.capabilities, ...config?.capabilities },
    };
  }

  resolve(role: AgentRole, requiredCapability?: string): ModelRef {
    const defaultModel = this.config.defaults[role];
    if (!defaultModel) {
      throw new Error(`No default model configured for role: ${role}`);
    }

    // If default model hasn't exceeded failure threshold, use it
    const failureKey = this.failureKey(role, defaultModel);
    const failure = this.failures.get(failureKey);

    if (!failure || failure.count < this.maxFailuresBeforeEscalation) {
      if (!requiredCapability || this.hasCapability(defaultModel, requiredCapability)) {
        return defaultModel;
      }
    }

    // Try fallback chain
    const fallbacks = this.config.fallbacks[role] ?? [];
    for (const fallback of fallbacks) {
      const fbKey = this.failureKey(role, fallback);
      const fbFailure = this.failures.get(fbKey);

      if (fbFailure && fbFailure.count >= this.maxFailuresBeforeEscalation) {
        continue;
      }

      if (requiredCapability && !this.hasCapability(fallback, requiredCapability)) {
        continue;
      }

      return fallback;
    }

    // All models exhausted — reset failures for this role and return default
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
  }

  getFallbackChain(role: AgentRole): ModelRef[] {
    const defaultModel = this.config.defaults[role];
    const fallbacks = this.config.fallbacks[role] ?? [];
    return [defaultModel, ...fallbacks];
  }

  private hasCapability(model: ModelRef, capability: string): boolean {
    const modelCaps = this.config.capabilities[model.model];
    if (!modelCaps) return true; // Unknown model — assume capable
    return modelCaps.includes(capability);
  }

  private failureKey(role: AgentRole, model: ModelRef): string {
    return `${role}:${model.provider}:${model.model}`;
  }

  private resetRoleFailures(role: AgentRole): void {
    const prefix = `${role}:`;
    for (const key of this.failures.keys()) {
      if (key.startsWith(prefix)) {
        this.failures.delete(key);
      }
    }
  }
}
