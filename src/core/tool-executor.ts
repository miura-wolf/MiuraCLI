import type { ToolCall, ToolResult } from "./types.js";

/**
 * Minimal interface for anything that can run a batch of tool calls.
 * `ToolRegistry` satisfies it; tests can pass a tiny mock.
 */
export interface ToolBatchExecutor {
	execute(calls: ToolCall[]): Promise<ToolResult[]>;
}

/**
 * Execute a batch of tool calls. Calls whose arguments couldn't be
 * parsed/repaired (`invalidArgs` set) are short-circuited with a
 * synthetic error result that tells the model exactly what went wrong
 * and what it sent — so the runAgent loop can hand the message back
 * in the next tool turn and let the model self-correct.
 *
 * The returned array preserves the order and length of the input: for
 * each input call there's exactly one result, in the same position.
 */
export async function executeToolCalls(
	registry: ToolBatchExecutor,
	calls: ToolCall[],
): Promise<ToolResult[]> {
	const slots: (ToolResult | null)[] = Array.from(
		{ length: calls.length },
		() => null,
	);
	const validCalls: ToolCall[] = [];
	const validIndices: number[] = [];

	calls.forEach((call, i) => {
		if (call.invalidArgs) {
			slots[i] = {
				name: call.name,
				output: `Invalid arguments (could not parse as JSON): ${call.invalidArgs.reason}. You sent: ${call.invalidArgs.received}. Please retry with valid JSON.`,
				error: "invalid_args",
				durationMs: 0,
			};
		} else {
			validCalls.push(call);
			validIndices.push(i);
		}
	});

	if (validCalls.length > 0) {
		const execResults = await registry.execute(validCalls);
		execResults.forEach((r, j) => {
			slots[validIndices[j]!] = r;
		});
	}

	return slots as ToolResult[];
}
