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

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * Extract human-readable text from a NIM message field.
 * Reasoning models (nemotron-super, deepseek) may return `content` as an array
 * of parts and embed chain-of-thought in `<think>...</think>` blocks. Strip the
 * thinking and join array parts so we surface only the final answer.
 */
function extractText(raw: unknown): string {
	if (!raw) return "";
	let text: string;
	if (Array.isArray(raw)) {
		text = raw
			.map((p: any) => (typeof p === "string" ? p : (p?.text ?? "")))
			.join("");
	} else {
		text = String(raw);
	}
	return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export class NvidiaNimAdapter implements LLMAdapter {
	manifest = {
		id: "adapter-nvidia-nim",
		name: "NVIDIA NIM Adapter",
		version: "0.1.0",
		type: "adapter" as const,
		capabilities: [
			"code",
			"research",
			"plan",
			"review",
			"decision",
			"delegate",
			"scout",
		],
		dependencies: [] as string[],
	};

	private apiKey: string;

	constructor(apiKey?: string) {
		this.apiKey = apiKey ?? process.env.NVIDIA_NIM_API_KEY ?? "";
	}

	async initialize(_host: PluginHostAPI): Promise<void> {
		if (!this.apiKey) {
			throw new Error(
				"NVIDIA NIM API key not configured. Set NVIDIA_NIM_API_KEY env var or pass apiKey in constructor.",
			);
		}
	}

	async activate(): Promise<void> {}
	async deactivate(): Promise<void> {}
	async unload(): Promise<void> {}

	supports(model: ModelRef): boolean {
		return model.provider === "nvidia-nim";
	}

	async prompt(
		model: ModelRef,
		messages: LLMMessage[],
		options: LLMOptions,
	): Promise<LLMResult> {
		const startTime = Date.now();
		const modelId = this.resolveModelId(model.model);

		// Build body with optional tools support
		const body: any = {
			model: modelId,
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

		const response = await fetch(`${NIM_BASE_URL}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`NVIDIA NIM API error (${response.status}): ${errorText}`,
			);
		}

		const data = (await response.json()) as {
			choices: Array<{
				message: {
					content: string | null;
					// Reasoning models (nemotron-super, deepseek-v4) put the answer here
					// when `content` is empty/null. Treated as a fallback for `content`.
					reasoning_content?: string | null;
					tool_calls?: Array<{
						id: string;
						type: "function";
						function: {
							name: string;
							arguments: string;
						};
					}>;
				};
			}>;
			usage: { prompt_tokens: number; completion_tokens: number };
		};

		const choice = data.choices[0];
		const message = choice.message;

		// Parse tool_calls (preserving provider ids) via shared helper.
		const toolCalls = parseToolCalls(
			message.tool_calls as WireToolCall[] | undefined,
		);

		// Reasoning models often return an empty `content` and place the answer
		// (or thinking) in `reasoning_content`, or wrap it in <think> blocks, or
		// return content as an array of parts. Try every shape so that whenever
		// the model actually produced tokens, the agent never receives "".
		const output =
			extractText(message.content) ||
			extractText(message.reasoning_content) ||
			(typeof message.content === "string" ? message.content.trim() : "") ||
			(message.reasoning_content ?? "");
		return {
			output,
			tokenUsage: {
				prompt: data.usage?.prompt_tokens ?? 0,
				completion: data.usage?.completion_tokens ?? 0,
			},
			model: model.model,
			durationMs: Date.now() - startTime,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
		};
	}

	async *stream(
		model: ModelRef,
		messages: LLMMessage[],
		options: LLMOptions,
	): AsyncGenerator<string> {
		const modelId = this.resolveModelId(model.model);

		// Build body with optional tools support for streaming
		const body: any = {
			model: modelId,
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

		const response = await fetch(`${NIM_BASE_URL}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			throw new Error(`NVIDIA NIM API error (${response.status})`);
		}

		const reader = response.body?.getReader();
		if (!reader) return;

		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				if (line.startsWith("data: ")) {
					const data = line.slice(6).trim();
					if (data === "[DONE]") return;
					try {
						const parsed = JSON.parse(data) as {
							choices: Array<{
								delta: { content?: string; reasoning_content?: string };
							}>;
						};
						// Prefer real content; fall back to reasoning_content so the
						// REPL never renders an empty stream for reasoning models.
						const delta = parsed.choices[0]?.delta;
						const content = delta?.content || delta?.reasoning_content;
						if (content) yield content;
					} catch {
						// Skip malformed chunks
					}
				}
			}
		}
	}

	private resolveModelId(model: string): string {
		const modelMap: Record<string, string> = {
			"deepseek-v4-pro": "deepseek-ai/deepseek-v4-pro",
			"gemma-4-31b-it": "google/gemma-4-31b-it",
			"minimax-m2.7": "minimaxai/minimax-m2.7",
			"kimi-k2.5": "moonshotai/kimi-k2.5",
			"glm-5.1": "z-ai/glm-5.1",
		};
		return modelMap[model] ?? model;
	}
}
