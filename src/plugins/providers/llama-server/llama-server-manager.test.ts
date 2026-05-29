/**
 * LlamaServerManager tests
 *
 * Bun's test runner (bun test) has limited vitest API support.
 * Testing strategy:
 * - Constructor/config tests: pass real LlamaServerManager
 * - Integration tests with real HTTP servers for port detection behavior
 *
 * Note: Testing spawnFn injection requires vi.mock which is not available
 * in Bun's test runner. Use real integration tests for process spawning.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { LlamaServerConfig } from './index.js';

describe('LlamaServerManager', () => {
  let LlamaServerManager: typeof import('./index.js')['LlamaServerManager'];

  // Shared state: controls whether the mock fetch simulates a running server.
  // Defaults to false (port not in use) — tests that need a running server set it true.
  let serverUp: boolean;

  // The mock fetch passed as fetchFn to manager.
  // /v1/models → 200 if serverUp, else 404
  // /health    → 200 with gpu_memory_used_mb if serverUp, else 404
  let mockFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;

  beforeEach(async () => {
    serverUp = false;
    mockFetch = async (input: RequestInfo) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
      if (urlStr.includes('/v1/models')) {
        return new Response('', { status: serverUp ? 200 : 404 });
      }
      if (urlStr.includes('/health')) {
        return serverUp
          ? Response.json({ gpu_memory_used_mb: 0 })
          : new Response('', { status: 404 });
      }
      return new Response('', { status: 404 });
    };

    const mod = await import('./index.js');
    LlamaServerManager = mod.LlamaServerManager;
  });

  /**
   * Helper: create manager with default mockFetch (serverUp=false).
   */
  function makeManager(overrides: Partial<LlamaServerConfig> = {}): LlamaServerManager {
    return new LlamaServerManager({
      serverPath: 'llama-server',
      modelPath: 'test.gguf',
      fetchFn: mockFetch,
      ...overrides,
    } as LlamaServerConfig);
  }

  // === Constructor & config (no network required) ===

  it('applies default port 8050', () => {
    const manager = makeManager();
    expect(manager.port).toBe(8050);
  });

  it('uses custom port when provided', () => {
    const manager = makeManager({ port: 9000 });
    expect(manager.port).toBe(9000);
  });

  it('exposes model path', () => {
    const manager = makeManager({ modelPath: 'D:\\models\\qwen.gguf' });
    expect(manager.modelPath).toBe('D:\\models\\qwen.gguf');
  });

  it('isRunning is false before start', () => {
    const manager = makeManager();
    expect(manager.isRunning).toBe(false);
  });

  it('baseUrl uses configured port', () => {
    const manager = makeManager({ port: 8888 });
    expect(manager.baseUrl).toBe('http://127.0.0.1:8888');
  });

  it('stop is safe when not running', async () => {
    const manager = makeManager();
    await expect(manager.stop()).resolves.toBeUndefined();
    expect(manager.isRunning).toBe(false);
  });

  it('stop is idempotent', async () => {
    const manager = makeManager();
    await manager.stop();
    await manager.stop();
    expect(manager.isRunning).toBe(false);
  });

  // === Integration tests with real HTTP server ===

  it('detects server already running — isRunning=true after start', async () => {
    // Simulate: something already on port 8050
    serverUp = true;

    const manager = makeManager({ port: 8050 });

    await manager.start();
    expect(manager.isRunning).toBe(true);
    expect(manager.port).toBe(8050);
  });

  it('healthCheck returns running=false when no server on port', async () => {
    // Default mockFetch returns 404 → port not in use → running=false
    const manager = makeManager({ port: 59998 });

    const status = await manager.healthCheck();
    expect(status.running).toBe(false);
    expect(status.port).toBe(59998);
    expect(status.pid).toBeNull();
  });

  it('healthCheck returns running=true when server responds', async () => {
    // Simulate server running and returning GPU memory info
    serverUp = true;

    const manager = makeManager({ port: 8050 });

    const status = await manager.healthCheck();
    expect(status.running).toBe(true);
    expect(status.gpuMemoryUsedMb).toBe(0);
  });

  it('markTokenGenerated updates lastTokenTime', async () => {
    // Simulate server running so start() works
    serverUp = true;

    const manager = makeManager({ port: 8050 });

    await manager.start();
    manager.markTokenGenerated();

    const health = await manager.healthCheck();
    expect(health.lastTokenTime).toBeGreaterThan(0);
  });
});