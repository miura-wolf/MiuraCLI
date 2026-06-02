import type { Plugin, PluginHostAPI } from "../../core/types.js";
import type { ToolHandler, ToolResult } from "../../core/types.js";
import { promises as fs } from "fs";
import { isAbsolute, resolve } from "path";
import { spawn as spawnChild } from "child_process";
import { isIP } from "node:net";
import { getRuntimeConfig, isCommandAllowed } from "../../config.js";

import { getDiffApprovalService } from "../../core/diff-approval.js";

// Safety: restrict to current working directory and below
function safeJoin(base: string, target: string): string {
	if (isAbsolute(target)) {
		throw new Error("Absolute paths not allowed");
	}
	const baseResolved = resolve(base);
	const full = resolve(baseResolved, target);
	const basePrefix =
		baseResolved.endsWith("\\") || baseResolved.endsWith("/")
			? baseResolved
			: `${baseResolved}\\`;
	if (full !== baseResolved && !full.startsWith(basePrefix)) {
		throw new Error("Path traversal not allowed");
	}
	return full;
}

const runtimeConfig = getRuntimeConfig();

function isBlockedHost(hostname: string): boolean {
	const host = hostname.trim().toLowerCase();
	if (!host) return true;
	if (host === "localhost") return true;
	if (host.endsWith(".local")) return true;
	if (host === "0.0.0.0" || host === "::" || host === "::1") return true;

	const ipVersion = isIP(host);
	if (ipVersion === 4) {
		const parts = host.split(".").map(Number);
		if (parts[0] === 10) return true;
		if (parts[0] === 127) return true;
		if (parts[0] === 169 && parts[1] === 254) return true;
		if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
		if (parts[0] === 192 && parts[1] === 168) return true;
		return false;
	}

	if (ipVersion === 6) {
		if (host.startsWith("fc") || host.startsWith("fd")) return true;
		if (host.startsWith("fe80:")) return true;
		return false;
	}

	return false;
}

function isAllowedWebHost(hostname: string): boolean {
	const allowlist = runtimeConfig.webFetchAllowlist;
	if (allowlist.length === 0) return true;
	const host = hostname.toLowerCase();
	return allowlist.some(
		(allowed) => host === allowed || host.endsWith(`.${allowed}`),
	);
}

// ─── Glob → Regex ─────────────────────────────────────────────────────────────

function globToRegex(pattern: string): RegExp {
	const parts = pattern.split("**");
	let prefix = "";
	let suffix = "";

	if (parts.length === 1) {
		suffix = parts[0];
	} else {
		prefix = parts.slice(0, -1).join("**");
		suffix = parts[parts.length - 1];
	}

	// Directory pattern: (?:segment* + sep)*
	// Using * (zero-or-more) not + so last segment doesn't require sep.
	// Matches both / and \ on Windows.
	const dirPart = "(?:[^/\\]*[\\/])*";

	// Build suffix regex from full suffix (may start with /)
	const metaRx = /[.+^\${}|\\]/g;
	const suffixRx = suffix
		.replace(metaRx, "\$\&")
		.replace("*", "[^/\\]+")
		.replace("?", "[^/\\]");

	// Build prefix: escape, convert *, strip leading separators
	const prefixRx = prefix
		.replace(metaRx, "\$\&")
		.replace("*", "[^/\\]+")
		.replace("?", "[^/\\]")
		.replace(/^[\\/]+/, "");

	const rx = "^" + prefixRx + dirPart + suffixRx + "$";
	return new RegExp(rx);
}
function walkDirGlob(root: string, pattern: string): string[] {
	const { readdirSync } = require("fs") as typeof import("fs");
	const results: string[] = [];
	const isRecursive = pattern.includes("**");
	let regex: RegExp;
	try {
		regex = globToRegex(pattern);
	} catch {
		return results;
	}

	const walk = (dir: string) => {
		try {
			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				const full = dir + "\\" + entry.name;
				if (entry.isDirectory() && isRecursive) walk(full);
				else if (entry.isFile()) {
					const rel = full.slice(root.length + 1);
					if (regex.test(rel)) results.push(rel);
				}
			}
		} catch {
			/* skip inaccessible dirs */
		}
	};

	walk(root);
	return results;
}

// ─── Tools ─────────────────────────────────────────────────────────────────────

/** read_file tool */
export const readFileTool: ToolHandler = {
	definition: {
		name: "read_file",
		description: "Read a text file from disk.",
		parameters: {
			type: "object",
			properties: {
				file_path: { type: "string" },
				offset: { type: "number", default: 0 },
				limit: { type: "number" },
			},
			required: ["file_path"],
			additionalProperties: false,
		},
	},
	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		const {
			file_path,
			offset = 0,
			limit,
		} = args as { file_path: string; offset?: number; limit?: number };
		const cwd = process.cwd();
		const abs = safeJoin(cwd, file_path);
		const data = await fs.readFile(abs, "utf-8");
		const lines = data.split(/\r?\n/);
		const slice = lines.slice(
			offset as number,
			(offset as number) + (limit ?? lines.length),
		);
		return { name: "read_file", output: slice.join("\n"), durationMs: 0 };
	},
};

/** write_file tool */
export const writeFileTool: ToolHandler = {
	definition: {
		name: "write_file",
		description: "Write content to a file, creating it if needed.",
		parameters: {
			type: "object",
			properties: {
				file_path: { type: "string" },
				content: { type: "string" },
			},
			required: ["file_path", "content"],
			additionalProperties: false,
		},
	},
	async execute(
		args: Record<string, unknown>,
		ctx?: { requestedBy?: string },
	): Promise<ToolResult> {
		const { file_path, content } = args as {
			file_path: string;
			content: string;
		};
		const cwd = process.cwd();
		const abs = safeJoin(cwd, file_path);

		const diffService = getDiffApprovalService();

		let oldContent: string | null = null;
		try {
			oldContent = await fs.readFile(abs, "utf-8");
		} catch {
			// File doesn't exist yet
		}

		const { approved, result } = await diffService.requestApproval({
			filePath: abs,
			newContent: content,
			oldContent,
			action: oldContent ? "edit" : "create",
			requestedBy: ctx?.requestedBy ?? "agent",
		});

		if (!approved) {
			return {
				name: "write_file",
				output: `Write to ${file_path} was ${result} by user`,
				error: `Approval ${result}`,
				durationMs: 0,
			};
		}

		await fs.writeFile(abs, content, "utf-8");
		return {
			name: "write_file",
			output: `Wrote ${content.length} bytes to ${file_path}`,
			durationMs: 0,
		};
	},
};

/** edit_file tool — surgical exact-string replacement (no full rewrite) */
export const editFileTool: ToolHandler = {
	definition: {
		name: "edit_file",
		description:
			"Replace an exact string in an existing file. Safer than write_file: " +
			"it edits in place instead of rewriting the whole file. old_string must " +
			"match exactly and be unique (unless replace_all is true).",
		parameters: {
			type: "object",
			properties: {
				file_path: { type: "string" },
				old_string: { type: "string", description: "Exact text to replace" },
				new_string: { type: "string", description: "Replacement text" },
				replace_all: {
					type: "boolean",
					description: "Replace every occurrence instead of requiring uniqueness",
					default: false,
				},
			},
			required: ["file_path", "old_string", "new_string"],
			additionalProperties: false,
		},
	},
	async execute(
		args: Record<string, unknown>,
		ctx?: { requestedBy?: string },
	): Promise<ToolResult> {
		const {
			file_path,
			old_string,
			new_string,
			replace_all = false,
		} = args as {
			file_path: string;
			old_string: string;
			new_string: string;
			replace_all?: boolean;
		};
		const cwd = process.cwd();
		const abs = safeJoin(cwd, file_path);

		let oldContent: string;
		try {
			oldContent = await fs.readFile(abs, "utf-8");
		} catch {
			return {
				name: "edit_file",
				output: `File not found: ${file_path}`,
				error: "ENOENT",
				durationMs: 0,
			};
		}

		if (old_string === new_string) {
			return {
				name: "edit_file",
				output: "old_string and new_string are identical — nothing to do",
				error: "no-op",
				durationMs: 0,
			};
		}

		// Count occurrences to enforce uniqueness unless replace_all.
		let count = 0;
		let idx = oldContent.indexOf(old_string);
		while (idx !== -1) {
			count++;
			idx = oldContent.indexOf(old_string, idx + old_string.length);
		}

		if (count === 0) {
			return {
				name: "edit_file",
				output: `old_string not found in ${file_path}`,
				error: "not-found",
				durationMs: 0,
			};
		}
		if (count > 1 && !replace_all) {
			return {
				name: "edit_file",
				output: `old_string matches ${count} times in ${file_path}; pass replace_all=true or add more context to make it unique`,
				error: "not-unique",
				durationMs: 0,
			};
		}

		const newContent = replace_all
			? oldContent.split(old_string).join(new_string)
			: oldContent.replace(old_string, new_string);

		const diffService = getDiffApprovalService();
		const { approved, result } = await diffService.requestApproval({
			filePath: abs,
			newContent,
			oldContent,
			action: "edit",
			requestedBy: ctx?.requestedBy ?? "agent",
		});

		if (!approved) {
			return {
				name: "edit_file",
				output: `Edit to ${file_path} was ${result} by user`,
				error: `Approval ${result}`,
				durationMs: 0,
			};
		}

		await fs.writeFile(abs, newContent, "utf-8");
		return {
			name: "edit_file",
			output: `Edited ${file_path} (${count} replacement${count === 1 ? "" : "s"})`,
			durationMs: 0,
		};
	},
};

/** grep tool */
export const grepTool: ToolHandler = {
	definition: {
		name: "grep",
		description: "Search file contents using a regular expression.",
		parameters: {
			type: "object",
			properties: {
				pattern: { type: "string" },
				path: { type: "string", default: "." },
			},
			required: ["pattern"],
			additionalProperties: false,
		},
	},
	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		const { pattern, path = "." } = args as { pattern: string; path?: string };
		const cwd = process.cwd();

		let regex: RegExp;
		try {
			regex = new RegExp(pattern);
		} catch (e) {
			return {
				name: "grep",
				output: `Invalid regex pattern "${pattern}": ${(e as Error).message}`,
				error: "bad regex",
				durationMs: 0,
			};
		}

		let searchFiles: string[] = [];
		if (path.includes("*") || path.includes("?")) {
			searchFiles = walkDirGlob(cwd, path);
		} else {
			const absPath = safeJoin(cwd, path);
			searchFiles = walkDirGlob(absPath, "**/*");
		}

		if (searchFiles.length === 0) {
			return {
				name: "grep",
				output: `No files found matching: ${path}`,
				durationMs: 0,
			};
		}

		const allMatches: string[] = [];
		for (const file of searchFiles) {
			const fullPath = safeJoin(cwd, file);
			try {
				const data = await fs.readFile(fullPath, "utf-8");
				const lines = data.split(/\r?\n/);
				lines.forEach((line, i) => {
					if (regex.test(line)) {
						allMatches.push(`${file}:${i + 1}: ${line}`);
					}
				});
			} catch {
				/* skip unreadable files */
			}
		}

		return { name: "grep", output: allMatches.join("\n"), durationMs: 0 };
	},
};

/** glob tool */
export const globTool: ToolHandler = {
	definition: {
		name: "glob",
		description: "Find files matching a glob pattern.",
		parameters: {
			type: "object",
			properties: {
				pattern: { type: "string" },
				path: { type: "string", default: "." },
			},
			required: ["pattern"],
			additionalProperties: false,
		},
	},
	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		const { pattern } = args as { pattern: string; path?: string };
		const cwd = process.cwd();
		safeJoin(cwd, ".");
		let files: string[] = [];
		try {
			const raw = await (fs as any).glob?.(pattern);
			if (Array.isArray(raw)) files = raw;
		} catch {
			/* skip native glob */
		}
		if (files.length === 0) {
			try {
				files = walkDirGlob(cwd, pattern);
			} catch {
				files = [];
			}
		}
		return { name: "glob", output: files.join("\n"), durationMs: 0 };
	},
};

/** run_shell_command tool */
export const shellTool: ToolHandler = {
	definition: {
		name: "run_shell_command",
		description: "Run a shell command (allowlisted for safety).",
		parameters: {
			type: "object",
			properties: {
				command: { type: "string" },
				args: { type: "array", items: { type: "string" } },
			},
			required: ["command"],
			additionalProperties: false,
		},
	},
	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		const { command, args: cmdArgs = [] } = args as {
			command: string;
			args?: string[];
		};

		if (
			!isCommandAllowed(
				runtimeConfig.commandPolicy,
				command,
				Array.isArray(cmdArgs) ? cmdArgs : [],
			)
		) {
			return {
				name: "run_shell_command",
				output:
					`Command not allowed by policy: ${command} ${(cmdArgs ?? []).join(" ")}`.trim(),
				error: "not allowed",
				durationMs: 0,
			};
		}

		// Approval gate (after policy allowlist, before spawn).
		// Mirrors the gate in write_file / edit_file so every mutating
		// tool goes through DiffApprovalService — without this, the
		// agent can run arbitrary shell commands without user consent.
		const diffService = getDiffApprovalService();
		const safeArgs = Array.isArray(cmdArgs) ? cmdArgs : [];
		const fullCommand = [command, ...safeArgs].join(" ");
		const { approved, result } = await diffService.requestApproval({
			filePath: "<shell>",
			newContent: fullCommand,
			oldContent: null,
			action: "execute",
			requestedBy: "agent",
		});

		if (!approved) {
			return {
				name: "run_shell_command",
				output: `Execution of \`${fullCommand}\` was ${result} by user`,
				error: `Approval ${result}`,
				durationMs: 0,
			};
		}

		const proc = spawnChild(command, Array.isArray(cmdArgs) ? cmdArgs : [], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let output = "";
		proc.stdout?.on("data", (data) => {
			output += data.toString();
		});

		await new Promise<void>((resolve, reject) => {
			proc.on("close", (code) => {
				if (code === 0) resolve();
				else reject(new Error(`Command exited with code ${code}`));
			});
			proc.on("error", reject);
		});

		return { name: "run_shell_command", output: output.trim(), durationMs: 0 };
	},
};

/** web_fetch tool */
export const webFetchTool: ToolHandler = {
	definition: {
		name: "web_fetch",
		description: "Fetch content from a URL.",
		parameters: {
			type: "object",
			properties: {
				url: { type: "string", format: "uri" },
				method: { type: "string", enum: ["GET", "POST"] },
				body: { type: "string" },
				headers: { type: "object", additionalProperties: { type: "string" } },
			},
			required: ["url"],
			additionalProperties: false,
		},
	},
	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		const {
			url,
			method = "GET",
			body,
			headers,
		} = args as {
			url: string;
			method?: "GET" | "POST";
			body?: string;
			headers?: Record<string, string>;
		};

		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error("Only http/https URLs are allowed");
		}
		if (isBlockedHost(parsed.hostname)) {
			throw new Error("Blocked host for security reasons");
		}
		if (!isAllowedWebHost(parsed.hostname)) {
			throw new Error(
				`Host not allowed by MIURA_WEB_ALLOWLIST: ${parsed.hostname}`,
			);
		}

		const response = await fetch(url, { method, headers, body });

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const text = await response.text();
		return { name: "web_fetch", output: text, durationMs: 0 };
	},
};

export const fileToolPlugin: Plugin = {
	manifest: {
		id: "file-tool",
		name: "File System Tool Plugin",
		version: "0.1.0",
		type: "tool" as const,
		capabilities: [
			"read_file",
			"write_file",
			"edit_file",
			"grep",
			"glob",
			"run_shell_command",
			"web_fetch",
		],
	},
	async initialize(host: PluginHostAPI): Promise<void> {
		const registry = host.getToolRegistry();
		registry.register(readFileTool);
		registry.register(writeFileTool);
		registry.register(editFileTool);
		registry.register(grepTool);
		registry.register(globTool);
		registry.register(shellTool);
		registry.register(webFetchTool);
	},
};

export default fileToolPlugin;
