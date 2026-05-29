import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from './claude/index.js';
import { NvidiaNimAdapter } from './nvidia-nim/index.js';
import type { ModelRef } from '../../core/types.js';

describe('ClaudeAdapter', () => {
  it('supports claude provider', () => {
    const adapter = new ClaudeAdapter('test-key');
    expect(adapter.supports({ provider: 'claude', model: 'sonnet' })).toBe(true);
    expect(adapter.supports({ provider: 'nvidia-nim', model: 'test' })).toBe(false);
  });

  it('manifest has correct type and capabilities', () => {
    const adapter = new ClaudeAdapter('test-key');
    expect(adapter.manifest.type).toBe('adapter');
    expect(adapter.manifest.id).toBe('adapter-claude');
    expect(adapter.manifest.capabilities).toContain('tool_use');
    expect(adapter.manifest.capabilities).toContain('streaming');
  });

  it('resolveModelId maps short names to full IDs', () => {
    const adapter = new ClaudeAdapter('test-key');
    // Access private method via bracket notation for testing
    const resolve = (adapter as any).resolveModelId.bind(adapter);
    expect(resolve('opus')).toBe('claude-opus-4-20250514');
    expect(resolve('sonnet')).toBe('claude-sonnet-4-20250514');
    expect(resolve('haiku')).toBe('claude-haiku-3-5-20241022');
    expect(resolve('claude-sonnet-4-20250514')).toBe('claude-sonnet-4-20250514');
  });

  it('initialize throws without API key', async () => {
    const adapter = new ClaudeAdapter('');
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await expect(adapter.initialize({} as any)).rejects.toThrow('ANTHROPIC_API_KEY');
    if (originalEnv) process.env.ANTHROPIC_API_KEY = originalEnv;
  });
});

describe('NvidiaNimAdapter', () => {
  it('supports nvidia-nim provider', () => {
    const adapter = new NvidiaNimAdapter('test-key');
    expect(adapter.supports({ provider: 'nvidia-nim', model: 'test' })).toBe(true);
    expect(adapter.supports({ provider: 'claude', model: 'test' })).toBe(false);
  });

  it('manifest has correct type and capabilities', () => {
    const adapter = new NvidiaNimAdapter('test-key');
    expect(adapter.manifest.type).toBe('adapter');
    expect(adapter.manifest.id).toBe('adapter-nvidia-nim');
    expect(adapter.manifest.capabilities).toContain('code');
    expect(adapter.manifest.capabilities).toContain('research');
  });

  it('resolveModelId maps short names to full paths', () => {
    const adapter = new NvidiaNimAdapter('test-key');
    const resolve = (adapter as any).resolveModelId.bind(adapter);
    expect(resolve('deepseek-v4-pro')).toBe('deepseek-ai/deepseek-v4-pro');
    expect(resolve('kimi-k2.5')).toBe('moonshotai/kimi-k2.5');
    expect(resolve('glm-5.1')).toBe('z-ai/glm-5.1');
    // Unknown models pass through unchanged
    expect(resolve('custom/model')).toBe('custom/model');
  });

  it('initialize throws without API key', async () => {
    const adapter = new NvidiaNimAdapter('');
    const originalEnv = process.env.NVIDIA_NIM_API_KEY;
    delete process.env.NVIDIA_NIM_API_KEY;
    await expect(adapter.initialize({} as any)).rejects.toThrow('NVIDIA NIM API key');
    if (originalEnv) process.env.NVIDIA_NIM_API_KEY = originalEnv;
  });
});
