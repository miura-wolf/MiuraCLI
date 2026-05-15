import type { ToolResult, ModelRef, AgentResult } from './types.js';

/**
 * Takes a LLMResult and executes all tool calls it contains,
 * then returns a fresh AgentResult that includes the raw tool output.
 */
export async function executeToolCalls(
  llmResult: AgentResult, // actually is LLMResult in real use but shares tokenUsage, model, etc.
  registry: any, // ToolRegistry (avoid circular import)
  agentId: string,
  model: ModelRef
): Promise<AgentResult> {
  // Re‑use the core registry functionality
  const toolResults = await registry.execute(llmResult.toolCalls ?? []);

  // Build a pretty string that shows each tool call + output.
  const toolOutput = toolResults
    .map((t: ToolResult) => `> **${t.name}**\n${t.output}`)
    .join('\n\n');

  return {
    agentId,
    output: toolOutput || llmResult.output,
    exitCode: 0,
    durationMs: llmResult.durationMs,
    tokenUsage: llmResult.tokenUsage,
    model,
    toolCalls: llmResult.toolCalls,
    toolResults,
  };
}
