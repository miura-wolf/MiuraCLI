/**
 * LlamaAdapter — OpenAI-compatible HTTP client for llama-server.
 *
 * Implements LLMAdapter interface.
 * Calls http://127.0.0.1:8050/v1/chat/completions (configurable port).
 * No API key required (local inference).
 * Supports tool calling (OpenAI-compatible function format).
 * Supports streaming (SSE).
 *
 * The base URL is set at construction time. If a LlamaServerManager
 * is provided, the adapter will use its port; otherwise defaults to 8050.
 */

import type {
  LLMAdapter,
  LLMMessage,
  LLMOptions,
  LLMResult,
  ModelRef,
  PluginHostAPI,
  ToolCall,
} from '../../../core/types.js';

export interface LlamaAdapterConfig {
  /** Base URL of llama-server. Default: http://127.0.0.1:8050 */
  baseUrl?: string;
  /** Optional LlamaServerManager instance to mark token generation timing */
  serverManager?: {
    markTokenGenerated: () => void;
  };
}

export class LlamaAdapter implements LLMAdapter {
  manifest = {
    id: 'adapter-llama-server',
    name: 'Llama.cpp / llama-server Adapter',
    version: '0.1.0',
    type: 'adapter' as const,
    capabilities: [
      'code', 'plan', 'review', 'decision',
      'context', 'tool_use', 'streaming', 'delegate', 'scout', 'research',
    ],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;
  private baseUrl: string;

  constructor(config: LlamaAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'http://127.0.0.1:8050';
    this.serverManager = config.serverManager;
  }

  private serverManager?: { markTokenGenerated: () => void };

  async initialize(host: PluginHostAPI): Promise<void> {
    this.host = host;
    // No API key check — local inference needs none
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {}

  supports(model: ModelRef): boolean {
    return model.provider === 'llama-server';
  }

  async prompt(model: ModelRef, messages: LLMMessage[], options: LLMOptions): Promise<LLMResult> {
    const startTime = Date.now();
    const modelId = model.model; // llama-server uses filename or configured name

    // Build request body (OpenAI-compatible)
    const body: Record<string, unknown> = {
      model: modelId,
      messages: messages.map((m) => ({
        role: m.role === 'tool' ? 'tool' : m.role,
        content: m.content,
        ...(m.role === 'tool' ? { tool_call_id: (m as unknown as { toolCallId?: string }).toolCallId } : {}),
      })),
      max_tokens: options.maxTokens ?? 8192,
      temperature: options.temperature ?? 0.7,
      stream: false,
    };

    // Tool calling — llama-server v0.3+ supports OpenAI function format
    if (options.tools && options.tools.length > 0) {
      (body as Record<string, unknown>).tools = options.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      (body as Record<string, unknown>).tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`llama-server error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as LlamaChatResponse;
    const choice = data.choices[0];
    const message = choice?.message;

    // Parse tool calls (OpenAI-compatible function format)
    const toolCalls: ToolCall[] = [];
    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        try {
          const args = JSON.parse(tc.function.arguments);
          toolCalls.push({ name: tc.function.name, arguments: args });
        } catch {
          toolCalls.push({
            name: tc.function.name,
            arguments: { _raw: tc.function.arguments },
          });
        }
      }
    }

    const output = message?.content ?? '';

    // Notify server manager of token generation (for health tracking)
    if (output || toolCalls.length > 0) {
      this.serverManager?.markTokenGenerated();
    }

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

  /**
   * Streaming generator — yields token chunks as they arrive via SSE.
   * Compatible with the ReAct loop's async iteration pattern.
   */
  async *stream(
    model: ModelRef,
    messages: LLMMessage[],
    options: LLMOptions,
  ): AsyncGenerator<string> {
    const modelId = model.model;

    const body: Record<string, unknown> = {
      model: modelId,
      messages: messages.map((m) => ({ role: m.role === 'tool' ? 'tool' : m.role, content: m.content })),
      max_tokens: options.maxTokens ?? 8192,
      temperature: options.temperature ?? 0.7,
      stream: true,
    };

    if (options.tools && options.tools.length > 0) {
      (body as Record<string, unknown>).tools = options.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      (body as Record<string, unknown>).tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`llama-server streaming error (${response.status})`);
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
            const parsed = JSON.parse(data) as StreamChoice;
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              this.serverManager?.markTokenGenerated();
              yield content;
            }
          } catch {
            // Skip malformed SSE chunks
          }
        }
      }
    }
  }
}

// === Type helpers ===

interface LlamaChatResponse {
  id?: string;
  model: string;
  choices: Array<{
    index?: number;
    message?: {
      role?: string;
      content: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface StreamChoice {
  choices: Array<{
    index?: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
}