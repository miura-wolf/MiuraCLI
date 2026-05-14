import type { AgentRole, ModelRef, ModelRoutingConfig } from './types.js';
import { getGlobalRotator } from './api-key-rotator.js';

// Cloud-first routing — best free model per role
// Strategy: heavy reasoning → big models, speed → Groq/Cerebras, vision → multimodal
export const DEFAULT_ROUTING: ModelRoutingConfig = {
  defaults: {
    // Planner: needs strong reasoning for architecture decisions
    planner: { provider: 'nvidia-nim', model: 'deepseek-ai/deepseek-v4-flash', maxTokens: 32_768 },
    // Worker: needs best coding model — qwen3-coder is king
    worker: { provider: 'nvidia-nim', model: 'qwen/qwen3-coder-480b-a35b-instruct', maxTokens: 65_536 },
    // Researcher: needs reasoning + broad knowledge
    researcher: { provider: 'nvidia-nim', model: 'deepseek-ai/deepseek-v4-pro', maxTokens: 32_768 },
    // Reviewer: needs strong reasoning, mid-size is fine
    reviewer: { provider: 'nvidia-nim', model: 'z-ai/glm-5.1', maxTokens: 16_384 },
    // Scout: needs speed for quick lookups
    scout: { provider: 'groq', model: 'llama-3.3-70b-versatile', maxTokens: 8_192 },
    // Context builder: needs reasoning + context assembly
    'context-builder': { provider: 'nvidia-nim', model: 'minimaxai/minimax-m2.7', maxTokens: 32_768 },
    // Oracle: needs the deepest reasoning for tradeoff decisions
    oracle: { provider: 'nvidia-nim', model: 'deepseek-ai/deepseek-v4-pro', maxTokens: 16_384 },
    // Delegate: needs to understand and route tasks
    delegate: { provider: 'nvidia-nim', model: 'google/gemma-4-31b-it', maxTokens: 8_192 },
  },
  fallbacks: {
    planner: [
      { provider: 'nvidia-nim', model: 'z-ai/glm-5.1' },
      { provider: 'nvidia-nim', model: 'minimaxai/minimax-m2.7' },
      { provider: 'openrouter', model: 'qwen/qwen3-coder:free' },
      { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    ],
    worker: [
      { provider: 'nvidia-nim', model: 'deepseek-ai/deepseek-v4-pro' },
      { provider: 'nvidia-nim', model: 'moonshotai/kimi-k2.6' },
      { provider: 'openrouter', model: 'qwen/qwen3-coder:free' },
      { provider: 'nvidia-nim', model: 'qwen/qwen3.5-397b-a17b' },
    ],
    researcher: [
      { provider: 'nvidia-nim', model: 'deepseek-ai/deepseek-v4-flash' },
      { provider: 'nvidia-nim', model: 'z-ai/glm-5.1' },
      { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
    ],
    reviewer: [
      { provider: 'nvidia-nim', model: 'deepseek-ai/deepseek-v4-flash' },
      { provider: 'nvidia-nim', model: 'minimaxai/minimax-m2.7' },
      { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    ],
    scout: [
      { provider: 'groq', model: 'qwen/qwen3-32b' },
      { provider: 'cerebras', model: 'llama3.1-8b' },
      { provider: 'nvidia-nim', model: 'google/gemma-4-31b-it' },
    ],
    'context-builder': [
      { provider: 'nvidia-nim', model: 'deepseek-ai/deepseek-v4-flash' },
      { provider: 'nvidia-nim', model: 'z-ai/glm-5.1' },
    ],
    oracle: [
      { provider: 'nvidia-nim', model: 'z-ai/glm-5.1' },
      { provider: 'nvidia-nim', model: 'minimaxai/minimax-m2.7' },
      { provider: 'openrouter', model: 'nousresearch/hermes-3-llama-3.1-405b:free' },
    ],
    delegate: [
      { provider: 'groq', model: 'llama-3.3-70b-versatile' },
      { provider: 'zyphra', model: 'zyphra/ZAYA1-8B' },
      { provider: 'cerebras', model: 'llama3.1-8b' },
    ],
  },
  capabilities: {
    // Heavy hitters — NIM
    'qwen/qwen3-coder-480b-a35b-instruct': ['code', 'plan', 'review', 'tool_use', 'agentic'],
    'deepseek-ai/deepseek-v4-pro': ['code', 'plan', 'review', 'decision', 'research', 'reasoning', 'tool_use', 'agentic'],
    'deepseek-ai/deepseek-v4-flash': ['code', 'plan', 'review', 'decision', 'research', 'reasoning', 'tool_use', 'agentic'],
    'moonshotai/kimi-k2.6': ['code', 'plan', 'review', 'decision', 'agentic', 'vision'],
    'z-ai/glm-5.1': ['code', 'plan', 'review', 'decision', 'reasoning', 'agentic'],
    'z-ai/glm5': ['code', 'plan', 'review', 'decision', 'reasoning'],
    'minimaxai/minimax-m2.7': ['code', 'research', 'plan', 'reasoning'],
    'google/gemma-4-31b-it': ['code', 'delegate', 'scout', 'vision', 'multimodal'],
    'qwen/qwen3.5-397b-a17b': ['code', 'plan', 'review', 'reasoning', 'agentic'],
    'qwen/qwen3.5-122b-a10b': ['code', 'plan', 'review', 'reasoning'],
    'qwen/qwen3-next-80b-a3b-instruct': ['code', 'plan', 'reasoning'],
    'nvidia/llama-3.3-nemotron-super-49b-v1': ['code', 'plan', 'review'],
    'nvidia/nemotron-3-super-120b-a12b': ['code', 'plan', 'review', 'decision'],
    'nvidia/nemotron-4-340b-instruct': ['code', 'plan', 'review', 'decision'],
    'meta/llama-3.3-70b-instruct': ['code', 'plan', 'review', 'decision'],
    'meta/llama-3.1-70b-instruct': ['code', 'plan', 'review'],
    'meta/llama-3.1-8b-instruct': ['code', 'delegate', 'scout'],
    'meta/llama-3.2-90b-vision-instruct': ['code', 'vision', 'multimodal'],
    'meta/llama-4-maverick-17b-128e-instruct': ['code', 'research'],
    'mistralai/mistral-large-3-675b-instruct-2512': ['code', 'plan', 'review', 'decision', 'reasoning'],
    'mistralai/mistral-medium-3.5-128b': ['code', 'plan', 'review'],
    // OpenRouter free
    'qwen/qwen3-coder:free': ['code', 'plan', 'review', 'tool_use'],
    'meta-llama/llama-3.3-70b-instruct:free': ['code', 'plan', 'review', 'decision'],
    'nvidia/nemotron-3-super-120b-a12b:free': ['code', 'plan', 'review', 'decision'],
    'nousresearch/hermes-3-llama-3.1-405b:free': ['code', 'plan', 'review', 'decision'],
    'google/gemma-4-31b-it:free': ['code', 'delegate', 'scout', 'vision'],
    // Groq
    'llama-3.3-70b-versatile': ['code', 'plan', 'review', 'decision', 'fast'],
    'llama-3.1-8b-instant': ['code', 'delegate', 'scout', 'fast'],
    'qwen/qwen3-32b': ['code', 'plan', 'research', 'fast'],
    'meta-llama/llama-4-scout-17b-16e-instruct': ['code', 'research', 'scout'],
    // Cerebras
    'llama3.1-8b': ['code', 'delegate', 'scout', 'fast'],
    'qwen-3-235b-a22b-instruct-2507': ['code', 'plan', 'review', 'reasoning', 'fast'],
    // Google
    'gemini-2.5-flash': ['code', 'plan', 'review', 'research', 'context', 'vision'],
    'gemini-2.5-pro': ['code', 'plan', 'review', 'decision', 'context', 'reasoning', 'vision'],
    // Zyphra
    'zyphra/ZAYA1-8B': ['code', 'reasoning', 'delegate'],
    // Legacy Claude
    'opus': ['code', 'plan', 'review', 'decision', 'context', 'tool_use'],
    'sonnet': ['code', 'plan', 'review', 'tool_use'],
    'haiku': ['code', 'delegate'],
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
    if (!defaultModel) throw new Error(`No default model configured for role: ${role}`);

    const failureKey = this.failureKey(role, defaultModel);
    const failure = this.failures.get(failureKey);

    if (!failure || failure.count < this.maxFailuresBeforeEscalation) {
      if (!requiredCapability || this.hasCapability(defaultModel, requiredCapability))
        return defaultModel;
    }

    const fallbacks = this.config.fallbacks[role] ?? [];
    for (const fallback of fallbacks) {
      const fbKey = this.failureKey(role, fallback);
      const fbFailure = this.failures.get(fbKey);
      if (fbFailure && fbFailure.count >= this.maxFailuresBeforeEscalation) continue;
      if (requiredCapability && !this.hasCapability(fallback, requiredCapability)) continue;
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

    // Report failure to rotator for API key rotation
    const apiKey = this.getApiKeyForModel(model);
    if (apiKey) {
      this.rotator.reportFailure(apiKey);
    }
  }

  getFallbackChain(role: AgentRole): ModelRef[] {
    return [this.config.defaults[role], ...(this.config.fallbacks[role] ?? [])];
  }

  /**
   * Get API key stats for monitoring
   */
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
    // Get the current API key for this model's provider
    const keyEntry = this.rotator.getKey(model.provider);
    return keyEntry?.key ?? null;
  }
}
