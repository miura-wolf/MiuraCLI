import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	buildSystemPrompt,
	DEFAULT_MAX_PROJECT_FILES,
	DEFAULT_MAX_BRAIN_ENTRIES,
} from "./context-builder.js";
import type { ContextHost } from "./context-builder.js";

let tmp: string;

function makeCwd(): string {
	tmp = mkdtempSync(join(tmpdir(), "ctx-builder-test-"));
	return tmp;
}

function emptyHost(): ContextHost {
	return {};
}

beforeEach(() => {
	makeCwd();
});

afterEach(() => {
	if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("buildSystemPrompt", () => {
	it("returns the base prompt with all blocks disabled when host is empty", async () => {
		const cwd = makeCwd();
		const res = await buildSystemPrompt("BASE_PROMPT", "user input", {
			host: emptyHost(),
			cwd,
		});
		expect(res.prompt).toContain("BASE_PROMPT");
		expect(res.blocks).toEqual({
			environment: true, // block always renders (cwd is always known)
			projectTree: false,
			memoryFiles: false,
			brainContext: false,
			skills: false,
		});
	});

	it("renders environment block with cwd, platform, date", async () => {
		const cwd = makeCwd();
		const res = await buildSystemPrompt("base", "x", { host: emptyHost(), cwd });
		expect(res.blocks.environment).toBe(true);
		expect(res.prompt).toContain("## Environment");
		expect(res.prompt).toContain(`\`${cwd}\``);
		expect(res.prompt).toContain("platform");
		expect(res.prompt).toMatch(/\d{4}-\d{2}-\d{2}/);
	});

	it("skips project tree when cwd is empty", async () => {
		const cwd = makeCwd(); // empty dir
		const res = await buildSystemPrompt("base", "x", { host: emptyHost(), cwd });
		expect(res.blocks.projectTree).toBe(false);
	});

	it("includes project tree for a non-empty cwd (respects common ignores)", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "index.ts"), "// hi");
		writeFileSync(join(cwd, "README.md"), "docs");
		mkdirSync(join(cwd, "src"));
		writeFileSync(join(cwd, "src", "app.ts"), "// app");
		// Should be ignored:
		mkdirSync(join(cwd, "node_modules"));
		writeFileSync(join(cwd, "node_modules", "lodash.js"), "// ignored");
		writeFileSync(join(cwd, "package-lock.json"), "{}");

		const res = await buildSystemPrompt("base", "x", { host: emptyHost(), cwd });
		expect(res.blocks.projectTree).toBe(true);
		expect(res.prompt).toContain("## Project files");
		expect(res.prompt).toContain("index.ts");
		expect(res.prompt).toContain("src/app.ts");
		// node_modules/lodash.js and package-lock.json must NOT appear as
		// entries in the file list (the word "node_modules" can legitimately
		// appear in the header that names the ignored dirs).
		const treeBlock = res.prompt.split("## Project files")[1] ?? "";
		const entries = treeBlock.split("\n").filter((l) => l.startsWith("- `"));
		expect(entries.some((e) => e.includes("node_modules"))).toBe(false);
		expect(entries.some((e) => e.includes("package-lock.json"))).toBe(false);
	});

	it("respects maxProjectFiles cap", async () => {
		const cwd = makeCwd();
		for (let i = 0; i < 20; i++) {
			writeFileSync(join(cwd, `f${i}.ts`), "");
		}
		const res = await buildSystemPrompt("base", "x", {
			host: emptyHost(),
			cwd,
			maxProjectFiles: 5,
		});
		expect(res.blocks.projectTree).toBe(true);
		// Count the listed entries in the project-files block
		const block = res.prompt.split("## Project files")[1] ?? "";
		const entries = block.split("\n").filter((l) => l.startsWith("- `"));
		expect(entries.length).toBeLessThanOrEqual(5);
	});

	it("reads CLAUDE.md as memory file when present", async () => {
		const cwd = makeCwd();
		writeFileSync(
			join(cwd, "CLAUDE.md"),
			"# Project rules\nNever commit secrets.\n",
		);
		const res = await buildSystemPrompt("base", "x", { host: emptyHost(), cwd });
		expect(res.blocks.memoryFiles).toBe(true);
		expect(res.prompt).toContain("## Memory file: CLAUDE.md");
		expect(res.prompt).toContain("Never commit secrets");
	});

	it("reads .miura/CLAUDE.md as fallback when root CLAUDE.md absent", async () => {
		const cwd = makeCwd();
		mkdirSync(join(cwd, ".miura"));
		writeFileSync(join(cwd, ".miura", "CLAUDE.md"), "from .miura");
		const res = await buildSystemPrompt("base", "x", { host: emptyHost(), cwd });
		expect(res.blocks.memoryFiles).toBe(true);
		expect(res.prompt).toContain("from .miura");
	});

	it("skips memory file when it exceeds 64KB (do not bloat prompt)", async () => {
		const cwd = makeCwd();
		writeFileSync(join(cwd, "CLAUDE.md"), "x".repeat(70_000));
		const res = await buildSystemPrompt("base", "x", { host: emptyHost(), cwd });
		expect(res.blocks.memoryFiles).toBe(false);
	});

	it("includes brain context when host exposes a brain manager", async () => {
		const cwd = makeCwd();
		const host: ContextHost = {
			getBrainManager: () =>
				({
					getRelevantContext: async (q: string) =>
						`## Relevant memories:\n**[decision] ${q}**\nmemory body\n`,
				}) as any,
		};
		const res = await buildSystemPrompt("base", "how to test", { host, cwd });
		expect(res.blocks.brainContext).toBe(true);
		expect(res.prompt).toContain("## Relevant memories:");
		expect(res.prompt).toContain("how to test");
	});

	it("gracefully handles brain throwing", async () => {
		const cwd = makeCwd();
		const host: ContextHost = {
			getBrainManager: () =>
				({
					getRelevantContext: async () => {
						throw new Error("db down");
					},
				}) as any,
		};
		const res = await buildSystemPrompt("base", "x", { host, cwd });
		expect(res.blocks.brainContext).toBe(false);
		// The base prompt is still there.
		expect(res.prompt).toContain("base");
	});

	it("includes skills block when host exposes a skill manager", async () => {
		const cwd = makeCwd();
		const host: ContextHost = {
			getSkillManager: () =>
				({
					getInjectedContent: (_ctx: string) =>
						"## Skill: tdd (core)\n*Triggered by: tdd*\n\nDo TDD.\n",
				}) as any,
		};
		const res = await buildSystemPrompt("base", "let's do TDD", { host, cwd });
		expect(res.blocks.skills).toBe(true);
		expect(res.prompt).toContain("## Skill: tdd");
	});

	it("does not crash when host getters throw", async () => {
		const cwd = makeCwd();
		const host: ContextHost = {
			getBrainManager: () => {
				throw new Error("boom");
			},
			getSkillManager: () => {
				throw new Error("boom");
			},
		};
		const res = await buildSystemPrompt("base", "x", { host, cwd });
		expect(res.blocks.brainContext).toBe(false);
		expect(res.blocks.skills).toBe(false);
		expect(res.prompt).toContain("base");
	});

	it("places the base prompt last (after context blocks)", async () => {
		const cwd = makeCwd();
		const res = await buildSystemPrompt("ZZZ_BASE", "x", { host: emptyHost(), cwd });
		const baseIdx = res.prompt.lastIndexOf("ZZZ_BASE");
		const envIdx = res.prompt.indexOf("## Environment");
		expect(envIdx).toBeGreaterThanOrEqual(0);
		expect(baseIdx).toBeGreaterThan(envIdx);
	});

	it("uses sensible defaults when no cwd provided", async () => {
		const res = await buildSystemPrompt("base", "x", { host: emptyHost() });
		expect(res.prompt).toContain("base");
		expect(res.prompt).toContain("## Environment");
	});

	it("exports the right default constants", () => {
		expect(DEFAULT_MAX_PROJECT_FILES).toBe(50);
		expect(DEFAULT_MAX_BRAIN_ENTRIES).toBe(5);
	});
});
