/**
 * Shared helpers for OpenAI-compatible chat-completions adapters
 * (NVIDIA NIM, Groq, OpenRouter, llama-server, Ollama, Cerebras, Mistral,
 * SambaNova, OpenAI, ...).
 *
 * Centralizes the OpenAI tool-calling wire protocol so every provider behaves
 * identically: assistant turns carry `tool_calls`, tool turns carry
 * `tool_call_id`, and responses are parsed back into `ToolCall`s with ids.
 */

import type {
	LLMMessage,
	ToolCall,
	ToolDefinition,
	ChatChunk,
} from "../../core/types.js";

// Re-export ChatChunk so adapters that import from openai-compat don't
// have to dig into core/types for the streaming shape.
export type { ChatChunk };

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

// Re-export ChatChunk so adapters that import from openai-compat don't
// have to dig into core/types for the streaming shape.
// (declaration is at the top of the file; kept as a comment for grep-discoverability)

/**
 * Stream an OpenAI-compatible chat-completions request and yield typed
 * `ChatChunk`s. Parses SSE (`data: {json}` lines), accumulates incremental
 * tool-call fragments by index, and emits each tool call once it's complete
 * (signalled by a different tool index arriving, the stream ending, or an
 * explicit `[DONE]` marker).
 *
 * `body` is the OpenAI-shape request body; this function forces
 * `stream: true` regardless of what the caller set. Tools should be
 * pre-serialised via `toOpenAITools(options.tools)` by the caller.
 */
export async function* streamOpenAIChat(
	url: string,
	headers: Record<string, string>,
	body: Record<string, unknown>,
): AsyncGenerator<ChatChunk> {
	const wireBody = { ...body, stream: true };

	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(wireBody),
	});

	if (!res.ok) {
		throw new Error(`OpenAI-compat stream error (${res.status})`);
	}

	const reader = res.body?.getReader();
	if (!reader) return;

	const decoder = new TextDecoder();
	// index → partial ToolCall. Keyed by the streaming `index` so we can
	// reassemble fragments that arrive in different chunks.
	const partials = new Map<number, ToolCall>();
	// Buffer for SSE lines that span read boundaries.
	let buffer = "";
	let usage: { prompt?: number; completion?: number } | undefined;

	function flushFinishedToolCalls(forceAll = false): ToolCall[] {
		// A tool call is "finished" if the stream has ended (forceAll) or
		// if a new index arrives that supersedes the current one. With
		// OpenAI's protocol, the provider sends fragments in order, so
		// the conservative approach is: emit on stream end. Mid-stream
		// we only emit when a *new* index shows up.
		if (forceAll) {
			const all = Array.from(partials.values());
			partials.clear();
			return all;
		}
		return [];
	}

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			// SSE events are separated by a blank line. We process line-by-line
			// here for simplicity — partial lines stay in `buffer`.
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const raw of lines) {
				const line = raw.trim();
				if (!line.startsWith("data:")) continue;
				const payload = line.slice(5).trim();
				if (!payload) continue;
				if (payload === "[DONE]") {
					// Stream end. Emit every partial we accumulated.
					for (const tc of flushFinishedToolCalls(true)) {
						yield { toolCall: tc };
					}
					yield { done: true, usage };
					return;
				}

				let parsed: {
					choices?: Array<{
						delta?: {
							content?: string | null;
							tool_calls?: Array<{
								index: number;
								id?: string;
								type?: "function";
								function?: { name?: string; arguments?: string };
							}>;
						};
					}>;
					usage?: { prompt_tokens?: number; completion_tokens?: number };
				};
				try {
					parsed = JSON.parse(payload);
				} catch {
					continue;
				}

				// Usage may arrive in the final chunk.
				if (parsed.usage) {
					usage = {
						prompt: parsed.usage.prompt_tokens,
						completion: parsed.usage.completion_tokens,
					};
				}

				const choice = parsed.choices?.[0];
				if (!choice?.delta) continue;

				// 1. Text content.
				const content = choice.delta.content;
				if (typeof content === "string" && content.length > 0) {
					yield { content };
				}

				// 2. Tool-call fragments.
				const deltas = choice.delta.tool_calls;
				if (deltas && deltas.length > 0) {
					for (const d of deltas) {
						const existing = partials.get(d.index);
						if (existing) {
							// Update name if this fragment brought it.
							if (d.function?.name) existing.name = d.function.name;
							// Append arguments. Providers split them across chunks.
							if (d.function?.arguments) {
								// We can't stream-merge partial JSON, so we
								// buffer the raw string and parse at the end.
								const prevRaw = (existing.arguments as { _raw?: string })?._raw ?? "";
								existing.arguments = { _raw: prevRaw + d.function.arguments };
							}
						} else {
							partials.set(d.index, {
								id: d.id,
								name: d.function?.name ?? "",
								arguments: d.function?.arguments
									? { _raw: d.function.arguments }
									: {},
							});
						}
					}
				}
			}
		}
	} finally {
		// If the stream ended without [DONE] (some providers), flush.
		if (partials.size > 0) {
			for (const tc of Array.from(partials.values())) {
				yield { toolCall: tc };
			}
			yield { done: true, usage };
		}
	}
}

/**
 * Finalise a buffered tool call (parse its `_raw` argument string into
 * an object). Returns a new ToolCall with parsed arguments.
 */
export function finaliseToolCall(tc: ToolCall): ToolCall {
	if (tc.arguments && typeof (tc.arguments as any)._raw === "string") {
		const raw = (tc.arguments as any)._raw as string;
		try {
			return { ...tc, arguments: JSON.parse(raw) };
		} catch {
			// Keep the raw form if JSON is malformed (small models).
			return tc;
		}
	}
	return tc;
}
