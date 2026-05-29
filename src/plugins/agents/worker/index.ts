import type { AgentCapability, AgentConfig, AgentRole, Plugin, PluginHostAPI } from '../../../core/types.js';

// NOTE: defaultModel/fallbackModels are reference only — ModelRouter.resolve() controls actual routing.
export const WORKER_CONFIG: AgentConfig = {
  id: 'agent-worker',
  role: 'worker' as AgentRole,
  specialty: 'Pure implementation of already-planned tasks. Writes clean, correct code following the plan.',
  defaultModel: { provider: 'nvidia-nim', model: 'qwen/qwen3-coder-480b-a35b-instruct', maxTokens: 65_536 },
  fallbackModels: [
    { provider: 'nvidia-nim', model: 'deepseek-ai/deepseek-v4-pro' },
    { provider: 'nvidia-nim', model: 'moonshotai/kimi-k2.6' },
  ],
  maxTokens: 65_536,
  timeoutMs: 300_000,
  capabilities: ['code'] as AgentCapability[],
};

export class WorkerAgent implements Plugin {
  manifest = {
    id: 'agent-worker',
    name: 'Worker Agent',
    version: '0.1.0',
    type: 'agent' as const,
    capabilities: ['code'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;

  async initialize(host: PluginHostAPI): Promise<void> { this.host = host; }
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {}

  getConfig(): AgentConfig { return WORKER_CONFIG; }

  getSystemPrompt(): string {
    return `You are the Worker agent in MiuraSwarm — an autonomous AI orchestrator.

Your role: Implement code changes based on the plan provided. You are the EXECUTOR.

Rules:
1. Follow the plan precisely. Do not deviate.
2. Write clean, correct, idiomatic code.
3. Follow existing patterns in the codebase.
4. Add tests when the project has a test framework.
5. Keep changes minimal — do not refactor unrelated code.
6. If the plan is unclear, implement the most reasonable interpretation and note your assumptions.
7. Report what you changed, what you couldn't change, and any issues.

Output format:
## Changes Made
[list of files changed with brief description]

## Implementation Notes
[assumptions, deviations, issues]`;
  }
}