import { describe, it, expect } from "bun:test";
import {
	truncateToolOutput,
	TOOL_LIMITS,
	type LimitedTool,
} from "./tool-limits.js";

describe("tool-limits: TOOL_LIMITS table", () => {
	it("defines a limit for every large-output tool", () => {
		const expected: LimitedTool[] = [
			"read_file",
			"grep",
			"glob",
			"web_fetch",
			"run_shell_command",
		];
		for (const name of expected) {
			expect(TOOL_LIMITS[name]).toBeDefined();
		}
	});

	it("does NOT define a limit for write_file / edit_file (short status output)", () => {
		// These tools only return short confirmation strings; no cap needed.
		// If someone adds a limit here, they should also know the test
		// below will start asserting on it.
		expect((TOOL_LIMITS as Record<string, unknown>).write_file).toBeUndefined();
		expect((TOOL_LIMITS as Record<string, unknown>).edit_file).toBeUndefined();
	});

	it("every limit has either maxLines or maxChars (or both)", () => {
		for (const [, limit] of Object.entries(TOOL_LIMITS)) {
			expect(
				limit.maxLines !== undefined || limit.maxChars !== undefined,
			).toBe(true);
		}
	});
});

describe("tool-limits: truncateToolOutput (under cap)", () => {
	it("returns the same string (no allocation) when output is small", () => {
		const out = "small output\nwith a few lines";
		const r = truncateToolOutput("read_file", out);
		expect(r.truncated).toBe(false);
		expect(r.output).toBe(out);
		expect(r.originalSize).toBe(out.length);
		expect(r.visibleSize).toBe(out.length);
	});

	it("returns the same string when line count equals the cap exactly", () => {
		// read_file cap is 200 lines; build exactly 200.
		const out = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
		const r = truncateToolOutput("read_file", out);
		expect(r.truncated).toBe(false);
		expect(r.output).toBe(out);
	});

	it("handles an empty string gracefully", () => {
		const r = truncateToolOutput("glob", "");
		expect(r.truncated).toBe(false);
		expect(r.output).toBe("");
		expect(r.originalSize).toBe(0);
	});
});

describe("tool-limits: truncateToolOutput (line-based)", () => {
	it("truncates read_file to 200 lines and reports the original count", () => {
		const lines = Array.from({ length: 500 }, (_, i) => `L${i}`);
		const out = lines.join("\n");
		const r = truncateToolOutput("read_file", out);
		expect(r.truncated).toBe(true);
		// Visible body has exactly 200 lines
		const visibleBody = r.output.split("\n[... output truncated")[0]!;
		expect(visibleBody.split("\n").length).toBe(200);
		// The note mentions both 200/500 lines and the hint
		expect(r.output).toContain("200 of 500 lines");
		expect(r.output).toContain("Pass offset/limit");
	});

	it("truncates grep to 50 matches", () => {
		const matches = Array.from({ length: 75 }, (_, i) => `src/x.ts:${i}: hit`);
		const r = truncateToolOutput("grep", matches.join("\n"));
		expect(r.truncated).toBe(true);
		const visibleBody = r.output.split("\n[... output truncated")[0]!;
		expect(visibleBody.split("\n").length).toBe(50);
		expect(r.output).toContain("50 of 75 lines");
	});

	it("truncates glob to 100 paths", () => {
		const paths = Array.from({ length: 250 }, (_, i) => `src/file${i}.ts`);
		const r = truncateToolOutput("glob", paths.join("\n"));
		expect(r.truncated).toBe(true);
		const visibleBody = r.output.split("\n[... output truncated")[0]!;
		expect(visibleBody.split("\n").length).toBe(100);
		expect(r.output).toContain("Narrow the pattern");
	});
});

describe("tool-limits: truncateToolOutput (char-based)", () => {
	it("truncates web_fetch by characters (no maxLines defined)", () => {
		const text = "x".repeat(80_000);
		const r = truncateToolOutput("web_fetch", text);
		expect(r.truncated).toBe(true);
		const body = r.output.split("\n[... output truncated")[0]!;
		expect(body.length).toBe(50_000);
		expect(r.output).toContain("50000 of 80000 chars");
		expect(r.output).toContain("Fetch a more specific URL");
	});

	it("truncates run_shell_command by characters", () => {
		const text = "y".repeat(45_000);
		const r = truncateToolOutput("run_shell_command", text);
		expect(r.truncated).toBe(true);
		const body = r.output.split("\n[... output truncated")[0]!;
		expect(body.length).toBe(30_000);
		expect(r.output).toContain("30000 of 45000 chars");
		expect(r.output).toContain("head/grep/tail");
	});
});

describe("tool-limits: truncateToolOutput (combined)", () => {
	it("applies line cap first, then char cap, and reports both", () => {
		// 300 lines, each 500 chars → 150,000 chars total.
		// read_file: maxLines=200 → 200 lines = 100,000 chars.
		// Then maxChars=50,000 → trim to 50,000 chars.
		const lines = Array.from({ length: 300 }, () => "a".repeat(500));
		const out = lines.join("\n");
		const r = truncateToolOutput("read_file", out);
		expect(r.truncated).toBe(true);
		const body = r.output.split("\n[... output truncated")[0]!;
		expect(body.length).toBeLessThanOrEqual(50_000);
		// Note should mention both line and char counts
		expect(r.output).toMatch(/lines/);
		expect(r.output).toMatch(/chars/);
	});

	it("preserves the trailing newline + note format", () => {
		// Build text > web_fetch's maxChars (50,000)
		const huge = "a".repeat(60_000);
		const r = truncateToolOutput("web_fetch", huge);
		expect(r.truncated).toBe(true);
		expect(r.output).toMatch(/\n\[\.\.\. output truncated[^\n]*\]$/);
	});
});

describe("tool-limits: safety properties", () => {
	it("never returns output longer than maxLines*max-line-len + note", () => {
		const out = "z".repeat(1_000_000);
		const r = truncateToolOutput("grep", out);
		// grep has no maxLines trigger here (no newlines), but maxChars=20,000
		const body = r.output.split("\n[... output truncated")[0]!;
		expect(body.length).toBeLessThanOrEqual(20_000);
	});

	it("truncation is idempotent — re-truncating the truncated output doesn't add more", () => {
		const out = Array.from({ length: 500 }, (_, i) => `L${i}`).join("\n");
		const r1 = truncateToolOutput("read_file", out);
		const r2 = truncateToolOutput("read_file", r1.output);
		// r2 may or may not be truncated further (the note itself fits
		// under the cap), but the visible body should be the same length.
		expect(r2.visibleSize).toBeLessThanOrEqual(r1.visibleSize + 1);
	});
});
