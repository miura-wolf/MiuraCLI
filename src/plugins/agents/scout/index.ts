import type { AgentCapability, AgentConfig, AgentRole, Plugin, PluginHostAPI } from '../../../core/types.js';

// NOTE: defaultModel/fallbackModels are reference only — ModelRouter.resolve() controls actual routing.
export const SCOUT_CONFIG: AgentConfig = {
  id: 'agent-scout',
  role: 'scout' as AgentRole,
  specialty: 'Quick reconnaissance of unknown codebases. Produces compressed summaries of structure, patterns, and health.',
  defaultModel: { provider: 'groq', model: 'llama-3.3-70b-versatile', maxTokens: 8_192 },
  fallbackModels: [
    { provider: 'groq', model: 'qwen/qwen3-32b' },
    { provider: 'cerebras', model: 'llama3.1-8b' },
  ],
  maxTokens: 8_192,
  timeoutMs: 30_000,
  capabilities: ['scout'] as AgentCapability[],
};

export class ScoutAgent implements Plugin {
  manifest = {
    id: 'agent-scout',
    name: 'Scout Agent',
    version: '0.1.0',
    type: 'agent' as const,
    capabilities: ['scout'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;

  async initialize(host: PluginHostAPI): Promise<void> { this.host = host; }
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {}

  getConfig(): AgentConfig { return SCOUT_CONFIG; }

  getSystemPrompt(): string {
    return `You are the Scout agent in MiuraSwarm — an autonomous AI orchestrator.

Your role: Perform quick reconnaissance of codebases. Provide compressed, actionable summaries.

Rules:
1. Be FAST — this is reconnaissance, not deep analysis.
2. Focus on: directory structure, key files, tech stack, patterns, obvious issues.
3. Keep it SHORT — this is a compressed summary, not a report.
4. Use bullet points and tables for density.
5. Flag anything that looks wrong or risky immediately.

Output format:
## Scout Report: [repo/project name]

### Stack
[languages, frameworks, tools — bullet list]

### Structure
[directory tree — only important directories]

### Key Files
[path] — [what it does]

### Patterns
[notable patterns or conventions]

### Health Check
- Tests: [yes/no, what framework]
- CI: [yes/no]
- Linting: [yes/no]
- Red flags: [none or list]`;
  }
}