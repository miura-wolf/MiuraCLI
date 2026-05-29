import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlamaAdapter } from './index.js';
import type { ModelRef } from '../../../../core/types.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const LOCAL_MODEL: ModelRef = {
  provider: 'llama-server',
  model: 'qwen2.5-coder-7b-q4_k_m',
  maxTokens: 8192,
  supportsToolUse: true,
};

describe('LlamaAdapter', () => {
  let adapter: LlamaAdapter;

  beforeEach(() => {
    mockFetch.mockReset();
    adapter = new LlamaAdapter({ baseUrl: 'http://127.0.0.1:8050' });
  });

  it('manifest has correct type and id', () => {
    expect(adapter.manifest.id).toBe('adapter-llama-server');
    expect(adapter.manifest.type).toBe('adapter');
    expect(adapter.manifest.capabilities).toContain('tool_use');
    expect(adapter.manifest.capabilities).toContain('streaming');
  });

  it('initialize does not throw (no API key needed)', async () => {
    await expect(adapter.initialize({} as never)).resolves.toBeUndefined();
  });

  it('supports llama-server provider', () => {
    expect(adapter.supports(LOCAL_MODEL)).toBe(true);
    expect(adapter.supports({ provider: 'nvidia-nim', model: 'deepseek-v4' })).toBe(false);
  });

  it('prompt sends correct request to llama-server', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: 'Hello world',
            tool_calls: undefined,
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    } as Response);

    const result = await adapter.prompt(LOCAL_MODEL, [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Say hello' },
    ], { maxTokens: 100 });

    expect(result.output).toBe('Hello world');
    expect(result.model).toBe('qwen2.5-coder-7b-q4_k_m');
    expect(result.tokenUsage.prompt).toBe(10);
    expect(result.tokenUsage.completion).toBe(5);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:8050/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.model).toBe('qwen2.5-coder-7b-q4_k_m');
    expect(body.messages).toHaveLength(2);
    expect(body.stream).toBe(false);
  });

  it('prompt parses tool calls from response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call_abc',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: '{"path": "src/index.ts"}',
              },
            }],
          },
        }],
        usage: { prompt_tokens: 50, completion_tokens: 80, total_tokens: 130 },
      }),
    } as Response);

    const result = await adapter.prompt(LOCAL_MODEL, [
      { role: 'user', content: 'read the index file' },
    ], { tools: [] });

    expect(result.output).toBe('');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('read_file');
    expect(result.toolCalls![0].arguments).toEqual({ path: 'src/index.ts' });
  });

  it('prompt throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal server error',
    } as Response);

    await expect(
      adapter.prompt(LOCAL_MODEL, [{ role: 'user', content: 'hi' }], {}),
    ).rejects.toThrow('llama-server error (500)');
  });

  it('prompt includes tools in request body when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'done' } }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      }),
    } as Response);

    await adapter.prompt(LOCAL_MODEL, [{ role: 'user', content: 'hi' }], {
      tools: [{
        name: 'read_file',
        description: 'read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      }],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('read_file');
    expect(body.tool_choice).toBe('auto');
  });

  it('prompt passes temperature and maxTokens', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'x' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    } as Response);

    await adapter.prompt(LOCAL_MODEL, [{ role: 'user', content: 'x' }], {
      temperature: 0.3,
      maxTokens: 2048,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(2048);
  });

  it('prompt notifies serverManager of token generation', async () => {
    const markFn = vi.fn();
    adapter = new LlamaAdapter({
      baseUrl: 'http://127.0.0.1:8050',
      serverManager: { markTokenGenerated: markFn },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'hi' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    } as Response);

    await adapter.prompt(LOCAL_MODEL, [{ role: 'user', content: 'hi' }], {});
    expect(markFn).toHaveBeenCalled();
  });
});