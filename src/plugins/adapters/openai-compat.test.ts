import { describe, it, expect, vi, beforeEach } from "bun:test";
import {
	toOpenAIMessages,
	parseToolCalls,
	toOpenAITools,
	streamOpenAIChat,
	finaliseToolCall,
	type WireToolCall,
} from "./openai-compat.js";
import type { LLMMessage } from "../../core/types.js";

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe("openai-compat: toOpenAIMessages", () => {
	it("passes through plain system/user/assistant turns", () => {
		const msgs: LLMMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "hello" },
		];
		expect(toOpenAIMessages(msgs)).toEqual([
			{ role: "system", content: "sys" },
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "hello" },
		]);
	});

	it("emits tool_calls on an assistant turn that requested tools", () => {
		const msgs: LLMMessage[] = [
			{
				role: "assistant",
				content: "",
				toolCalls: [
					{ id: "call_abc", name: "read_file", arguments: { file_path: "a.ts" } },
				],
			},
		];
		const wire = toOpenAIMessages(msgs);
		expect(wire[0].role).toBe("assistant");
		expect(wire[0].tool_calls).toHaveLength(1);
		expect(wire[0].tool_calls![0].id).toBe("call_abc");
		expect(wire[0].tool_calls![0].type).toBe("function");
		expect(wire[0].tool_calls![0].function.name).toBe("read_file");
		// arguments must be a JSON *string* on the wire
		expect(JSON.parse(wire[0].tool_calls![0].function.arguments)).toEqual({
			file_path: "a.ts",
		});
	});

	it("links a tool-result turn back via tool_call_id", () => {
		const msgs: LLMMessage[] = [
			{ role: "tool", toolCallId: "call_abc", content: "file contents" },
		];
		const wire = toOpenAIMessages(msgs);
		expect(wire[0]).toEqual({
			role: "tool",
			content: "file contents",
			tool_call_id: "call_abc",
		});
	});

	it("synthesizes an id when the assistant tool call lacks one", () => {
		const msgs: LLMMessage[] = [
			{
				role: "assistant",
				content: "",
				toolCalls: [{ name: "grep", arguments: { pattern: "x" } }],
			},
		];
		const wire = toOpenAIMessages(msgs);
		expect(wire[0].tool_calls![0].id).toBe("call_0");
	});
});

describe("openai-compat: parseToolCalls", () => {
	it("parses tool calls preserving the provider id", () => {
		const raw: WireToolCall[] = [
			{
				id: "call_xyz",
				type: "function",
				function: { name: "glob", arguments: '{"pattern":"**/*.ts"}' },
			},
		];
		const calls = parseToolCalls(raw);
		expect(calls).toEqual([
			{ id: "call_xyz", name: "glob", arguments: { pattern: "**/*.ts" } },
		]);
	});

	it("keeps the raw string when arguments are not valid JSON", () => {
		const raw: WireToolCall[] = [
			{ id: "c1", function: { name: "bad", arguments: "not-json" } },
		];
		const calls = parseToolCalls(raw);
		expect(calls[0].arguments).toEqual({ _raw: "not-json" });
	});

	it("returns an empty array for missing tool_calls", () => {
		expect(parseToolCalls(undefined)).toEqual([]);
		expect(parseToolCalls(null)).toEqual([]);
		expect(parseToolCalls([])).toEqual([]);
	});
});

describe("openai-compat: toOpenAITools", () => {
	it("wraps tool definitions in the function envelope", () => {
		const wire = toOpenAITools([
			{ name: "read_file", description: "read", parameters: { type: "object" } },
		]);
		expect(wire).toEqual([
			{
				type: "function",
				function: {
					name: "read_file",
					description: "read",
					parameters: { type: "object" },
				},
			},
		]);
	});

	it("returns undefined when there are no tools", () => {
		expect(toOpenAITools(undefined)).toBeUndefined();
		expect(toOpenAITools([])).toBeUndefined();
	});
});

describe("openai-compat: round-trip ReAct turn", () => {
	it("a parsed tool call feeds back into a valid assistant+tool pair", () => {
		// Simulate: model returns a tool call, loop executes it, next request
		// must carry assistant.tool_calls + a matching tool.tool_call_id.
		const parsed = parseToolCalls([
			{ id: "call_1", function: { name: "read_file", arguments: '{"file_path":"x"}' } },
		]);
		const nextTurn: LLMMessage[] = [
			{ role: "assistant", content: "", toolCalls: parsed },
			{ role: "tool", toolCallId: parsed[0].id, content: "result" },
		];
		const wire = toOpenAIMessages(nextTurn);
		expect(wire[0].tool_calls![0].id).toBe("call_1");
		expect(wire[1].tool_call_id).toBe("call_1");
	});
});

describe("openai-compat: finaliseToolCall", () => {
	it("parses _raw argument string into an object", () => {
		const tc = {
			id: "c1",
			name: "read_file",
			arguments: { _raw: '{"file_path":"a.ts"}' },
		};
		const out = finaliseToolCall(tc);
		expect(out.arguments).toEqual({ file_path: "a.ts" });
	});
	it("keeps malformed JSON as _raw (small-model tolerance)", () => {
		const tc = {
			id: "c1",
			name: "bad",
			arguments: { _raw: "not-json" },
		};
		expect(finaliseToolCall(tc).arguments).toEqual({ _raw: "not-json" });
	});
	it("passes through already-parsed arguments", () => {
		const tc = { id: "c1", name: "x", arguments: { a: 1 } };
		expect(finaliseToolCall(tc)).toEqual(tc);
	});
});

describe("openai-compat: streamOpenAIChat", () => {
	beforeEach(() => {
		mockFetch.mockReset();
	});

	function sseResponse(chunks: string[]): Response {
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(chunks.join("")));
				controller.close();
			},
		});
		return {
			ok: true,
			status: 200,
			body: stream,
		} as unknown as Response;
	}

	it("yields content chunks and a final done for a text-only stream", async () => {
		const sse = [
			'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
			'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
			"data: [DONE]\n\n",
		];
		mockFetch.mockResolvedValueOnce(sseResponse(sse));

		const out: string[] = [];
		let doneChunk: { done?: boolean; usage?: unknown } | undefined;
		for await (const c of streamOpenAIChat("https://x/v1/chat", {}, {})) {
			if (c.content) out.push(c.content);
			if (c.done) doneChunk = c;
		}
		expect(out.join("")).toBe("Hello");
		expect(doneChunk?.done).toBe(true);
	});

	it("forces stream:true on the request body", async () => {
		mockFetch.mockResolvedValueOnce(
			sseResponse(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n', "data: [DONE]\n\n"]),
		);
		for await (const _c of streamOpenAIChat("https://x/v1/chat", {}, { stream: false })) {
			// drain
		}
		const init = mockFetch.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init[1].body as string);
		expect(body.stream).toBe(true);
	});

	it("reassembles tool-call fragments by index and emits finalised", async () => {
		// Two tool calls, each split across multiple chunks.
		const sse = [
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"read_file","arguments":""}}]}}]}\n\n',
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"file"}}]}}]}\n\n',
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"_path\\":\\"x\\"}"}}]}}]}\n\n',
			'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","function":{"name":"glob","arguments":""}}]}}]}\n\n',
			'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{\\"pattern\\":\\"**/*.ts\\"}"}}]}}]}\n\n',
			"data: [DONE]\n\n",
		];
		mockFetch.mockResolvedValueOnce(sseResponse(sse));

		const toolCalls: Array<{ id?: string; name?: string; arguments?: unknown }> = [];
		for await (const c of streamOpenAIChat("https://x/v1/chat", {}, {})) {
			if (c.toolCall) {
				toolCalls.push({
					id: c.toolCall.id,
					name: c.toolCall.name,
					arguments: c.toolCall.arguments,
				});
			}
		}
		expect(toolCalls).toHaveLength(2);
		expect(toolCalls[0].id).toBe("call_a");
		expect(toolCalls[0].name).toBe("read_file");
		expect(toolCalls[1].id).toBe("call_b");
		expect(toolCalls[1].name).toBe("glob");
	});

	it("captures usage from the final chunk", async () => {
		const sse = [
			'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
			'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n',
			"data: [DONE]\n\n",
		];
		mockFetch.mockResolvedValueOnce(sseResponse(sse));
		let usage: { prompt?: number; completion?: number } | undefined;
		for await (const c of streamOpenAIChat("https://x/v1/chat", {}, {})) {
			if (c.done) usage = c.usage;
		}
		expect(usage).toEqual({ prompt: 7, completion: 3 });
	});

	it("throws on non-2xx with the upstream status", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 502,
			text: async () => "bad gateway",
		} as unknown as Response);
		await expect(async () => {
			for await (const _c of streamOpenAIChat("https://x/v1/chat", {}, {})) {
				/* drain */
			}
		}).toThrow(/502/);
	});

	it("flushes accumulated tool calls on abrupt end (no [DONE])", async () => {
		const sse = [
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_z","function":{"name":"a","arguments":"{}"}}]}}]}\n\n',
		];
		mockFetch.mockResolvedValueOnce(sseResponse(sse));
		const toolCalls: Array<{ id?: string; name?: string }> = [];
		for await (const c of streamOpenAIChat("https://x/v1/chat", {}, {})) {
			if (c.toolCall) toolCalls.push({ id: c.toolCall.id, name: c.toolCall.name });
			if (c.done) {/* expect a done chunk via the finally flush */}
		}
		expect(toolCalls).toEqual([{ id: "call_z", name: "a" }]);
	});
});
