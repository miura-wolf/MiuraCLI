import { describe, it, expect, vi, beforeEach } from "vitest";
import { LMStudioAdapter } from "./index.js";
import type { LLMMessage, ModelRef } from "../../../core/types.js";

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const LOCAL_MODEL: ModelRef = {
	provider: "lmstudio",
	model: "qwen2.5-coder-7b",
	maxTokens: 4096,
};

function okJson(body: unknown): Response {
	return {
		ok: true,
		status: 200,
		statusText: "OK",
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as unknown as Response;
}

function errStatus(status: number, text = "boom"): Response {
	return {
		ok: false,
		status,
		statusText: String(status),
		text: async () => text,
	} as unknown as Response;
}

describe("LMStudioAdapter", () => {
	let adapter: LMStudioAdapter;

	beforeEach(() => {
		mockFetch.mockReset();
		adapter = new LMStudioAdapter("http://127.0.0.1:1234/v1");
	});

	it("has correct manifest metadata", () => {
		expect(adapter.manifest.id).toBe("adapter-lmstudio");
		expect(adapter.manifest.type).toBe("adapter");
		expect(adapter.manifest.capabilities).toContain("tool_use");
	});

	it("initialize does not throw (no API key needed)", async () => {
		await expect(
			adapter.initialize({} as never),
		).resolves.toBeUndefined();
	});

	it("supports the lmstudio provider only", () => {
		expect(adapter.supports(LOCAL_MODEL)).toBe(true);
		expect(
			adapter.supports({
				provider: "ollama",
				model: "qwen2.5-coder-7b",
			}),
		).toBe(false);
		expect(
			adapter.supports({ provider: "nvidia-nim", model: "deepseek-v4" }),
		).toBe(false);
	});

	it("strips trailing slashes from baseUrl", async () => {
		// Dedicated adapter with trailing slashes — verifies the
		// constructor normalises so the request URL has exactly one /v1.
		const slashy = new LMStudioAdapter("http://127.0.0.1:1234/v1///");
		mockFetch.mockResolvedValueOnce(
			okJson({
				choices: [{ message: { content: "ok" } }],
				usage: { prompt_tokens: 1, completion_tokens: 1 },
			}),
		);
		await slashy.prompt(
			LOCAL_MODEL,
			[{ role: "user", content: "hi" }],
			{},
		);
		const url = mockFetch.mock.calls[0][0] as string;
		expect(url).toBe("http://127.0.0.1:1234/v1/chat/completions");
	});

	it("prompt POSTs to /v1/chat/completions with the right body", async () => {
		mockFetch.mockResolvedValueOnce(
			okJson({
				choices: [{ message: { content: "Hello from LM Studio" } }],
				usage: { prompt_tokens: 10, completion_tokens: 5 },
			}),
		);
		const messages: LLMMessage[] = [
			{ role: "user", content: "hi" },
		];
		const res = await adapter.prompt(LOCAL_MODEL, messages, {
			maxTokens: 256,
			temperature: 0.3,
		});
		expect(res.output).toBe("Hello from LM Studio");
		expect(res.tokenUsage).toEqual({ prompt: 10, completion: 5 });
		expect(res.model).toBe("qwen2.5-coder-7b");
		expect(res.toolCalls).toBeUndefined();

		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("http://127.0.0.1:1234/v1/chat/completions");
		expect(init.method).toBe("POST");
		const body = JSON.parse(init.body as string);
		expect(body.model).toBe("qwen2.5-coder-7b");
		expect(body.max_tokens).toBe(256);
		expect(body.temperature).toBe(0.3);
		expect(body.stream).toBe(false);
		expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
	});

	it("prompt parses tool_calls from the response", async () => {
		mockFetch.mockResolvedValueOnce(
			okJson({
				choices: [
					{
						message: {
							content: "",
							tool_calls: [
								{
									id: "call_xyz",
									type: "function",
									function: {
										name: "read_file",
										arguments: JSON.stringify({
											file_path: "src/index.ts",
										}),
									},
								},
							],
						},
					},
				],
				usage: { prompt_tokens: 5, completion_tokens: 3 },
			}),
		);
		const res = await adapter.prompt(LOCAL_MODEL, [
			{ role: "user", content: "read index" },
		], {});
		expect(res.toolCalls).toHaveLength(1);
		expect(res.toolCalls![0].id).toBe("call_xyz");
		expect(res.toolCalls![0].name).toBe("read_file");
		expect(res.toolCalls![0].arguments).toEqual({
			file_path: "src/index.ts",
		});
	});

	it("prompt wires tool definitions into the OpenAI function-tool format", async () => {
		mockFetch.mockResolvedValueOnce(
			okJson({
				choices: [{ message: { content: "ok" } }],
				usage: { prompt_tokens: 0, completion_tokens: 0 },
			}),
		);
		await adapter.prompt(LOCAL_MODEL, [{ role: "user", content: "x" }], {
			tools: [
				{
					name: "read_file",
					description: "Read a file",
					parameters: { type: "object" },
				},
			],
		});
		const body = JSON.parse(
			(mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
		);
		expect(body.tools).toHaveLength(1);
		expect(body.tools[0].type).toBe("function");
		expect(body.tools[0].function.name).toBe("read_file");
		expect(body.tool_choice).toBe("auto");
	});

	it("prompt throws on non-2xx with the upstream message", async () => {
		mockFetch.mockResolvedValueOnce(errStatus(500, "server broken"));
		await expect(
			adapter.prompt(LOCAL_MODEL, [
				{ role: "user", content: "x" },
			], {}),
		).rejects.toThrow(/LM Studio error \(500\): server broken/);
	});

	it("prompt serialises tool turns with tool_call_id (OpenAI protocol)", async () => {
		mockFetch.mockResolvedValueOnce(
			okJson({
				choices: [{ message: { content: "ok" } }],
				usage: { prompt_tokens: 0, completion_tokens: 0 },
			}),
		);
		const messages: LLMMessage[] = [
			{
				role: "assistant",
				content: "",
				toolCalls: [
					{
						id: "call_1",
						name: "read_file",
						arguments: { file_path: "x" },
					},
				],
			},
			{
				role: "tool",
				toolCallId: "call_1",
				content: "file body",
			},
		];
		await adapter.prompt(LOCAL_MODEL, messages, {});
		const body = JSON.parse(
			(mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
		);
		expect(body.messages[0].role).toBe("assistant");
		expect(body.messages[0].tool_calls[0].id).toBe("call_1");
		expect(body.messages[1].role).toBe("tool");
		expect(body.messages[1].tool_call_id).toBe("call_1");
	});

	it("listModels returns model ids from /v1/models", async () => {
		mockFetch.mockResolvedValueOnce(
			okJson({
				data: [
					{ id: "qwen2.5-coder-7b" },
					{ id: "llama-3.1-8b" },
				],
			}),
		);
		const models = await adapter.listModels();
		expect(models).toEqual(["qwen2.5-coder-7b", "llama-3.1-8b"]);
	});

	it("listModels returns [] on a non-2xx (offline server)", async () => {
		mockFetch.mockResolvedValueOnce(errStatus(503, "down"));
		expect(await adapter.listModels()).toEqual([]);
	});

	it("listModels returns [] on network error (never throws)", async () => {
		mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
		expect(await adapter.listModels()).toEqual([]);
	});

	it("stream parses SSE chunks and yields content", async () => {
		const sseChunks = [
			'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
			'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
			"data: [DONE]\n\n",
		];
		// Bun's TextDecoder reads bytes; simulate a stream whose first read
		// returns the full chunked payload.
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(sseChunks.join("")));
				controller.close();
			},
		});
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			body: stream,
		} as unknown as Response);

		const out: string[] = [];
		for await (const piece of adapter.stream(LOCAL_MODEL, [
			{ role: "user", content: "hi" },
		], {})) {
			out.push(piece);
		}
		expect(out.join("")).toBe("Hello");
	});
});
