/**
 * Shared helpers for OpenAI-compatible chat-completions adapters
 * (NVIDIA NIM, Groq, OpenRouter, llama-server, Ollama, Cerebras, Mistral,
 * SambaNova, OpenAI, ...).
 *
 * Centralizes the OpenAI tool-calling wire protocol so every provider behaves
 * identically: assistant turns carry `tool_calls`, tool turns carry
 * `tool_call_id`, and responses are parsed back into `ToolCall`s with ids.
 */

import type { LLMMessage, ToolCall, ToolDefinition } from "../../core/types.js";

/** A tool_call as it appears on the wire (request and response). */
export interface WireToolCall {
	id?: string;
	type?: "function";
	function: { name: string; arguments: string };
}

interface WireMessage {
	role: string;
	content: string | null;
	tool_calls?: WireToolCall[];
	tool_call_id?: string;
}

/**
 * Convert internal LLMMessage[] to OpenAI chat-completions messages,
 * preserving the tool-calling protocol fields.
 */
export function toOpenAIMessages(messages: LLMMessage[]): WireMessage[] {
	return messages.map((m): WireMessage => {
		// Tool result turn → role "tool" linked by tool_call_id.
		if (m.role === "tool" || m.role === "tool_result") {
			return {
				role: "tool",
				content: m.content ?? "",
				tool_call_id: m.toolCallId,
			};
		}

		// Assistant turn that requested tools → attach tool_calls.
		if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
			return {
				role: "assistant",
				content: m.content ?? "",
				tool_calls: m.toolCalls.map(toWireToolCall),
			};
		}

		return { role: m.role, content: m.content ?? "" };
	});
}

function toWireToolCall(call: ToolCall, index: number): WireToolCall {
	return {
		id: call.id ?? `call_${index}`,
		type: "function",
		function: {
			name: call.name,
			arguments: JSON.stringify(call.arguments ?? {}),
		},
	};
}

/**
 * Parse the `tool_calls` array from a response message into internal
 * ToolCalls, preserving each provider-assigned id and tolerating
 * non-JSON argument strings.
 */
export function parseToolCalls(
	rawToolCalls: WireToolCall[] | undefined | null,
): ToolCall[] {
	if (!rawToolCalls || rawToolCalls.length === 0) return [];
	return rawToolCalls.map((tc, index) => {
		let args: Record<string, unknown>;
		try {
			args = JSON.parse(tc.function.arguments || "{}");
		} catch {
			// Small models sometimes emit non-JSON args — keep the raw string.
			args = { _raw: tc.function.arguments };
		}
		return {
			id: tc.id ?? `call_${index}`,
			name: tc.function.name,
			arguments: args,
		};
	});
}

/** Transform internal tool definitions into OpenAI function-tool format. */
export function toOpenAITools(tools: ToolDefinition[] | undefined) {
	if (!tools || tools.length === 0) return undefined;
	return tools.map((t) => ({
		type: "function" as const,
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters ?? {},
		},
	}));
}
