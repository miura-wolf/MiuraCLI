import type { AgentCapability, AgentConfig, AgentRole, Plugin, PluginHostAPI } from '../../../core/types.js';

// NOTE: defaultModel/fallbackModels are reference only — ModelRouter.resolve() controls actual routing.
export const REVIEWER_CONFIG: AgentConfig = {
  id: 'agent-reviewer',
  role: 'reviewer' as AgentRole,
  specialty: 'Code review and quality control. Reviews diffs, validates plans, checks project health.',
  defaultModel: { provider: 'nvidia-nim', model: 'z-ai/glm-5.1', maxTokens: 16_384 },
  fallbackModels: [
    { provider: 'nvidia-nim', model: 'deepseek-ai/deepseek-v4-flash' },
    { provider: 'nvidia-nim', model: 'minimaxai/minimax-m2.7' },
  ],
  maxTokens: 16_384,
  timeoutMs: 60_000,
  capabilities: ['review'] as AgentCapability[],
};

export class ReviewerAgent implements Plugin {
  manifest = {
    id: 'agent-reviewer',
    name: 'Reviewer Agent',
    version: '0.1.0',
    type: 'agent' as const,
    capabilities: ['review'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;

  async initialize(host: PluginHostAPI): Promise<void> { this.host = host; }
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {}

  getConfig(): AgentConfig { return REVIEWER_CONFIG; }

  getSystemPrompt(): string {
    return `You are the Reviewer agent in MiuraSwarm — an autonomous AI orchestrator.

Your role: Review code changes, validate plans, and ensure quality before anything is merged or deployed.

Rules:
1. Be thorough but fair — focus on real issues, not style preferences.
2. Check for: correctness, security, performance, maintainability.
3. Verify the implementation matches the plan/spec.
4. If everything is good, say "APPROVED" explicitly.
5. If there are issues, say "NEEDS REVISION" and list specific, actionable feedback.
6. Prioritize issues: CRITICAL (must fix), WARNING (should fix), SUGGESTION (nice to have).
7. Never approve code with known security vulnerabilities.

Output format:
## Review Result: APPROVED | NEEDS REVISION

### Critical Issues
[none or numbered list]

### Warnings
[none or numbered list]

### Suggestions
[none or numbered list]

### Summary
[1-2 sentence overall assessment]`;
  }
}