// Claude adapter — Anthropic Messages API with tool-calling
import type {
  LLMAdapter,
  LLMMessage,
  LLMOptions,
  LLMResult,
  ModelRef,
  PluginHostAPI,
  ToolCall,
} from '../../../core/types.js';

const BASE_URL = 'https://api.anthropic.com/v1';

export class ClaudeAdapter implements LLMAdapter {
  manifest = {
    id: 'adapter-claude',
    name: 'Claude Adapter',
    version: '0.1.0',
    type: 'adapter' as const,
    capabilities: ['code', 'plan', 'review', 'decision', 'context', 'tool_use', 'streaming', 'delegate', 'scout', 'research'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  }

  async initialize(host: PluginHostAPI): Promise<void> {
    this.host = host;
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {}

  supports(model: ModelRef): boolean {
    return model.provider === 'claude';
  }

  async prompt(model: ModelRef, messages: LLMMessage[], options: LLMOptions): Promise<LLMResult> {
    const startTime = Date.now();
    const modelId = this.resolveModelId(model.model);

    // Separate system message
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMessages = messages.filter((m) => m.role !== 'system');

    // Build request body
    const body: any = {
      model: modelId,
      max_tokens: options.maxTokens ?? 4096,
      messages: userMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    // Add tools if provided (Anthropic format)
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    const res = await fetch(`${BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Claude error (${res.status}): ${await res.text()}`);

    const data = await res.json() as {
      content: Array<{
        type: 'text' | 'tool_use';
        text?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    // Parse content blocks
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      } else if (block.type === 'tool_use' && block.name) {
        toolCalls.push({
          name: block.name,
          arguments: block.input || {},
        });
      }
    }

    return {
      output: textParts.join(''),
      tokenUsage: {
        prompt: data.usage?.input_tokens ?? 0,
        completion: data.usage?.output_tokens ?? 0,
      },
      model: model.model,
      durationMs: Date.now() - startTime,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *stream(model: ModelRef, messages: LLMMessage[], options: LLMOptions): AsyncGenerator<string> {
    const modelId = this.resolveModelId(model.model);
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMessages = messages.filter((m) => m.role !== 'system');

    const body: any = {
      model: modelId,
      max_tokens: options.maxTokens ?? 4096,
      messages: userMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      stream: true,
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    const res = await fetch(`${BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Claude error (${res.status})`);

    const reader = res.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data) as {
            type: 'content_block_delta';
            delta?: { text?: string };
          };
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            yield parsed.delta.text;
          }
        } catch {
          /* skip */
        }
      }
    }
  }

  private resolveModelId(model: string): string {
    const modelMap: Record<string, string> = {
      opus: 'claude-opus-4-20250514',
      sonnet: 'claude-sonnet-4-20250514',
      haiku: 'claude-haiku-3-5-20241022',
    };
    return modelMap[model] ?? model;
  }
}
