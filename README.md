# MiuraSwarm

Autonomous AI agent orchestrator — CLI-first, plugin-based, event-driven.
333 tests, 0 failures, 0 TypeScript errors.

Like Miura bulls — brave, unpredictable, relentless. Like a swarm — coordinated, adaptive, unstoppable.

## Architecture

```
MiuraSwarm
├── Core (ZERO external dependencies)
│   ├── EventBus       — Typed event emitter with wildcards + replay buffer
│   ├── AgentBus       — Agent lifecycle, health tracking, timeout enforcement
│   ├── TaskScheduler  — Priority queue with pace control + exponential backoff
│   ├── Pipeline       — Composable stages with stuck detection + iteration caps
│   ├── StuckDetector  — 4 detection types: error_loop, revision_loop, output_repeat, monologue
│   ├── ModelRouter    — Per-role routing with fallback chains + auto-escalation
│   ├── PluginHost     — Plugin registration, lifecycle, capability discovery
│   ├── ToolRegistry   — Register and execute tool handlers
│   └── StateStore     — Abstract interface (SQLite implementation in plugins)
│
├── Agents (8 specialized roles)
│   ├── planner        — Implementation plans (never writes code)
│   ├── worker         — Executes plans, writes code
│   ├── researcher     — Web search + technical reports
│   ├── reviewer       — Code review, APPROVED / NEEDS REVISION
│   ├── scout          — Quick codebase reconnaissance
│   ├── context-builder— Assembles project context for other agents
│   ├── oracle         — Decision engine for complex tradeoffs
│   └── delegate       — Task router, breaks work into subtasks
│
├── Adapters (13 LLM providers)
│   ├── llama-server   — Local inference via llama.cpp (Vulkan GPU)
│   ├── claude         — Anthropic Claude Opus/Sonnet/Haiku
│   ├── nvidia-nim     — NVIDIA NIM (DeepSeek, Gemma, Kimi, GLM)
│   ├── ollama         — Ollama (Llama, Qwen, CodeLlama, Mistral)
│   ├── openrouter     — OpenRouter multi-provider gateway
│   ├── groq           — Groq LPU (Mixtral, Llama)
│   ├── google         — Google AI (Gemini)
│   ├── cerebras       — Cerebras CS-3
│   ├── zyphra         — Zyphra
│   ├── cohere         — Cohere Command
│   ├── sambanova      — SambaNova
│   └── mistral        — Mistral AI
│
├── Plugins
│   ├── Knowledge
│   │   ├── skill-manager   — Context-aware skill injection (6 built-in skills)
│   │   ├── openspec        — Spec-Driven Development w/ OpenSpec format
│   │   └── graph-indexer   — Code graph (tree-sitter WASM + FTS5)
│   ├── Memory
│   │   ├── brain            — Project memory (SQLite + FTS5)
│   │   └── sqlite-state     — Pipeline/agent state persistence
│   ├── Integrations
│   │   ├── mcp-client       — Consume external MCP servers
│   │   └── engram-reader    — Read-only bridge to Gentle-AI Engram
│   └── Compaction
│       └── compaction-manager — 5 session history strategies
│
└── CLI (REPL with 20+ slash commands)
    ├── /chat, /plan, /pipeline — Core workflow
    ├── /skills, /compaction   — System management
    ├── /propose, /verify      — OpenSpec SDD
    └── /model, /status, /tools — Observability
```

## Quick Start

### Prerequisites

- **Bun** >= 1.3.0 (runtime)
- **Node** >= 22 (for MCP server)

### Installation

```bash
git clone https://github.com/miura-wolf/MiuraCLI.git
cd MiuraCLI
bun install
bun run build        # Compile to dist/miura (.exe on Windows)
```

### Running

```bash
# Interactive REPL
./dist/miura

# Or use the MCP server (for integration with other agents)
cd mcp && npm install && npm run build && node dist/server.js
```

## CLI Reference

### Slash Commands (REPL)

| Command | Description | Example |
|---------|-------------|---------|
| `/chat <text>` | Send message to default model | `/chat explain React hooks` |
| `/plan <task>` | Queue a task in the scheduler | `/plan implement auth` |
| `/pipeline <task>` | Full pipeline (scout→planner→worker→reviewer) | `/pipeline add login page` |
| `/model [role]` | Show/configure per-role model routing | `/model planner` |
| `/tokens` | Session token usage stats | `/tokens` |
| `/brain [clear]` | Show or clear project memory | `/brain clear` |
| `/status` | System status | `/status` |
| `/tools` | List registered tools | `/tools` |
| `/clear` | Clear session | `/clear` |
| `/exit` | Graceful shutdown | `/exit` |

### Skills System

| Command | Description |
|---------|-------------|
| `/skills list` | Show all skills by pack |
| `/skills init` | Install built-in skill packs |
| `/skills add <file>` | Add custom skill from file |
| `/skills remove <id>` | Remove a skill |
| `/skills match <ctx>` | Show skills matching context |

**6 built-in skills**: TDD (tdd.md), Git Commits (git-commits.md), Code Review (code-review.md), Vitest (vitest.md), OWASP Top 10 (owasp-top10.md), WCAG Checklist (wcag-checklist.md)

### Compaction Strategies

| Command | Description |
|---------|-------------|
| `/compaction list` | List strategies |
| `/compaction set <strategy>` | Set strategy |
| `/compaction config [strategy]` | Show configuration |
| `/compaction stats` | Show performance report |

**5 strategies**: `no_compaction`, `sliding_window` (keep last N), `summarize` (topic extraction), `safe_split_point` (preserve tool pairs), `hybrid` (combine window + summary)

### OpenSpec SDD

| Command | Description |
|---------|-------------|
| `/propose <title>: <desc>` | Create change proposal |
| `/continue [change-id]` | Continue/activate a change |
| `/verify <change-id>` | Verify against specs |
| `/archive <change-id>` | Archive completed change |
| `/spec list\|add\|search` | Manage capability specs |

**Directory structure**:
```
.miura/openspec/
├── specs/{capability}/spec.md
└── changes/{change-id}/
    ├── proposal.md       # Summary, motivation, risk, impact
    ├── design.md         # Architecture, approach, decisions
    ├── tasks.md          # Task breakdown by phase
    └── specs/            # Spec deltas
```

### MCP Client

| Tool | Description |
|------|-------------|
| `mcp_connect` | Connect to external MCP server (stdio) |
| `mcp_disconnect` | Disconnect a server |
| `mcp_list_servers` | List all connected servers |
| `mcp_disconnect_all` | Disconnect all |

**Transport**: JSON-RPC 2.0 over stdio
**Protocol**: Initialize → ListTools → CallTool / ListResources

## Pipeline Flow

```
Task → Scout → Planner → Worker → Reviewer
                            ↑         │
                            └── NEEDS REVISION (max 3 iterations)
                                      │
                                  APPROVED → Done
```

Stuck detection: error_loop, revision_loop, output_repeat, monologue — escalates model or cancels.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `MIURA_LLAMA_SERVER_PATH` | Path to llama-server binary |
| `MIURA_LLAMA_MODEL_PATH` | Path to GGUF model file |
| `MIURA_LLAMA_PORT` | Port (default: 8050) |
| `MIURA_LLAMA_GPU_LAYERS` | Vulkan GPU layers (default: 99) |
| `MIURA_LLAMA_CONTEXT` | Context size (default: 8192) |
| `CLAUDE_API_KEY` | Anthropic Claude |
| `NVIDIA_NIM_API_KEY` | NVIDIA NIM |
| `OPENROUTER_API_KEY` | OpenRouter gateway |
| `GROQ_API_KEY` | Groq LPU |
| `GOOGLE_AI_API_KEY` | Google AI / Gemini |
| `CEREBRAS_API_KEY` | Cerebras |
| `ZYPHRA_API_KEY` | Zyphra |
| `COHERE_API_KEY` | Cohere |
| `SAMBANOVA_API_KEY` | SambaNova |
| `MISTRAL_API_KEY` | Mistral AI |
| `OLLAMA_BASE_URL` | Ollama (default: http://localhost:11434) |

## Plugin System

### Three Extension Points

```
EXTENSION 1: LLM Provider (implements LLMAdapter)
  → name, supports(model), send(messages), stream?(messages)

EXTENSION 2: Tool (implements ToolHandler)
  → definition: { name, description, parameters }
  → execute(args): Promise<ToolResult>

EXTENSION 3: Memory/Compaction
  → save(key, value), load(key), search(query) — Memory interface
  → compact(messages, contextWindow) — CompactionStrategy interface
```

### Plugin Types

| Type | Examples |
|------|----------|
| `adapter` | claude, nvidia-nim, ollama (13 total) |
| `agent` | planner, worker, reviewer (8 total) |
| `memory` | sqlite-state, brain |
| `integration` | engram-reader, mcp-client |
| `knowledge` | skill-manager, openspec, graph-indexer |
| `compaction` | compaction-manager |

## Development

```bash
bun test                 # Run all 333 tests (22 files)
bun run tsc --noEmit     # TypeScript check (0 errors)
bun run build            # Compile to standalone binary
```

### Project Structure

```
src/
├── cli/                 # REPL, CommandRegistry, SessionManager
├── core/                # EventBus, AgentBus, Pipeline, ModelRouter, types
├── plugins/
│   ├── adapters/        # 13 LLM provider adapters
│   ├── agents/          # 8 agent roles
│   ├── compaction/      # Compaction strategies + plugin
│   ├── integrations/    # MCP Client, Engram Reader
│   ├── knowledge/       # Skill Manager, OpenSpec, Graph Indexer
│   ├── memory/          # Brain, SQLite State Store
│   ├── providers/       # Llama Server Manager
│   └── tools/           # Built-in tools (file-tool)
├── mcp/                 # Standalone MCP server (Node.js)
└── docs/                # ADR and architecture docs
```

### Adding a Plugin

```typescript
import { Plugin, PluginHostAPI } from '../../core/types.js';

export class MyPlugin implements Plugin {
  manifest = {
    id: 'my-plugin',
    name: 'MyPlugin',
    version: '1.0.0',
    type: 'knowledge' as const,
    capabilities: ['my-feature'],
  };

  async initialize(host: PluginHostAPI): Promise<void> {
    const tools = host.getToolRegistry();
    tools.register({
      definition: { name: 'my_tool', description: '...', parameters: {} },
      execute: async (args) => ({
        name: 'my_tool',
        output: JSON.stringify(args),
        durationMs: 0,
      }),
    });
  }
}

// Register in src/index.ts:
await this.pluginHost.register(new MyPlugin());
```

## Design Principles

- **Core has ZERO dependencies** — everything else is a plugin
- **CLI-first** — every feature works from the terminal
- **Event-driven** — EventBus with wildcards + replay buffer
- **Multi-model** — route each agent to the best model for the job
- **Local-first** — llama.cpp with Vulkan GPU, 11 cloud fallbacks
- **Engram-safe** — READ-ONLY access to existing memory, never writes

## License

MIT