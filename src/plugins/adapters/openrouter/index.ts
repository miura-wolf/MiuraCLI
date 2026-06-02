// OpenRouter adapter — OpenAI-compatible, 29+ free models
import type {
  LLMAdapter,
  LLMMessage,
  LLMOptions,
  LLMResult,
  ModelRef,
  PluginHostAPI,
} from '../../../core/types.js';
import {
  parseToolCalls,
  toOpenAIMessages,
  toOpenAITools,
  type WireToolCall,
} from '../openai-compat.js';

const BASE_URL = 'https://openrouter.ai/api/v1';

export class OpenRouterAdapter implements LLMAdapter {
  manifest = {
    id: 'adapter-openrouter',
    name: 'OpenRouter Adapter',
    version: '0.1.0',
    type: 'adapter' as const,
    capabilities: ['code', 'research', 'plan', 'review', 'decision', 'delegate', 'scout'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.OPENROUTER_API_KEY ?? '';
  }

  async initialize(host: PluginHostAPI): Promise<void> {
    this.host = host;
    if (!this.apiKey) throw new Error('OPENROUTER_API_KEY not set');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {}

  supports(model: ModelRef): boolean {
    return model.provider === 'openrouter';
  }

  async prompt(model: ModelRef, messages: LLMMessage[], options: LLMOptions): Promise<LLMResult> {
    const start = Date.now();

    const body: any = {
      model: model.model,
      messages: toOpenAIMessages(messages),
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
    };

    const wireTools = toOpenAITools(options.tools);
    if (wireTools) {
      body.tools = wireTools;
      body.tool_choice = 'auto';
    }

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://miuraswarm.dev',
        'X-Title': 'MiuraSwarm',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`OpenRouter error (${res.status}): ${await res.text()}`);

    const data = await res.json() as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            type: 'function';
            function: { name: string; arguments: string };
          }> | null;
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

    return {
      output: message.content ?? '',
      tokenUsage: {
        prompt: data.usage?.prompt_tokens ?? 0,
        completion: data.usage?.completion_tokens ?? 0,
      },
      model: model.model,
      durationMs: Date.now() - start,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    };
  }

  async *stream(model: ModelRef, messages: LLMMessage[], options: LLMOptions): AsyncGenerator<string> {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://miuraswarm.dev',
      },
      body: JSON.stringify({
        model: model.model,
        messages: toOpenAIMessages(messages),
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!res.ok) throw new Error(`OpenRouter error (${res.status})`);

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
          const parsed = JSON.parse(data) as { choices: Array<{ delta: { content?: string } }> };
          const content = parsed.choices[0]?.delta?.content;
          if (content) yield content;
        } catch {
          /* skip */
        }
      }
    }
  }
}
