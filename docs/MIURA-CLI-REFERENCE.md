# Miura CLI Reference

## Installation

```bash
git clone https://github.com/miura-wolf/miuraswarm.git
cd miuraswarm
bun install
bun run build
```

The binary is at `dist/miura` (or `dist/miura.exe` on Windows).

## Starting the REPL

```bash
./dist/miura
```

This opens an interactive shell. Type any `/command` or free-text to chat with the configured model.

## Command Reference

### `/chat <text>`
Send a message to the default model.
```
> /chat explain dependency injection in TypeScript
```

### `/plan <task>`
Queue a task in the scheduler.
```
> /plan implement user authentication module
```

### `/pipeline <task>`
Execute a full agent pipeline: Scout → Planner → Worker → Reviewer.
```
> /pipeline add JWT refresh token rotation
```
The pipeline runs autonomously. Reviewer outputs APPROVED or NEEDS REVISION (max 3 iterations).

### `/model [role]`
Show or configure per-role model routing.
```
> /model                          # Show all role assignments
> /model planner                  # Show planner's model
```

### `/tokens`
Show session token usage statistics.

### `/brain [clear]`
Project memory (SQLite + FTS5).
```
> /brain                          # Show memory stats
> /brain clear                    # Clear all entries
```

### `/skills`
Manage skill packs for context-aware AI prompts.
```
> /skills list                    # Show all skills by pack
> /skills init                    # Install 6 built-in skills
> /skills add ./my-skill.md       # Add custom skill
> /skills remove tdd              # Remove a skill
> /skills match "testing react"   # Match skills to context
```

**Built-in skills**: TDD, Git Commits, Code Review, Vitest, OWASP Top 10, WCAG Checklist.

### `/compaction`
Manage conversation compression strategies.
```
> /compaction list                # Show available strategies
> /compaction set sliding_window  # Use sliding window strategy
> /compaction set hybrid {"keepMessages": 25}  # With options
> /compaction config sliding_window           # Show config
> /compaction stats               # Show performance report
```

**Strategies**:
| Strategy | Behavior |
|----------|----------|
| `no_compaction` | Keep all messages |
| `sliding_window` | Keep last N messages (default: 50) |
| `summarize` | Summarize older messages with topic extraction |
| `safe_split_point` | Smart split without breaking tool_use+tool_result |
| `hybrid` | Combine sliding window + summarize |

### `/propose <title>: <description>`
Create an OpenSpec change proposal.
```
> /propose Add Remember Me: Add remember me checkbox with 30-day sessions
✅ Proposal Created
ID: `add-remember-me-a4x2`
Title: Add Remember Me
Status: draft
```

Creates `.miura/openspec/changes/{change-id}/` with `proposal.md`, `design.md`, `tasks.md`.

### `/continue [change-id]`
Continue implementation of a change.
```
> /continue                       # List active changes
> /continue add-remember-me-a4x2  # Activate and continue
```

### `/verify <change-id>`
Verify implementation against specs.
```
> /verify add-remember-me-a4x2
✅ Verification: add-remember-me-a4x2
Status: passed
Unmet: 0/3
```

### `/archive <change-id>`
Archive a completed change.
```
> /archive add-remember-me-a4x2
📦 Archived: Add Remember Me
Summary: Add persistent login sessions
Files: 4
Implemented: 3/3
```

Moves change to `.miura/openspec/changes/archive/{change-id}/`.

### `/spec`
Manage capability specs.
```
> /spec list                      # List all specs
> /spec add auth "Auth System"    # Create a new spec
> /spec search "JWT"              # Search specs by keyword
```

### `/tools`
List all registered tools (built-in + MCP + plugin).

### `/status`
Show system status: agents, tasks, pipelines, plugins, models.

### `/clear`
Clear the current session.

### `/exit`
Graceful shutdown with session persistence.

## Configuration

### Local Inference (llama-server)

```bash
export MIURA_LLAMA_SERVER_PATH=/path/to/llama-server
export MIURA_LLAMA_MODEL_PATH=/path/to/qwen2.5-coder-7b-q4_k_m.gguf
export MIURA_LLAMA_PORT=8050
export MIURA_LLAMA_GPU_LAYERS=99
export MIURA_LLAMA_CONTEXT=8192
```

### Cloud Providers

Set the corresponding API key env vars. Adapters auto-register if the key exists.

```bash
export CLAUDE_API_KEY=sk-...
export NVIDIA_NIM_API_KEY=nvapi-...
export OPENROUTER_API_KEY=sk-...
export GROQ_API_KEY=gsk_...
export GOOGLE_AI_API_KEY=...
```

## MCP Integration

### As a Client (consume external MCP tools)

```bash
# In REPL — connect to filesystem MCP server
> mcp_connect connect to "filesystem" with command "npx" args ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
```

### As a Server (expose MiuraSwarm to other agents)

```bash
cd mcp
npm install
npm run build
node dist/server.js
```

Registers in your AI client's `settings.json`:
```json
{
  "mcpServers": {
    "miuraswarm": {
      "command": "node",
      "args": ["/path/to/miuraswarm/mcp/dist/server.js"]
    }
  }
}
```

## Session Management

Sessions persist to `~/.miura/sessions/` as JSON files. Auto-persist every 30s.

Compaction triggers automatically when context window reaches 90% capacity. Configure via:
```
> /compaction set sliding_window  # Simple strategy
> /compaction set hybrid           # Balanced strategy
```

## OpenSpec Directory Structure

```
.miura/openspec/
├── specs/
│   ├── auth/
│   │   └── spec.md
│   └── database/
│       └── spec.md
└── changes/
    ├── add-remember-me/
    │   ├── proposal.md    # Summary, motivation, impact, risk
    │   ├── design.md      # Architecture, approach, ADRs
    │   ├── tasks.md       # Task breakdown by phase
    │   └── specs/         # Spec deltas
    └── archive/           # Completed changes
```

## Troubleshooting

**"No adapter found"** → Check API key env vars are set. Only llama-server works without keys.

**"Pipeline stuck"** → The StuckDetector auto-escalates. Use `/status` to check progress.

**"Session not persisting"** → Check `~/.miura/sessions/` exists and is writable.

**"MCP connection failed"** → Verify the MCP server command works standalone first. Check stderr output.

**Tests failing** → Run `bun test` for the full suite. Ensure no `.miura/` or `.openspec/` dirs from previous test runs interfere.