// LM Studio adapter — local models via its OpenAI-compatible server.
// LM Studio exposes http://localhost:1234/v1 (configurable via LMSTUDIO_BASE_URL).
// No API key required; bearer header is omitted.
import type {
	LLMAdapter,
	LLMMessage,
	LLMOptions,
	LLMResult,
	ModelRef,
	PluginHostAPI,
} from "../../../core/types.js";
import {
	parseToolCalls,
	toOpenAIMessages,
	toOpenAITools,
	type WireToolCall,
} from "../openai-compat.js";

const DEFAULT_BASE_URL = "http://localhost:1234/v1";

export class LMStudioAdapter implements LLMAdapter {
	manifest = {
		id: "adapter-lmstudio",
		name: "LM Studio Local Adapter",
		version: "0.1.0",
		type: "adapter" as const,
		capabilities: ["code", "delegate", "scout", "research", "tool_use"],
		dependencies: [] as string[],
	};

	private host: PluginHostAPI | null = null;
	private baseUrl: string;

	constructor(baseUrl?: string) {
		this.baseUrl = (baseUrl ?? process.env.LMSTUDIO_BASE_URL ?? DEFAULT_BASE_URL)
			.replace(/\/+$/, "");
	}

	async initialize(host: PluginHostAPI): Promise<void> {
		this.host = host;
		// No API key to validate. We do not call /v1/models at init time
		// because LM Studio may be offline — the router will surface a
		// clear error at first prompt() if it can't reach the server.
	}

	async activate(): Promise<void> {}
	async deactivate(): Promise<void> {}
	async unload(): Promise<void> {}

	supports(model: ModelRef): boolean {
		return model.provider === "lmstudio";
	}

	async prompt(
		model: ModelRef,
		messages: LLMMessage[],
		options: LLMOptions,
	): Promise<LLMResult> {
		const start = Date.now();

		const body: Record<string, unknown> = {
			model: model.model,
			messages: toOpenAIMessages(messages),
			max_tokens: options.maxTokens ?? 4096,
			temperature: options.temperature ?? 0.7,
			stream: false,
		};

		const wireTools = toOpenAITools(options.tools);
		if (wireTools) {
			body.tools = wireTools;
			body.tool_choice = "auto";
		}

		const res = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			throw new Error(
				`LM Studio error (${res.status}): ${await res.text()}`,
			);
		}

		const data = (await res.json()) as {
			choices: Array<{
				message: {
					content: string | null;
					tool_calls?: WireToolCall[];
				};
			}>;
			usage?: { prompt_tokens?: number; completion_tokens?: number };
		};

		const choice = data.choices[0];
		const message = choice?.message ?? { content: null };

		const toolCalls = parseToolCalls(message.tool_calls);

		return {
			output: message.content ?? "",
			tokenUsage: {
				prompt: data.usage?.prompt_tokens ?? 0,
				completion: data.usage?.completion_tokens ?? 0,
			},
			model: model.model,
			durationMs: Date.now() - start,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
		};
	}

	async *stream(
		model: ModelRef,
		messages: LLMMessage[],
		options: LLMOptions,
	): AsyncGenerator<string> {
		const body: Record<string, unknown> = {
			model: model.model,
			messages: toOpenAIMessages(messages),
			max_tokens: options.maxTokens ?? 4096,
			temperature: options.temperature ?? 0.7,
			stream: true,
		};

		const wireTools = toOpenAITools(options.tools);
		if (wireTools) {
			body.tools = wireTools;
			body.tool_choice = "auto";
		}

		const res = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			throw new Error(`LM Studio error (${res.status})`);
		}

		const reader = res.body?.getReader();
		if (!reader) return;

		const decoder = new TextDecoder();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = decoder.decode(value, { stream: true });
			// LM Studio streams OpenAI-style SSE: lines starting with "data: "
			for (const raw of chunk.split("\n")) {
				const line = raw.trim();
				if (!line.startsWith("data:")) continue;
				const payload = line.slice(5).trim();
				if (!payload || payload === "[DONE]") continue;
				try {
					const parsed = JSON.parse(payload) as {
						choices?: Array<{ delta?: { content?: string } }>;
					};
					const delta = parsed.choices?.[0]?.delta?.content;
					if (delta) yield delta;
				} catch {
					// skip malformed SSE chunks
				}
			}
		}
	}

	/**
	 * LM Studio exposes GET /v1/models (OpenAI-compatible). Used to
	 * enumerate which models are currently loaded.
	 */
	async listModels(): Promise<string[]> {
		try {
			const res = await fetch(`${this.baseUrl}/models`);
			if (!res.ok) return [];
			const data = (await res.json()) as {
				data?: Array<{ id: string }>;
			};
			return (data.data ?? []).map((m) => m.id);
		} catch {
			return [];
		}
	}
}
