/**
 * ContextBuilder — Composes the agent's system prompt with project context.
 *
 * Inspired by Claude Code's "see the project" feature. The agent no longer
 * starts blind: it knows cwd, OS, date, git branch, top-level project files,
 * CLAUDE.md, recent brain memories, and matched skills.
 *
 * Composition order (each block optional, failures are swallowed):
 *   1. Environment   (cwd, OS, date, branch, git status)
 *   2. Project tree  (top N entries, respecting .gitignore)
 *   3. Memory files  (CLAUDE.md, .miura/CLAUDE.md)
 *   4. Brain context (memories relevant to the input)
 *   5. Skills        (matched to the input)
 *   6. Base prompt   (the agent's own system prompt)
 *
 * Async by design: BrainManager.getRelevantContext is async, and the agent
 * loop is already async — no point in a sync facade.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";
import type { BrainManager } from "../plugins/memory/brain/brain-manager.js";
import type { SkillManagerPlugin } from "../plugins/knowledge/skill-manager/index.js";

/** Minimal interface the builder needs from the plugin host. Decoupled
 *  from PluginHostAPI so tests can pass a stub without a real host. */
export interface ContextHost {
	getBrainManager?(): BrainManager | undefined;
	getSkillManager?(): SkillManagerPlugin | undefined;
}

export interface ContextBuilderDeps {
	host: ContextHost;
	cwd?: string;
	maxProjectFiles?: number;
	maxBrainEntries?: number;
}

export interface ContextBuilderResult {
	prompt: string;
	blocks: {
		environment: boolean;
		projectTree: boolean;
		memoryFiles: boolean;
		brainContext: boolean;
		skills: boolean;
	};
}

export const DEFAULT_MAX_PROJECT_FILES = 50;
export const DEFAULT_MAX_BRAIN_ENTRIES = 5;

const MEMORY_FILE_CANDIDATES = [
	"CLAUDE.md",
	"AGENTS.md",
	".miura/CLAUDE.md",
	".miura/AGENTS.md",
];

const IGNORE_DIR_NAMES = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"target",
	".next",
	".turbo",
	"coverage",
	".cache",
	"out",
]);

const IGNORE_FILE_PATTERNS = [
	/\.lock$/,
	/\.log$/,
	/\.min\.(js|css)$/,
	/package-lock\.json$/,
	/yarn\.lock$/,
	/pnpm-lock\.yaml$/,
	/\.map$/,
];

/**
 * Try to read a list of files at the repo root. Returns the first one that
 * exists, with content, or null if none exist. Tries CLAUDE.md first, then
 * AGENTS.md and the .miura-scoped variants.
 */
function readMemoryFile(cwd: string): { path: string; content: string } | null {
	for (const rel of MEMORY_FILE_CANDIDATES) {
		const abs = join(cwd, rel);
		if (!existsSync(abs)) continue;
		try {
			const stat = statSync(abs);
			if (!stat.isFile()) continue;
			if (stat.size > 64 * 1024) continue; // hard cap, do not bloat prompt
			const content = readFileSync(abs, "utf-8");
			return { path: rel, content };
		} catch {
			continue;
		}
	}
	return null;
}

function safeGit(cwd: string, args: string[]): string | null {
	try {
		const out = execFileSync("git", args, {
			cwd,
			encoding: "utf-8",
			timeout: 2_000,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return out.trim() || null;
	} catch {
		return null;
	}
}

function buildEnvironmentBlock(cwd: string): string {
	const lines: string[] = ["## Environment", ""];
	lines.push(`- **cwd**: \`${cwd}\``);
	lines.push(`- **platform**: ${process.platform} (${process.arch})`);
	lines.push(`- **node**: ${process.version}`);
	lines.push(`- **date**: ${new Date().toISOString().slice(0, 10)}`);

	const branch = safeGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (branch) {
		lines.push(`- **git branch**: \`${branch}\``);
		const shortStatus = safeGit(cwd, [
			"status",
			"--porcelain",
			"--untracked-files=no",
		]);
		if (shortStatus) {
			const summary = shortStatus
				.split("\n")
				.slice(0, 10)
				.map((l) => `  - \`${l}\``)
				.join("\n");
			lines.push(`- **git status** (top 10):\n${summary}`);
		} else {
			lines.push("- **git status**: clean");
		}
	}
	return lines.join("\n");
}

function buildProjectTreeBlock(cwd: string, maxFiles: number): string | null {
	if (!existsSync(cwd)) return null;
	const collected: string[] = [];

	function walk(dir: string, depth: number): void {
		if (collected.length >= maxFiles) return;
		if (depth > 4) return; // cap depth — we want a sketch, not a dump
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		// Sort: directories first, then files, alphabetical
		entries.sort((a, b) => {
			const aIsDir = safeIsDir(join(dir, a));
			const bIsDir = safeIsDir(join(dir, b));
			if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
			return a.localeCompare(b);
		});
		for (const name of entries) {
			if (collected.length >= maxFiles) return;
			if (name.startsWith(".") && name !== ".miura" && name !== ".github") {
				continue;
			}
			if (IGNORE_DIR_NAMES.has(name)) continue;
			const abs = join(dir, name);
			if (safeIsDir(abs)) {
				walk(abs, depth + 1);
			} else if (!IGNORE_FILE_PATTERNS.some((re) => re.test(name))) {
				collected.push(relative(cwd, abs).split(sep).join("/"));
			}
		}
	}

	walk(cwd, 0);
	if (collected.length === 0) return null;

	const lines: string[] = [
		"## Project files",
		"",
		`_Top ${collected.length} entries (depth cap: 4, ignoring .git, node_modules, build, lockfiles, logs, source maps):_`,
		"",
	];
	for (const p of collected) {
		lines.push(`- \`${p}\``);
	}
	return lines.join("\n");
}

function safeIsDir(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function buildMemoryFilesBlock(cwd: string): string | null {
	const mem = readMemoryFile(cwd);
	if (!mem) return null;
	const lines: string[] = [
		`## Memory file: ${mem.path}`,
		"",
		mem.content.trim(),
		"",
	];
	return lines.join("\n");
}

async function buildBrainBlock(
	host: ContextHost,
	input: string,
	maxEntries: number,
): Promise<string | null> {
	let brain: ReturnType<NonNullable<ContextHost["getBrainManager"]>>;
	try {
		brain = host.getBrainManager?.();
	} catch {
		return null;
	}
	if (!brain) return null;
	try {
		const ctx = await brain.getRelevantContext(input, maxEntries);
		return ctx ? `${ctx}\n` : null;
	} catch {
		return null;
	}
}

function buildSkillsBlock(
	host: ContextHost,
	input: string,
): string | null {
	let sm: ReturnType<NonNullable<ContextHost["getSkillManager"]>>;
	try {
		sm = host.getSkillManager?.();
	} catch {
		return null;
	}
	if (!sm) return null;
	try {
		const content = sm.getInjectedContent(input);
		return content ? `${content}\n` : null;
	} catch {
		return null;
	}
}

/**
 * Build the full system prompt by composing the base agent prompt with
 * dynamic project context. Always returns a valid string; never throws.
 * Each block is best-effort and failures are reported in `blocks`.
 */
export async function buildSystemPrompt(
	basePrompt: string,
	input: string,
	deps: ContextBuilderDeps,
): Promise<ContextBuilderResult> {
	const cwd = deps.cwd ?? process.cwd();
	const maxFiles = deps.maxProjectFiles ?? DEFAULT_MAX_PROJECT_FILES;
	const maxBrain = deps.maxBrainEntries ?? DEFAULT_MAX_BRAIN_ENTRIES;

	const sections: string[] = [];
	const blocks = {
		environment: false,
		projectTree: false,
		memoryFiles: false,
		brainContext: false,
		skills: false,
	};

	// 1. Environment
	try {
		sections.push(buildEnvironmentBlock(cwd));
		blocks.environment = true;
	} catch {
		/* ignore */
	}

	// 2. Project tree
	try {
		const tree = buildProjectTreeBlock(cwd, maxFiles);
		if (tree) {
			sections.push(tree);
			blocks.projectTree = true;
		}
	} catch {
		/* ignore */
	}

	// 3. Memory files
	try {
		const mem = buildMemoryFilesBlock(cwd);
		if (mem) {
			sections.push(mem);
			blocks.memoryFiles = true;
		}
	} catch {
		/* ignore */
	}

	// 4. Brain context (async)
	const brainBlock = await buildBrainBlock(deps.host, input, maxBrain);
	if (brainBlock) {
		sections.push(brainBlock);
		blocks.brainContext = true;
	}

	// 5. Skills
	try {
		const skillBlock = buildSkillsBlock(deps.host, input);
		if (skillBlock) {
			sections.push(skillBlock);
			blocks.skills = true;
		}
	} catch {
		/* ignore */
	}

	// 6. Base prompt goes last so the agent's own "personality" anchors
	//    after the situational context (same order Claude Code uses).
	sections.push(basePrompt);

	return {
		prompt: sections.join("\n\n"),
		blocks,
	};
}
