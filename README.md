# MiuraSwarm

Autonomous AI agent orchestrator — CLI-first, plugin-based, event-driven.

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
├── Adapters (multi-model)
│   ├── claude         — Claude CLI via child_process
│   ├── nvidia-nim     — NVIDIA NIM REST API (DeepSeek, Gemma, Kimi, etc.)
│   └── ollama         — Local Ollama API
│
└── Integrations
    └── engram-reader  — READ-ONLY bridge to existing Engram memory
```

## Default Model Routing

| Agent | Provider | Model | Fallback |
|-------|----------|-------|----------|
| planner | claude | opus | kimi-k2.5 |
| worker | claude | sonnet | deepseek-v4-pro → qwen3 |
| researcher | nvidia-nim | deepseek-v4-pro | claude sonnet |
| reviewer | claude | opus | kimi-k2.5 |
| scout | claude | haiku | gemma-4-31b-it |
| context-builder | claude | opus | kimi-k2.5 |
| oracle | claude | opus | kimi-k2.5 |
| delegate | nvidia-nim | gemma-4-31b-it | qwen3 |

## Quick Start

```bash
npm install
npm run build
miura init
miura run "fix auth bug"
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `miura init` | Initialize MiuraSwarm in the current project |
| `miura run <task>` | Full pipeline: plan → worker → reviewer |
| `miura plan <task>` | Create implementation plan only |
| `miura research <topic>` | Web search + technical research |
| `miura scout [path]` | Quick codebase reconnaissance |
| `miura review <diff>` | Review a diff or code change |
| `miura pipeline <task>` | Custom pipeline with specified stages |
| `miura agent <role> <task>` | Run a single agent directly |
| `miura oracle <question>` | Decision engine for tradeoffs |
| `miura status` | Show system status |
| `miura config` | Show or modify configuration |

## Pipeline Flow

```
Task → Planner → Worker → Reviewer
                    ↑         │
                    └── NEEDS REVISION (max 3 iterations)
                              │
                          APPROVED → Done
```

Stuck detection kicks in after each iteration — if the loop isn't making progress, the ModelRouter escalates to a more capable model.

## Testing

```bash
npm test          # Run 30 vitest tests
npx tsc --noEmit  # Type check (0 errors)
npx oxlint src/   # Lint (0 errors)
```

## Design Principles

- **Core has ZERO dependencies** — everything else is a plugin
- **CLI-first** — every feature works from the terminal
- **Event-driven** — EventBus with wildcards + replay buffer
- **Multi-model** — route each agent to the best model for the job
- **Engram-safe** — READ-ONLY access to existing memory, never writes

## License

MIT
