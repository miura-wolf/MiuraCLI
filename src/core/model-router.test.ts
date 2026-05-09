import { describe, it, expect } from 'vitest';
import { ModelRouter, DEFAULT_ROUTING } from './model-router.js';

describe('ModelRouter', () => {
  it('resolves default model for a role', () => {
    const router = new ModelRouter();
    const model = router.resolve('planner');

    expect(model).toBeDefined();
    expect(model.provider).toBe('claude');
    expect(model.model).toBe('opus');
  });

  it('resolves worker to sonnet', () => {
    const router = new ModelRouter();
    const model = router.resolve('worker');

    expect(model.provider).toBe('claude');
    expect(model.model).toBe('sonnet');
  });

  it('resolves scout to haiku', () => {
    const router = new ModelRouter();
    const model = router.resolve('scout');

    expect(model.provider).toBe('claude');
    expect(model.model).toBe('haiku');
  });

  it('returns fallback chain for a role', () => {
    const router = new ModelRouter();
    const chain = router.getFallbackChain('worker');

    expect(chain.length).toBeGreaterThanOrEqual(1);
  });

  it('escalates after repeated failures', () => {
    const router = new ModelRouter();

    // Report 2 failures for worker's default model
    const model = router.resolve('worker');
    router.reportFailure('worker', model);
    router.reportFailure('worker', model);

    // Next resolve should return a fallback
    const next = router.resolve('worker');
    expect(next.model).not.toBe(model.model);
  });
});
