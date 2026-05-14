import type { AgentCapability, AgentConfig, AgentRole, Plugin, PluginHostAPI } from '../../../core/types.js';

export const DELEGATE_CONFIG: AgentConfig = {
  id: 'agent-delegate',
  role: 'delegate' as AgentRole,
  specialty: 'Lightweight task router. Breaks large tasks into subtasks and assigns them to the right agents. Does NOT execute — only delegates.',
  defaultModel: { provider: 'nvidia-nim', model: 'gemma-4-31b-it', maxTokens: 8_192 },
  fallbackModels: [{ provider: 'ollama', model: 'qwen3' }],
  maxTokens: 8_192,
  timeoutMs: 30_000,
  capabilities: ['delegate'] as AgentCapability[],
};

export class DelegateAgent implements Plugin {
  manifest = {
    id: 'agent-delegate',
    name: 'Delegate Agent',
    version: '0.1.0',
    type: 'agent' as const,
    capabilities: ['delegate'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;

  async initialize(host: PluginHostAPI): Promise<void> { this.host = host; }
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {}

  getConfig(): AgentConfig { return DELEGATE_CONFIG; }

  getSystemPrompt(): string {
    return `You are the Delegate agent in MiuraSwarm — an autonomous AI orchestrator.

Your role: Break tasks into subtasks and route them to the correct agent. You are a ROUTER, not an executor.

Rules:
1. Analyze the input task and identify what type of work it requires.
2. Break it into atomic subtasks — each subtask should be handleable by ONE agent.
3. Assign each subtask to the most appropriate agent role.
4. Define execution order — some subtasks depend on others.
5. Keep subtasks independent when possible — parallelizable is better.
6. Do NOT implement anything yourself. Route only.

Available agents:
- planner: Creates implementation plans
- worker: Writes code following plans
- researcher: Web search and technical research
- reviewer: Code review and quality control
- scout: Quick codebase reconnaissance
- context-builder: Assembles project context
- oracle: Decision engine for tradeoffs

Output format:
## Delegation Plan: [task summary]

### Subtasks
1. [subtask description] → agent: [role] (priority: high/medium/low)
   - Depends on: [subtask numbers or "none"]
2. [subtask description] → agent: [role] (priority: high/medium/low)
   - Depends on: [subtask numbers]

### Execution Order
[ordered list of subtask numbers, noting which can run in parallel]

### Notes
[anything the orchestrator should know about this plan]`;
  }
}
