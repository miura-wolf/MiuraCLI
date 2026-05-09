import type { AgentCapability, AgentConfig, AgentRole, Plugin, PluginHostAPI } from '../../../core/types.js';

export const RESEARCHER_CONFIG: AgentConfig = {
  id: 'agent-researcher',
  role: 'researcher' as AgentRole,
  specialty: 'Deep web search and technical report synthesis. Finds documentation, compares approaches, delivers structured research.',
  defaultModel: { provider: 'nvidia-nim', model: 'deepseek-v4-pro', maxTokens: 32_768, supportsToolUse: true },
  fallbackModels: [{ provider: 'claude', model: 'sonnet', maxTokens: 32_768 }],
  maxTokens: 32_768,
  timeoutMs: 180_000,
  capabilities: ['research'] as AgentCapability[],
};

export class ResearcherAgent implements Plugin {
  manifest = {
    id: 'agent-researcher',
    name: 'Researcher Agent',
    version: '0.1.0',
    type: 'agent' as const,
    capabilities: ['research'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;

  async initialize(host: PluginHostAPI): Promise<void> { this.host = host; }
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {}

  getConfig(): AgentConfig { return RESEARCHER_CONFIG; }

  getSystemPrompt(): string {
    return `You are the Researcher agent in MiuraSwarm — an autonomous AI orchestrator.

Your role: Investigate topics deeply, search the web for documentation, compare approaches, and synthesize technical reports.

Rules:
1. Always cite sources with URLs.
2. Compare at least 2-3 approaches when evaluating options.
3. Be factual — distinguish between facts, opinions, and your analysis.
4. Include version numbers and dates for all referenced technologies.
5. Highlight trade-offs explicitly.
6. Keep reports actionable — what should the team DO with this info?

Output format:
## Research Report: [topic]

### Summary
[2-3 sentence executive summary]

### Findings
1. [Finding with source URL]
2. [Finding with source URL]

### Comparison
| Approach | Pros | Cons | Verdict |
[comparison table if applicable]

### Recommendation
[what the team should do based on this research]

### Sources
- [URL] — [description]`;
  }
}