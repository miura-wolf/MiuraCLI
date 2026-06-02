// Ollama adapter — local models with tool-calling support
import type {
  LLMAdapter,
  LLMMessage,
  LLMOptions,
  LLMResult,
  ModelRef,
  PluginHostAPI,
  ToolCall,
} from '../../../core/types.js';
import { toOpenAITools } from '../openai-compat.js';

const OLLAMA_BASE_URL = 'http://localhost:11434';

/**
 * Map internal messages to Ollama's native /api/chat format. Unlike the
 * OpenAI wire protocol, Ollama carries tool-call arguments as objects (not
 * JSON strings) and does not use tool_call_id, so it needs its own mapper.
 */
function toOllamaMessages(messages: LLMMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === 'tool' || m.role === 'tool_result') {
      return { role: 'tool', content: m.content ?? '' };
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content ?? '',
        tool_calls: m.toolCalls.map((c) => ({
          function: { name: c.name, arguments: c.arguments ?? {} },
        })),
      };
    }
    return { role: m.role, content: m.content ?? '' };
  });
}

export class OllamaAdapter implements LLMAdapter {
  manifest = {
    id: 'adapter-ollama',
    name: 'Ollama Local Adapter',
    version: '0.1.0',
    type: 'adapter' as const,
    capabilities: ['code', 'delegate', 'scout', 'research'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? process.env.OLLAMA_BASE_URL ?? OLLAMA_BASE_URL;
  }

  async initialize(host: PluginHostAPI): Promise<void> {
    this.host = host;
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {}

  supports(model: ModelRef): boolean {
    return model.provider === 'ollama';
  }

  async prompt(model: ModelRef, messages: LLMMessage[], options: LLMOptions): Promise<LLMResult> {
    const startTime = Date.now();

    // Build request body
    const body: any = {
      model: model.model,
      messages: toOllamaMessages(messages),
      stream: false,
      options: {
        num_predict: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
      },
    };

    // Add tools if provided (Ollama accepts the OpenAI function-tool wrapper)
    const wireTools = toOpenAITools(options.tools);
    if (wireTools) {
      body.tools = wireTools;
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error (${response.status}): ${await response.text()}`);
    }

    const data = await response.json() as {
      message: {
        content: string;
        tool_calls?: Array<{
          function: { name: string; arguments: Record<string, unknown> };
        }>;
      };
      prompt_eval_count: number;
      eval_count: number;
    };

    // Parse tool_calls if present
    const toolCalls: ToolCall[] = [];
    if (data.message.tool_calls) {
      for (const tc of data.message.tool_calls) {
        toolCalls.push({
          name: tc.function.name,
          arguments: tc.function.arguments || {},
        });
      }
    }

    return {
      output: data.message?.content ?? '',
      tokenUsage: {
        prompt: data.prompt_eval_count ?? 0,
        completion: data.eval_count ?? 0,
      },
      model: model.model,
      durationMs: Date.now() - startTime,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *stream(model: ModelRef, messages: LLMMessage[], options: LLMOptions): AsyncGenerator<string> {
    const body: any = {
      model: model.model,
      messages: toOllamaMessages(messages),
      stream: true,
      options: {
        num_predict: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
      },
    };

    const wireTools = toOpenAITools(options.tools);
    if (wireTools) {
      body.tools = wireTools;
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error (${response.status})`);
    }

    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as {
            message?: { content?: string };
            done?: boolean;
          };
          if (parsed.done) return;
          const content = parsed.message?.content;
          if (content) yield content;
        } catch {
          // Skip malformed chunks
        }
      }
    }
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api-tags`);
    if (!response.ok) return [];
    const data = await response.json() as { models: Array<{ name: string }> };
    return data.models.map((m) => m.name);
  }
}
