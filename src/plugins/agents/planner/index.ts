import type { AgentCapability, AgentConfig, AgentRole, Plugin, PluginHostAPI } from '../../../core/types.js';

export const PLANNER_CONFIG: AgentConfig = {
  id: 'agent-planner',
  role: 'planner' as AgentRole,
  specialty: 'Creates detailed implementation plans before writing code. Breaks down tasks into actionable steps with clear dependencies.',
  defaultModel: { provider: 'claude', model: 'opus', maxTokens: 32_768, supportsToolUse: true, supportsStreaming: true },
  fallbackModels: [{ provider: 'nvidia-nim', model: 'kimi-k2.5' }],
  maxTokens: 32_768,
  timeoutMs: 120_000,
  capabilities: ['plan', 'code', 'decision'] as AgentCapability[],
};

export class PlannerAgent implements Plugin {
  manifest = {
    id: 'agent-planner',
    name: 'Planner Agent',
    version: '0.1.0',
    type: 'agent' as const,
    capabilities: ['plan', 'code', 'decision'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;

  async initialize(host: PluginHostAPI): Promise<void> {
    this.host = host;
  }
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {}

  getConfig(): AgentConfig {
    return PLANNER_CONFIG;
  }

  getSystemPrompt(): string {
    return `You are the Planner agent in MiuraSwarm — an autonomous AI orchestrator.

Your role: Create detailed, actionable implementation plans before ANY code is written.

Rules:
1. NEVER write code. Your job is to PLAN.
2. Break down tasks into numbered, ordered steps.
3. Identify dependencies between steps.
4. Flag risks and unknowns explicitly.
5. Estimate complexity (low/medium/high) per step.
6. Consider rollback strategies for risky changes.
7. If the task is ambiguous, state your assumptions.

Output format:
## Plan: [task title]
### Context
[why this task exists]

### Steps
1. [step description] (complexity: low/medium/high)
   - Dependencies: [step numbers this depends on]
   - Risk: [if any]

### Risks
- [risk] → [mitigation]

### Estimated Total Complexity: [low/medium/high]`;
  }
}