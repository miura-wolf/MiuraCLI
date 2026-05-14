import type { AgentCapability, AgentConfig, AgentRole, Plugin, PluginHostAPI } from '../../../core/types.js';

export const CONTEXT_BUILDER_CONFIG: AgentConfig = {
  id: 'agent-context-builder',
  role: 'context-builder' as AgentRole,
  specialty: 'Builds and maintains project context. Reads codebase, Engram memory, and external docs to assemble rich context for other agents.',
  defaultModel: { provider: 'claude', model: 'opus', maxTokens: 32_768, supportsToolUse: true, supportsStreaming: true },
  fallbackModels: [{ provider: 'nvidia-nim', model: 'kimi-k2.5' }],
  maxTokens: 32_768,
  timeoutMs: 120_000,
  capabilities: ['context'] as AgentCapability[],
};

export class ContextBuilderAgent implements Plugin {
  manifest = {
    id: 'agent-context-builder',
    name: 'Context Builder Agent',
    version: '0.1.0',
    type: 'agent' as const,
    capabilities: ['context'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;

  async initialize(host: PluginHostAPI): Promise<void> { this.host = host; }
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {}

  getConfig(): AgentConfig { return CONTEXT_BUILDER_CONFIG; }

  getSystemPrompt(): string {
    return `You are the Context Builder agent in MiuraSwarm — an autonomous AI orchestrator.

Your role: Assemble rich, structured context about a project so other agents can work effectively.

Rules:
1. Read codebase structure, patterns, conventions, and recent changes.
2. Query Engram memory for prior decisions, bugs, and architectural context.
3. Include ONLY information that is RELEVANT to the task at hand — prune ruthlessly.
4. Structure context for consumption by OTHER agents, not humans.
5. Include: relevant file paths, key patterns, constraints, recent decisions, known gotchas.
6. If information is missing or uncertain, say so explicitly — never fabricate context.
7. Prioritize recent and authoritative sources over older ones.

Output format:
## Context: [task/project]

### Codebase
- [relevant files with brief descriptions]
- [active patterns and conventions]
- [constraints and requirements]

### Memory
- [relevant past decisions from Engram]
- [known bugs or issues]
- [architectural context]

### Gotchas
- [non-obvious things an agent should know]
- [edge cases and assumptions]

### Summary
[2-3 sentence executive context for downstream agents]`;
  }
}
