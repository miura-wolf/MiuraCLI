import { describe, it, expect } from 'vitest';
import { ModelRouter } from './model-router.js';

describe('ModelRouter', () => {
  it('resolves planner to groq default', () => {
    const router = new ModelRouter();
    const model = router.resolve('planner');
    expect(model).toBeDefined();
    expect(model.provider).toBe('groq');
    expect(model.model).toBe('llama-3.3-70b-versatile');
  });

  it('resolves worker to groq default', () => {
    const router = new ModelRouter();
    const model = router.resolve('worker');
    expect(model.provider).toBe('groq');
    expect(model.model).toBe('llama-3.3-70b-versatile');
  });

  it('resolves reviewer to groq default', () => {
    const router = new ModelRouter();
    const model = router.resolve('reviewer');
    expect(model.provider).toBe('groq');
    expect(model.model).toBe('llama-3.3-70b-versatile');
  });

  it('resolves scout to groq qwen model', () => {
    const router = new ModelRouter();
    const model = router.resolve('scout');
    expect(model.provider).toBe('groq');
    expect(model.model).toBe('qwen/qwen3-32b');
  });

  it('resolves oracle to groq default', () => {
    const router = new ModelRouter();
    const model = router.resolve('oracle');
    expect(model.provider).toBe('groq');
    expect(model.model).toBe('llama-3.3-70b-versatile');
  });

  it('returns fallback chain for worker', () => {
    const router = new ModelRouter();
    const chain = router.getFallbackChain('worker');
    expect(chain.length).toBeGreaterThanOrEqual(3);
    expect(chain[0].model).toBe('llama-3.3-70b-versatile');
  });

  it('escalates after repeated failures', () => {
    const router = new ModelRouter();
    const model = router.resolve('worker');
    router.reportFailure('worker', model);
    router.reportFailure('worker', model);
    const next = router.resolve('worker');
    // After failures, should fall back to next in chain
    expect(next.provider).toBe('groq');
    expect(next.model).toBe('qwen/qwen3-32b');
  });

  it('delegate uses groq default', () => {
    const router = new ModelRouter();
    const model = router.resolve('delegate');
    expect(model.provider).toBe('groq');
    expect(model.model).toBe('llama-3.3-70b-versatile');
  });
});