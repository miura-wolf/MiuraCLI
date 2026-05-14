---
name: miuraswarm
description: MiuraSwarm multi-agent orchestrator. Provides pipeline execution (Planner → Worker → Reviewer), codebase reconnaissance, and research capabilities.
---

# SKILL: MiuraSwarm

## Synopsis

Invoke MiuraSwarm pipeline orchestration from any subagent. Provides specialized agents for planning, coding, research, review, and more.

## Commands

### `miura run <task>`
Full pipeline: **Planner → Worker → Reviewer**
- Max 3 iterations (configurable)
- Automatic stuck detection
- Model escalation on failures
- Returns: Plan, Implementation, Review verdict

**Usage:**
```
/skill:miuraswarm run "fix authentication bug"
/skill:miuraswarm run "implement user dashboard" --max-iterations 5
```

### `miura plan <task>`
Create implementation plan only (no execution).

**Usage:**
```
/skill:miuraswarm plan "add dark mode support"
```

### `miura research <topic>`
Web search + technical research on a topic.

**Usage:**
```
/skill:miuraswarm research "React Server Components best practices"
/skill:miuraswarm research "PostgreSQL performance tuning" --depth deep
```

### `miura scout [path]`
Quick codebase reconnaissance.
- Scans file structure
- Identifies patterns and technologies
- Reports dependencies and architecture

**Usage:**
```
/skill:miuraswarm scout
/skill:miuraswarm scout ./src/components
/skill:miuraswarm scout --pattern "*.ts"
```

### `miura review <diff>`
Code review for a diff or code change.

**Usage:**
```
/skill:miuraswarm review <git-diff-output>
```

### `miura oracle <question>`
Decision engine for complex tradeoffs. Ask a question with competing priorities.

**Usage:**
```
/skill:miuraswarm oracle "Should we use microservices or monolith for our MVP?"
```

---

## Agent Roles

| Agent | Purpose | Best For |
|-------|---------|----------|
| **planner** | Creates implementation plans | Scope definition, breaking down tasks |
| **worker** | Executes plans, writes code | Implementation, bug fixes |
| **researcher** | Web search + technical analysis | Documentation, competitive analysis |
| **reviewer** | Code review, quality control | PR reviews, pre-merge checks |
| **scout** | Codebase reconnaissance | Exploring unfamiliar code |
| **context-builder** | Assembles project context | Setting up other agents with full context |
| **oracle** | Decision engine | Complex tradeoffs, architecture decisions |
| **delegate** | Task router | Breaking work into subtasks |

---

## Model Routing

MiuraSwarm routes each agent to the best model for the job:

| Agent | Primary Model | Fallback |
|-------|--------------|----------|
| planner | Claude Opus | Kimi K2.5 |
| worker | Claude Sonnet | DeepSeek V4 Pro → Qwen3 |
| researcher | NVIDIA NIM DeepSeek | Claude Sonnet |
| reviewer | Claude Opus | Kimi K2.5 |
| scout | Claude Haiku | Gemma 4 31B |
| context-builder | Claude Opus | Kimi K2.5 |
| oracle | Claude Opus | Kimi K2.5 |
| delegate | NVIDIA NIM Gemma | Qwen3 |

---

## Configuration

### Providers
MiuraSwarm supports three model providers:

1. **Claude** (via Anthropic API)
   - Best for: planning, review, complex decisions
   - Requires: `ANTHROPIC_API_KEY`

2. **Ollama** (local models)
   - Best for: quick tasks, cost savings
   - Requires: Ollama running locally (`localhost:11434`)
   - Models: Llama 3.1, Qwen 2.5 Coder, Code Llama, Mistral, DeepSeek Coder

3. **NVIDIA NIM** (cloud inference)
   - Best for: research, high-volume tasks
   - Requires: `NVIDIA_NIM_API_KEY`
   - Models: DeepSeek V4 Pro, Gemma 4 31B, Kimi K2.5, GLM-5.1

### Stuck Detection
The pipeline detects 4 types of being stuck:
- `error_loop` — Same error repeated → ESCALATE_MODEL
- `revision_loop` — Reviewer keeps rejecting → REFRAME_TASK
- `output_repeat` — Identical output → CHANGE_APPROACH
- `monologue` — Worker runs without review → FORCE_REVIEW

---

## Integration with Pi

This skill exposes MiuraSwarm as a **multi-agent orchestrator** for pi. Each command spawns the appropriate agents with model routing.

**Example workflow:**
1. `/skill:miuraswarm scout` → Understand the codebase
2. `/skill:miuraswarm plan "add user authentication"` → Get a plan
3. `/skill:miuraswarm run "implement the plan"` → Execute via pipeline
4. `/skill:miuraswarm review <output>` → Verify the changes

---

## Notes

- **Core has ZERO external dependencies** — The orchestration layer is self-contained
- **Event-driven** — All agent activity is emitted on the EventBus for debugging
- **Engram-safe** — READ-ONLY access to Engram memory (if integrated)
- **Plugin-based** — Adapters, agents, and integrations are swappable

## Files

```
miuraswarm/
├── extension/index.ts    ← Pi extension (registers providers + tools)
├── skill/SKILL.md        ← This file
└── mcp/server.ts         ← MCP server (advanced tools)
```