import { describe, it, expect } from "vitest";
import { ModelRouter } from "./model-router.js";

describe("ModelRouter", () => {
	it("resolves planner to nvidia-nim default", () => {
		const router = new ModelRouter();
		const model = router.resolve("planner");
		expect(model).toBeDefined();
		expect(model.provider).toBe("nvidia-nim");
		expect(model.model).toBe("nvidia/llama-3.3-nemotron-super-49b-v1");
	});

	it("resolves worker to nvidia-nim default", () => {
		const router = new ModelRouter();
		const model = router.resolve("worker");
		expect(model.provider).toBe("nvidia-nim");
		expect(model.model).toBe("nvidia/llama-3.3-nemotron-super-49b-v1");
	});

	it("resolves reviewer to nvidia-nim default", () => {
		const router = new ModelRouter();
		const model = router.resolve("reviewer");
		expect(model.provider).toBe("nvidia-nim");
		expect(model.model).toBe("nvidia/llama-3.3-nemotron-super-49b-v1");
	});

	it("resolves scout to nvidia-nim nano model", () => {
		const router = new ModelRouter();
		const model = router.resolve("scout");
		expect(model.provider).toBe("nvidia-nim");
		expect(model.model).toBe("nvidia/llama-3.1-nemotron-nano-8b-v1");
	});

	it("resolves oracle to nvidia-nim default", () => {
		const router = new ModelRouter();
		const model = router.resolve("oracle");
		expect(model.provider).toBe("nvidia-nim");
		expect(model.model).toBe("nvidia/llama-3.3-nemotron-super-49b-v1");
	});

	it("returns fallback chain for worker", () => {
		const router = new ModelRouter();
		const chain = router.getFallbackChain("worker");
		expect(chain.length).toBeGreaterThanOrEqual(2);
		expect(chain[0].provider).toBe("nvidia-nim");
		expect(chain[0].model).toBe("nvidia/llama-3.3-nemotron-super-49b-v1");
	});

	it("escalates after repeated failures", () => {
		const router = new ModelRouter();
		const model = router.resolve("worker");
		router.reportFailure("worker", model);
		router.reportFailure("worker", model);
		const next = router.resolve("worker");
		// After failures, should fall back to next in chain (ollama)
		expect(next.provider).toBe("ollama");
		expect(next.model).toBe("qwen2.5-coder-7b");
	});

	it("delegate uses nvidia-nim nano default", () => {
		const router = new ModelRouter();
		const model = router.resolve("delegate");
		expect(model.provider).toBe("nvidia-nim");
		expect(model.model).toBe("nvidia/llama-3.1-nemotron-nano-8b-v1");
	});
});
