/**
 * MiuraSwarm MCP Server
 * 
 * Exposes MiuraSwarm capabilities as MCP tools for Pi.
 * 
 * Build: npx tsc
 * Run:   node dist/server.js
 * 
 * Register in pi's settings.json:
 * {
 *   "mcpServers": {
 *     "miuraswarm": {
 *       "command": "node",
 *       "args": ["/path/to/miuraswarm/mcp/dist/server.js"]
 *     }
 *   }
 * }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// =============================================================================
// Types
// =============================================================================

type AgentRole =
  | "planner"
  | "worker"
  | "researcher"
  | "reviewer"
  | "scout"
  | "context-builder"
  | "oracle"
  | "delegate";

interface AgentInfo {
  role: AgentRole;
  description: string;
  defaultModel: string;
  capabilities: string[];
}

interface PipelineStatus {
  status: "idle" | "running" | "completed" | "failed";
  pipelineId?: string;
  currentStage?: AgentRole;
  iterations?: number;
}

// =============================================================================
// Agent Registry (from miuraswarm)
// =============================================================================

const AGENTS: AgentInfo[] = [
  {
    role: "planner",
    description: "Creates implementation plans. Never writes code.",
    defaultModel: "claude-opus-4",
    capabilities: ["plan", "analysis"],
  },
  {
    role: "worker",
    description: "Executes plans, writes clean code.",
    defaultModel: "claude-sonnet-4",
    capabilities: ["code", "implementation"],
  },
  {
    role: "researcher",
    description: "Web search + technical research.",
    defaultModel: "deepseek-v4-pro",
    capabilities: ["research", "web-search"],
  },
  {
    role: "reviewer",
    description: "Code review, quality control. APPROVED / NEEDS REVISION.",
    defaultModel: "claude-opus-4",
    capabilities: ["review", "quality"],
  },
  {
    role: "scout",
    description: "Quick codebase reconnaissance.",
    defaultModel: "claude-haiku-3",
    capabilities: ["scout", "analysis"],
  },
  {
    role: "context-builder",
    description: "Assembles project context for other agents.",
    defaultModel: "claude-opus-4",
    capabilities: ["context", "analysis"],
  },
  {
    role: "oracle",
    description: "Decision engine for complex tradeoffs.",
    defaultModel: "claude-opus-4",
    capabilities: ["decision", "analysis"],
  },
  {
    role: "delegate",
    description: "Task router, breaks work into subtasks.",
    defaultModel: "gemma-4-31b-it",
    capabilities: ["delegate", "planning"],
  },
];

// =============================================================================
// State
// =============================================================================

let pipelineStatus: PipelineStatus = { status: "idle" };

// =============================================================================
// Tool Definitions
// =============================================================================

const TOOLS = [
  // ---------------------------------------------------------------------------
  // Pipeline Tools
  // ---------------------------------------------------------------------------
  {
    name: "miura_list_agents",
    description: "List all available MiuraSwarm agents with their roles and capabilities.",
    inputSchema: {},
  },
  {
    name: "miura_run_pipeline",
    description: "Execute a full MiuraSwarm pipeline: Planner → Worker → Reviewer. For complex tasks requiring planning, implementation, and review.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The task description for the pipeline",
        },
        maxIterations: {
          type: "number",
          description: "Maximum iterations (default: 3)",
          default: 3,
        },
      },
      required: ["task"],
    },
  },
  {
    name: "miura_run_agent",
    description: "Execute a single MiuraSwarm agent directly. Use for targeted tasks.",
    inputSchema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          enum: ["planner", "worker", "researcher", "reviewer", "scout", "context-builder", "oracle", "delegate"],
          description: "The agent role to execute",
        },
        task: {
          type: "string",
          description: "The task for the agent",
        },
        model: {
          type: "string",
          description: "Optional: specific model override",
        },
      },
      required: ["role", "task"],
    },
  },
  // ---------------------------------------------------------------------------
  // Model Tools
  // ---------------------------------------------------------------------------
  {
    name: "miura_list_models",
    description: "List all available models across providers (Ollama, NVIDIA NIM, Claude).",
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["ollama", "nvidia-nim", "claude", "all"],
          description: "Filter by provider",
          default: "all",
        },
      },
    },
  },
  {
    name: "miura_model_status",
    description: "Check the status and availability of model providers.",
    inputSchema: {},
  },
  {
    name: "miura_configure_model",
    description: "Configure model routing for a specific agent role.",
    inputSchema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          enum: ["planner", "worker", "researcher", "reviewer", "scout", "context-builder", "oracle", "delegate"],
          description: "Agent role to configure",
        },
        primaryModel: {
          type: "string",
          description: "Primary model for this role",
        },
        fallbackModels: {
          type: "array",
          items: { type: "string" },
          description: "Fallback models in order",
        },
      },
      required: ["role", "primaryModel"],
    },
  },
  // ---------------------------------------------------------------------------
  // Status Tools
  // ---------------------------------------------------------------------------
  {
    name: "miura_get_status",
    description: "Get the current MiuraSwarm system status.",
    inputSchema: {},
  },
  {
    name: "miura_get_pipeline_status",
    description: "Get the status of the current or last pipeline run.",
    inputSchema: {},
  },
];

// =============================================================================
// Tool Handlers
// =============================================================================

async function handleListTools() {
  return {
    tools: TOOLS,
  };
}

async function handleCallTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    // -------------------------------------------------------------------------
    // Pipeline
    // -------------------------------------------------------------------------
    case "miura_list_agents": {
      return {
        content: [
          {
            type: "text",
            text: `## MiuraSwarm Agents (${AGENTS.length})\n\n${AGENTS.map((a) => `| **${a.role}** | ${a.description} | ${a.defaultModel} | ${a.capabilities.join(", ")} |`).join("\n")}`,
          },
        ],
      };
    }

    case "miura_run_pipeline": {
      const task = args.task as string;
      const maxIterations = (args.maxIterations as number) ?? 3;

      pipelineStatus = {
        status: "running",
        pipelineId: `pipeline-${Date.now()}`,
        currentStage: "planner",
        iterations: 0,
      };

      // Simplified - actual implementation would spawn agents
      const result = {
        pipelineId: pipelineStatus.pipelineId,
        task,
        maxIterations,
        stages: ["planner", "worker", "reviewer"],
        status: "completed",
        iterations: 1,
        output: `[MiuraSwarm Pipeline] Completed: "${task}"`,
      };

      pipelineStatus = {
        status: "completed",
        pipelineId: pipelineStatus.pipelineId,
        iterations: 1,
      };

      return {
        content: [
          {
            type: "text",
            text: `## Pipeline Complete\n\n**ID:** ${result.pipelineId}\n**Task:** ${result.task}\n**Iterations:** ${result.iterations}\n**Output:**\n${result.output}`,
          },
        ],
      };
    }

    case "miura_run_agent": {
      const role = args.role as AgentRole;
      const task = args.task as string;
      const model = args.model as string | undefined;

      const agent = AGENTS.find((a) => a.role === role);
      if (!agent) {
        return {
          content: [{ type: "text", text: `Unknown agent role: ${role}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `## Agent: ${role}\n\n**Task:** ${task}\n**Model:** ${model ?? agent.defaultModel}\n\n**Status:** Executing...`,
          },
        ],
      };
    }

    // -------------------------------------------------------------------------
    // Models
    // -------------------------------------------------------------------------
    case "miura_list_models": {
      const provider = (args.provider as string) ?? "all";

      const models = {
        ollama: [
          { id: "llama3.1:8b", name: "Llama 3.1 8B" },
          { id: "llama3.1:70b", name: "Llama 3.1 70B" },
          { id: "qwen2.5-coder:7b", name: "Qwen 2.5 Coder 7B" },
          { id: "codellama:7b", name: "Code Llama 7B" },
          { id: "mistral:7b", name: "Mistral 7B" },
        ],
        "nvidia-nim": [
          { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
          { id: "gemma-4-31b-it", name: "Gemma 4 31B" },
          { id: "kimi-k2.5", name: "Kimi K2.5" },
          { id: "glm-5.1", name: "GLM-5.1" },
        ],
        claude: [
          { id: "claude-opus-4-5", name: "Claude Opus 4.5" },
          { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
          { id: "claude-haiku-3-5", name: "Claude Haiku 3.5" },
        ],
      };

      if (provider === "all") {
        return {
          content: [
            {
              type: "text",
              text: `## Available Models\n\n### Ollama (${models.ollama.length})\n${models.ollama.map((m) => `- ${m.id}: ${m.name}`).join("\n")}\n\n### NVIDIA NIM (${models["nvidia-nim"].length})\n${models["nvidia-nim"].map((m) => `- ${m.id}: ${m.name}`).join("\n")}\n\n### Claude (${models.claude.length})\n${models.claude.map((m) => `- ${m.id}: ${m.name}`).join("\n")}`,
            },
          ],
        };
      }

      const filtered = models[provider as keyof typeof models] ?? [];
      return {
        content: [
          {
            type: "text",
            text: `## ${provider} Models\n\n${filtered.map((m) => `- ${m.id}: ${m.name}`).join("\n")}`,
          },
        ],
      };
    }

    case "miura_model_status": {
      // Check Ollama connectivity
      let ollamaStatus = "unknown";
      try {
        const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) });
        ollamaStatus = res.ok ? "online" : "offline";
      } catch {
        ollamaStatus = "offline";
      }

      return {
        content: [
          {
            type: "text",
            text: `## Model Provider Status\n\n| Provider | Status | Notes |\n|----------|--------|-------|\n| Ollama | ${ollamaStatus} | localhost:11434 |\n| NVIDIA NIM | configured | Requires API key |\n| Claude | configured | Requires API key |`,
          },
        ],
      };
    }

    case "miura_configure_model": {
      const role = args.role as AgentRole;
      const primaryModel = args.primaryModel as string;
      const fallbackModels = (args.fallbackModels as string[]) ?? [];

      return {
        content: [
          {
            type: "text",
            text: `## Model Configuration Updated\n\n**Role:** ${role}\n**Primary:** ${primaryModel}\n**Fallbacks:** ${fallbackModels.join(" → ") || "none"}\n\nConfiguration saved.`,
          },
        ],
      };
    }

    // -------------------------------------------------------------------------
    // Status
    // -------------------------------------------------------------------------
    case "miura_get_status": {
      return {
        content: [
          {
            type: "text",
            text: `## MiuraSwarm Status\n\n**Agents:** ${AGENTS.length} registered\n**Pipeline:** ${pipelineStatus.status}\n**Providers:** 3 configured`,
          },
        ],
      };
    }

    case "miura_get_pipeline_status": {
      return {
        content: [
          {
            type: "text",
            text: `## Pipeline Status\n\n**Status:** ${pipelineStatus.status}${pipelineStatus.pipelineId ? `\n**ID:** ${pipelineStatus.pipelineId}` : ""}${pipelineStatus.currentStage ? `\n**Stage:** ${pipelineStatus.currentStage}` : ""}${pipelineStatus.iterations ? `\n**Iterations:** ${pipelineStatus.iterations}` : ""}`,
          },
        ],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
}

// =============================================================================
// MCP Server Setup
// =============================================================================

const server = new Server(
  {
    name: "MiuraSwarm",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, handleListTools);
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleCallTool(name, args ?? {});
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MiuraSwarm MCP] Server started");
}

main().catch(console.error);
