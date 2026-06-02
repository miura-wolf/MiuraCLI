import { describe, it, expect, vi } from "bun:test";
import { executeToolCalls, type ToolBatchExecutor } from "./tool-executor.js";
import type { ToolCall, ToolResult } from "./types.js";

function makeMockRegistry(): ToolBatchExecutor & {
	execute: ReturnType<typeof vi.fn>;
} {
	return {
		execute: vi.fn(async (calls: ToolCall[]): Promise<ToolResult[]> => {
			return calls.map((c) => ({
				name: c.name,
				output: `executed:${c.name}`,
				durationMs: 0,
			}));
		}),
	};
}

describe("executeToolCalls: valid calls", () => {
	it("executes a single valid call", async () => {
		const reg = makeMockRegistry();
		const calls: ToolCall[] = [{ id: "1", name: "read_file", arguments: {} }];
		const results = await executeToolCalls(reg, calls);
		expect(results).toHaveLength(1);
		expect(results[0]?.name).toBe("read_file");
		expect(results[0]?.output).toBe("executed:read_file");
		expect(results[0]?.error).toBeUndefined();
	});

	it("preserves order across multiple valid calls", async () => {
		const reg = makeMockRegistry();
		const calls: ToolCall[] = [
			{ id: "1", name: "a", arguments: {} },
			{ id: "2", name: "b", arguments: {} },
			{ id: "3", name: "c", arguments: {} },
		];
		const results = await executeToolCalls(reg, calls);
		expect(results.map((r) => r.name)).toEqual(["a", "b", "c"]);
	});

	it("handles an empty call list without invoking the registry", async () => {
		const reg = makeMockRegistry();
		const results = await executeToolCalls(reg, []);
		expect(results).toEqual([]);
		expect(reg.execute).not.toHaveBeenCalled();
	});
});

describe("executeToolCalls: invalid args short-circuit", () => {
	it("does not invoke the registry for a call with invalidArgs", async () => {
		const reg = makeMockRegistry();
		const calls: ToolCall[] = [
			{
				id: "1",
				name: "read_file",
				arguments: {},
				invalidArgs: { reason: "Unexpected token", received: "{garbage" },
			},
		];
		const results = await executeToolCalls(reg, calls);
		expect(reg.execute).not.toHaveBeenCalled();
		expect(results).toHaveLength(1);
		expect(results[0]?.error).toBe("invalid_args");
	});

	it("includes the reason and the received string in the error output", async () => {
		const reg = makeMockRegistry();
		const calls: ToolCall[] = [
			{
				id: "1",
				name: "x",
				arguments: {},
				invalidArgs: {
					reason: "Unexpected end of JSON input",
					received: "{file_path: a.ts",
				},
			},
		];
		const results = await executeToolCalls(reg, calls);
		expect(results[0]?.output).toContain("Unexpected end of JSON input");
		expect(results[0]?.output).toContain("{file_path: a.ts");
		expect(results[0]?.output).toContain("Please retry with valid JSON");
	});
});

describe("executeToolCalls: mixed valid + invalid", () => {
	it("only forwards valid calls to the registry, but keeps slot order", async () => {
		const reg = makeMockRegistry();
		const validA: ToolCall = { id: "1", name: "a", arguments: {} };
		const invalidB: ToolCall = {
			id: "2",
			name: "b",
			arguments: {},
			invalidArgs: { reason: "bad", received: "x" },
		};
		const validC: ToolCall = { id: "3", name: "c", arguments: {} };
		const results = await executeToolCalls(reg, [validA, invalidB, validC]);

		// Registry was called with only the valid ones, preserving order.
		expect(reg.execute).toHaveBeenCalledTimes(1);
		expect(reg.execute).toHaveBeenCalledWith([validA, validC]);

		// Results match input order.
		expect(results).toHaveLength(3);
		expect(results[0]?.name).toBe("a");
		expect(results[0]?.error).toBeUndefined();
		expect(results[1]?.name).toBe("b");
		expect(results[1]?.error).toBe("invalid_args");
		expect(results[2]?.name).toBe("c");
		expect(results[2]?.error).toBeUndefined();
	});

	it("all-invalid list: registry is never invoked", async () => {
		const reg = makeMockRegistry();
		const calls: ToolCall[] = [
			{ id: "1", name: "a", arguments: {}, invalidArgs: { reason: "x", received: "y" } },
			{ id: "2", name: "b", arguments: {}, invalidArgs: { reason: "x", received: "y" } },
		];
		const results = await executeToolCalls(reg, calls);
		expect(reg.execute).not.toHaveBeenCalled();
		expect(results.every((r) => r.error === "invalid_args")).toBe(true);
	});
});
