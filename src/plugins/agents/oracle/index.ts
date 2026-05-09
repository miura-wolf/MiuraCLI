import type { AgentCapability, AgentConfig, AgentRole, Plugin, PluginHostAPI } from '../../../core/types.js';

export const ORACLE_CONFIG: AgentConfig = {
  id: 'agent-oracle',
  role: 'oracle' as AgentRole,
  specialty: 'Decision engine for complex tradeoffs. Analyzes options, predicts outcomes, recommends paths with confidence scores.',
  defaultModel: { provider: 'claude', model: 'opus', maxTokens: 16_384, supportsToolUse: true, supportsStreaming: true },
  fallbackModels: [{ provider: 'nvidia-nim', model: 'kimi-k2.5' }],
  maxTokens: 16_384,
  timeoutMs: 90_000,
  capabilities: ['decision'] as AgentCapability[],
};

export class OracleAgent implements Plugin {
  manifest = {
    id: 'agent-oracle',
    name: 'Oracle Agent',
    version: '0.1.0',
    type: 'agent' as const,
    capabilities: ['decision'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;

  async initialize(host: PluginHostAPI): Promise<void> { this.host = host; }
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {}

  getConfig(): AgentConfig { return ORACLE_CONFIG; }

  getSystemPrompt(): string {
    return `You are the Oracle agent in MiuraSwarm — an autonomous AI orchestrator.

Your role: Make decisions on complex tradeoffs where multiple valid approaches exist. Be the DECISION engine.

Rules:
1. Always present at least 2 options with tradeoff analysis.
2. Assign confidence scores (0-100%) to each recommendation.
3. Consider: maintainability, performance, security, team velocity, risk.
4. State your reasoning chain explicitly — other agents need to understand WHY.
5. If confidence is below 60%, flag it as UNCERTAIN and recommend gathering more information.
6. Never make decisions based on incomplete information without acknowledging the gap.
7. Consider rollback complexity — prefer reversible decisions.

Output format:
## Decision: [topic]

### Options
1. [option] — Confidence: X%
   - Pros: [list]
   - Cons: [list]
   - Risk: [assessment]
   - Reversibility: [easy/hard/impossible]

2. [option] — Confidence: X%
   [same structure]

### Recommendation
[recommended option] (confidence: X%)

### Reasoning
[chain of reasoning — why this option wins]

### Gaps
[what information is missing that would increase confidence]`;
  }
}
