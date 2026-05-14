// Google AI adapter — Gemini models via REST API
import type {
  LLMAdapter,
  LLMMessage,
  LLMOptions,
  LLMResult,
  ModelRef,
  PluginHostAPI,
  ToolCall,
} from '../../../core/types.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class GoogleAIAdapter implements LLMAdapter {
  manifest = {
    id: 'adapter-google',
    name: 'Google AI Adapter',
    version: '0.1.0',
    type: 'adapter' as const,
    capabilities: ['code', 'research', 'plan', 'review', 'decision', 'context'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.GOOGLE_AI_API_KEY ?? '';
  }

  async initialize(host: PluginHostAPI): Promise<void> {
    this.host = host;
    if (!this.apiKey) throw new Error('GOOGLE_AI_API_KEY not set');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {}

  supports(model: ModelRef): boolean {
    return model.provider === 'google';
  }

  async prompt(model: ModelRef, messages: LLMMessage[], options: LLMOptions): Promise<LLMResult> {
    const start = Date.now();
    const modelId = this.resolveModelId(model.model);

    // Build request body
    const body: any = {
      contents: this.toGeminiContents(messages),
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
      },
    };

    // Add tools if provided (Gemini format)
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((tool: any) => ({
        functionDeclarations: [{
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        }],
      }));
      body.toolConfig = {
        functionCallingConfig: {
          mode: 'AUTO',
        },
      };
    }

    const res = await fetch(
      `${BASE_URL}/models/${modelId}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) throw new Error(`Google AI error (${res.status}): ${await res.text()}`);

    const data = await res.json() as {
      candidates: Array<{
        content: { parts: Array<{ text: string; functionCall?: { name: string; args: Record<string, unknown> } }> };
      }>;
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
    };

    const candidate = data.candidates[0];
    const parts = candidate?.content?.parts || [];

    // Extract text output
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.functionCall) {
        toolCalls.push({
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
        });
      } else if (part.text) {
        textParts.push(part.text);
      }
    }

    const output = textParts.join('');

    return {
      output: output || '',
      tokenUsage: {
        prompt: data.usageMetadata?.promptTokenCount ?? 0,
        completion: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model: model.model,
      durationMs: Date.now() - start,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *stream(model: ModelRef, messages: LLMMessage[], options: LLMOptions): AsyncGenerator<string> {
    const modelId = this.resolveModelId(model.model);
    const contents = this.toGeminiContents(messages);

    // Build request body for streaming
    const body: any = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
      },
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((tool: any) => ({
        functionDeclarations: [{
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        }],
      }));
      body.toolConfig = {
        functionCallingConfig: {
          mode: 'AUTO',
        },
      };
    }

    const res = await fetch(
      `${BASE_URL}/models/${modelId}:streamGenerateContent?alt=sse&key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) throw new Error(`Google AI error (${res.status})`);

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
        try {
          const parsed = JSON.parse(line.slice(6)) as {
            candidates: Array<{
              content: { parts: Array<{ text: string }> };
            }>;
          };
          const text = parsed.candidates[0]?.content?.parts?.[0]?.text;
          if (text) yield text;
        } catch {
          /* skip */
        }
      }
    }
  }

  private toGeminiContents(messages: LLMMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
  }

  private resolveModelId(model: string): string {
    if (model.startsWith('models/')) return model.slice(7);
    return model;
  }
}
