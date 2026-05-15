import { describe, it, expect } from 'vitest';
import { ModelRouter } from './model-router.js';

describe('ModelRouter', () => {
  it('resolves planner to deepseek-v4-flash', () => {
    const router = new ModelRouter();
    const model = router.resolve('planner');
    expect(model).toBeDefined();
    expect(model.provider).toBe('nvidia-nim');
    expect(model.model).toBe('deepseek-ai/deepseek-v4-flash');
  });

  it('resolves worker to qwen3-coder-480b', () => {
    const router = new ModelRouter();
    const model = router.resolve('worker');
    expect(model.provider).toBe('nvidia-nim');
    expect(model.model).toBe('qwen/qwen3-coder-480b-a35b-instruct');
  });

  it('resolves reviewer to glm-5.1', () => {
    const router = new ModelRouter();
    const model = router.resolve('reviewer');
    expect(model.provider).toBe('nvidia-nim');
    expect(model.model).toBe('z-ai/glm-5.1');
  });

  it('resolves scout to groq fast model', () => {
    const router = new ModelRouter();
    const model = router.resolve('scout');
    expect(model.provider).toBe('groq');
    expect(model.model).toBe('llama-3.3-70b-versatile');
  });

  it('resolves oracle to deepseek-v4-pro', () => {
    const router = new ModelRouter();
    const model = router.resolve('oracle');
    expect(model.provider).toBe('nvidia-nim');
    expect(model.model).toBe('deepseek-ai/deepseek-v4-pro');
  });

  it('returns deep fallback chain for worker', () => {
    const router = new ModelRouter();
    const chain = router.getFallbackChain('worker');
    expect(chain.length).toBeGreaterThanOrEqual(3);
    expect(chain[0].model).toBe('qwen/qwen3-coder-480b-a35b-instruct');
  });

  it('escalates after repeated failures', () => {
    const router = new ModelRouter();
    const model = router.resolve('worker');
    router.reportFailure('worker', model);
    router.reportFailure('worker', model);
    const next = router.resolve('worker');
    expect(next.model).not.toBe(model.model);
  });

  it('delegate uses gemma-4 multimodal', () => {
    const router = new ModelRouter();
    const model = router.resolve('delegate');
    expect(model.provider).toBe('nvidia-nim');
    expect(model.model).toBe('google/gemma-4-31b-it');
  });
});
