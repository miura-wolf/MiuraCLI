import type {
  LLMAdapter,
  LLMMessage,
  LLMOptions,
  LLMResult,
  ModelRef,
  Plugin,
  PluginHostAPI,
} from '../../../core/types.js';

const NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export class NvidiaNimAdapter implements LLMAdapter {
  manifest = {
    id: 'adapter-nvidia-nim',
    name: 'NVIDIA NIM Adapter',
    version: '0.1.0',
    type: 'adapter' as const,
    capabilities: ['code', 'research', 'plan', 'review', 'decision', 'delegate', 'scout'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.NVIDIA_NIM_API_KEY ?? '';
  }

  async initialize(host: PluginHostAPI): Promise<void> {
    this.host = host;
    if (!this.apiKey) {
      throw new Error('NVIDIA NIM API key not configured. Set NVIDIA_NIM_API_KEY env var or pass apiKey in constructor.');
    }
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {}

  supports(model: ModelRef): boolean {
    return model.provider === 'nvidia-nim';
  }

  async prompt(model: ModelRef, messages: LLMMessage[], options: LLMOptions): Promise<LLMResult> {
    const startTime = Date.now();

    const modelId = this.resolveModelId(model.model);

    const response = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NVIDIA NIM API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const output = data.choices[0]?.message?.content ?? '';

    return {
      output,
      tokenUsage: {
        prompt: data.usage?.prompt_tokens ?? 0,
        completion: data.usage?.completion_tokens ?? 0,
      },
      model: model.model,
      durationMs: Date.now() - startTime,
    };
  }

  async *stream(model: ModelRef, messages: LLMMessage[], options: LLMOptions): AsyncGenerator<string> {
    const modelId = this.resolveModelId(model.model);

    const response = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`NVIDIA NIM API error (${response.status})`);
    }

    const reader = response.body?.getReader();
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
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{ delta: { content?: string } }>;
            };
            const content = parsed.choices[0]?.delta?.content;
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
      'deepseek-v4-pro': 'deepseek-ai/deepseek-v4-pro',
      'gemma-4-31b-it': 'google/gemma-4-31b-it',
      'minimax-m2.7': 'minimaxai/minimax-m2.7',
      'kimi-k2.5': 'moonshotai/kimi-k2.5',
      'glm-5.1': 'z-ai/glm-5.1',
    };
    return modelMap[model] ?? model;
  }
}
