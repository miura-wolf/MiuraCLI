import type { ToolResult, ModelRef, AgentResult } from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";

/**
 * Takes a LLMResult and executes all tool calls it contains,
 * then returns a fresh AgentResult that includes the raw tool output.
 */
export async function executeToolCalls(
	llmResult: AgentResult,
	registry: ToolRegistry,
	agentId: string,
	model: ModelRef,
	ctx?: { requestedBy?: string },
): Promise<AgentResult> {
	const toolResults = await registry.execute(llmResult.toolCalls ?? [], ctx);
	const toolOutput = toolResults
		.map((t: ToolResult) => `> **${t.name}**\n${t.output}`)
		.join("\n\n");
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
