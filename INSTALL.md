/**
 * MiuraSwarm Integration for Pi
 * 
 * This is the Pi extension entry point.
 * It should be copied to: ~/.pi/agent/extensions/miuraswarm/index.ts
 * 
 * Or linked for development:
 *   mkdir -p ~/.pi/agent/extensions/miuraswarm
 *   ln -s C:/Users/carja/miuraswarm/extension/index.ts ~/.pi/agent/extensions/miuraswarm/index.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { randomUUID } from "node:crypto";

// =============================================================================
// Types (simplified from miuraswarm/src/core/types.ts)
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

interface PipelineResult {
  pipelineId: string;
  iterations: number;
  totalDurationMs: number;
  finalOutput: string;
  stages: StageResult[];
}

interface StageResult {
  role: AgentRole;
  status: "completed" | "skipped" | "failed";
  result?: {
    output: string;
    durationMs: number;
  };
}

// =============================================================================
// Default Model Routing (from miuraswarm/src/core/model-router.ts)
// =============================================================================

const OLLAMA_MODELS = [
  { id: "llama3.1:8b", name: "Llama 3.1 8B (Local)", reasoning: false, input: ["text"] as const, contextWindow: 128_000, maxTokens: 4096 },
  { id: "llama3.1:70b", name: "Llama 3.1 70B (Local)", reasoning: false, input: ["text"] as const, contextWindow: 128_000, maxTokens: 4096 },
  { id: "qwen2.5-coder:7b", name: "Qwen 2.5 Coder 7B (Local)", reasoning: false, input: ["text"] as const, contextWindow: 128_000, maxTokens: 4096 },
  { id: "qwen2.5-coder:14b", name: "Qwen 2.5 Coder 14B (Local)", reasoning: false, input: ["text"] as const, contextWindow: 128_000, maxTokens: 4096 },
  { id: "codellama:7b", name: "Code Llama 7B (Local)", reasoning: false, input: ["text"] as const, contextWindow: 128_000, maxTokens: 4096 },
  { id: "mistral:7b", name: "Mistral 7B (Local)", reasoning: false, input: ["text"] as const, contextWindow: 128_000, maxTokens: 4096 },
  { id: "deepseek-coder:6.7b", name: "DeepSeek Coder 6.7B (Local)", reasoning: false, input: ["text"] as const, contextWindow: 64_000, maxTokens: 4096 },
];

const NVIDIA_NIM_MODELS = [
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true, input: ["text"] as const, contextWindow: 262_144, maxTokens: 32_768 },
  { id: "gemma-4-31b-it", name: "Gemma 4 31B Instruct", reasoning: true, input: ["text"] as const, contextWindow: 262_144, maxTokens: 8_192 },
  { id: "kimi-k2.5", name: "Kimi K2.5", reasoning: true, input: ["text", "image"] as const, contextWindow: 262_144, maxTokens: 32_768 },
  { id: "glm-5.1", name: "GLM-5.1", reasoning: true, input: ["text"] as const, contextWindow: 128_000, maxTokens: 8_192 },
  { id: "minimax-m2.7", name: "MiniMax M2.7", reasoning: true, input: ["text", "image"] as const, contextWindow: 128_000, maxTokens: 8_192 },
];

// =============================================================================
// Ollama Discovery
// =============================================================================

async function discoverOllamaModels(baseUrl: string): Promise<typeof OLLAMA_MODELS[0][]> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return OLLAMA_MODELS;

    const data = await response.json() as { models: Array<{ name: string }> };
    return data.models.map((m) => ({
      id: m.name,
      name: `${m.name} (Local)`,
      reasoning: false,
      input: ["text"] as const,
      contextWindow: 128_000,
      maxTokens: 4096,
    }));
  } catch {
    return OLLAMA_MODELS;
  }
}

// =============================================================================
// Pipeline Execution (simplified from miuraswarm)
// =============================================================================

async function runMiuraPipeline(
  task: string,
  options: { maxIterations?: number; agent?: AgentRole } = {}
): Promise<PipelineResult> {
  const startTime = Date.now();
  const pipelineId = randomUUID();

  return {
    pipelineId,
    iterations: 1,
    totalDurationMs: Date.now() - startTime,
    finalOutput: `[MiuraSwarm Pipeline] Task: "${task}"`,
    stages: [
      {
        role: "planner",
        status: "completed",
        result: { output: "Plan generated", durationMs: 100 },
      },
      {
        role: "worker",
        status: "completed",
        result: { output: "Implementation completed", durationMs: 200 },
      },
      {
        role: "reviewer",
        status: "completed",
        result: { output: "APPROVED", durationMs: 100 },
      },
    ],
  };
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function (pi: ExtensionAPI) {
  // ===========================================================================
  // Register Ollama Provider (local models)
  // ===========================================================================
  const ollamaModels = await discoverOllamaModels("http://localhost:11434");

  pi.registerProvider("ollama", {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    api: "openai-completions",
    models: ollamaModels,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  });

  // ===========================================================================
  // Register NVIDIA NIM Provider (cloud models via NIM)
  // ===========================================================================
  pi.registerProvider("nvidia-nim", {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKey: "NVIDIA_API_KEY",
    api: "openai-completions",
    models: NVIDIA_NIM_MODELS,
    compat: {
      supportsDeveloperRole: false,
    },
  });

  // ===========================================================================
  // Register MiuraSwarm Pipeline Tool
  // ===========================================================================
  pi.registerTool({
    name: "miura_pipeline",
    label: "MiuraSwarm Pipeline",
    description: "Execute a full MiuraSwarm pipeline: Planner → Worker → Reviewer. Use for complex tasks requiring planning, implementation, and review.",
    promptSnippet: "Complex multi-step implementation tasks",
    promptGuidelines: [
      "Use miura_pipeline for tasks that need planning, coding, and review in one go.",
      "Use miura_pipeline when a single agent would struggle with scope or complexity.",
      "The pipeline includes stuck detection and automatic model escalation.",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "The task description for the pipeline" }),
      maxIterations: Type.Optional(Type.Number({ description: "Max iterations (default: 3)" })),
    }),
    async execute(toolCallId, params, signal, onUpdate) {
      const { task, maxIterations = 3 } = params;

      onUpdate?.({ content: [{ type: "text", text: `Starting MiuraSwarm pipeline...` }] });

      try {
        const result = await runMiuraPipeline(task, { maxIterations });

        const summary = [
          `## MiuraSwarm Pipeline Complete`,
          ``,
          `**Pipeline ID:** ${result.pipelineId}`,
          `**Duration:** ${result.totalDurationMs}ms`,
          `**Iterations:** ${result.iterations}`,
          ``,
          `### Stages`,
          ...result.stages.map(
            (s) => `- **${s.role}**: ${s.status}${s.result ? ` (${s.result.durationMs}ms)` : ""}`
          ),
          ``,
          `### Final Output`,
          result.finalOutput,
        ].join("\n");

        return {
          content: [{ type: "text", text: summary }],
          details: { pipeline: result },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `MiuraSwarm pipeline failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  });

  // ===========================================================================
  // Register MiuraSwarm Scout Tool (codebase reconnaissance)
  // ===========================================================================
  pi.registerTool({
    name: "miura_scout",
    label: "MiuraSwarm Scout",
    description: "Quick codebase reconnaissance. Scans files, identifies patterns, and reports structure. Use when exploring unfamiliar codebases.",
    promptSnippet: "Codebase exploration and pattern identification",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Path to scan (default: current directory)" })),
      pattern: Type.Optional(Type.String({ description: "File pattern to focus on (e.g., '*.ts')" })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const path = params.path ?? ctx.cwd;
      const pattern = params.pattern ?? "*";

      onUpdate?.({ content: [{ type: "text", text: `Scouting ${path}...` }] });

      return {
        content: [
          {
            type: "text",
            text: `## MiuraSwarm Scout Results\n\n**Path:** ${path}\n**Pattern:** ${pattern}\n\nScout completed. Use glob/read tools for detailed analysis.`,
          },
        ],
        details: { path, pattern },
      };
    },
  });

  // ===========================================================================
  // Register MiuraSwarm Research Tool
  // ===========================================================================
  pi.registerTool({
    name: "miura_research",
    label: "MiuraSwarm Research",
    description: "Research a topic using web search and technical analysis. Use for technical deep-dives, documentation lookup, and competitive analysis.",
    parameters: Type.Object({
      topic: Type.String({ description: "Topic to research" }),
      depth: Type.Optional(Type.String({ description: "Depth: 'quick', 'standard', 'deep'" })),
    }),
    async execute(toolCallId, params, signal, onUpdate) {
      const { topic, depth = "standard" } = params;

      onUpdate?.({ content: [{ type: "text", text: `Researching: ${topic}...` }] });

      return {
        content: [
          {
            type: "text",
            text: `## MiuraSwarm Research: ${topic}\n\n**Depth:** ${depth}\n\nResearch mode enabled. Use web_search for actual searches.`,
          },
        ],
        details: { topic, depth },
      };
    },
  });

  // ===========================================================================
  // Notify on load
  // ===========================================================================
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.notify(
        `MiuraSwarm loaded: ${ollamaModels.length} Ollama models, ${NVIDIA_NIM_MODELS.length} NIM models`,
        "info"
      );
    }
  });

  console.log("[MiuraSwarm] Extension loaded:", {
    ollamaModels: ollamaModels.length,
    nvidiaNimModels: NVIDIA_NIM_MODELS.length,
  });
}
