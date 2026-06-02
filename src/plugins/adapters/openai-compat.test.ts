import { describe, it, expect } from "bun:test";
import {
	toOpenAIMessages,
	parseToolCalls,
	toOpenAITools,
	type WireToolCall,
} from "./openai-compat.js";
import type { LLMMessage } from "../../core/types.js";

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
