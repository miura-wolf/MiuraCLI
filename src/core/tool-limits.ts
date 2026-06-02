/**
 * Per-tool output limits.
 *
 * Why: model context windows are finite and small models get confused by
 * huge tool outputs. The roadmap's D.1 calls for caps per tool so a
 * single `read_file` of a 5k-line file or a `grep` of a noisy pattern
 * doesn't blow the budget for the rest of the loop.
 *
 * Design: a single tunable table + one helper (`truncateToolOutput`)
 * applied just before each tool returns its `output` string. When a
 * tool exceeds its cap, the visible text is trimmed and a short hint
 * is appended explaining how to ask for more.
 *
 * Tools that don't have a limit defined (write_file, edit_file) are
 * unaffected — they only return short status messages anyway.
 */

export interface ToolLimit {
	/** Max lines to show (for line-oriented output like read_file, grep, glob). */
	maxLines?: number;
	/** Max characters (for arbitrary text or as a safety net after line trim). */
	maxChars?: number;
	/** Short hint appended to the truncation note so the model knows how to ask for more. */
	hint?: string;
}

export const TOOL_LIMITS = {
	read_file: {
		maxLines: 200,
		maxChars: 50_000,
		hint: "Pass offset/limit to read more",
	},
	grep: {
		maxLines: 50,
		maxChars: 20_000,
		hint: "Narrow the pattern or pass a more specific path",
	},
	glob: {
		maxLines: 100,
		maxChars: 10_000,
		hint: "Narrow the pattern",
	},
	web_fetch: {
		maxChars: 50_000,
		hint: "Fetch a more specific URL or add a fragment (#section)",
	},
	run_shell_command: {
		maxChars: 30_000,
		hint: "Pipe to head/grep/tail or redirect to a file",
	},
} as const satisfies Record<string, ToolLimit>;

export type LimitedTool = keyof typeof TOOL_LIMITS;

export interface TruncationResult {
	/** The output, possibly trimmed and with a trailing truncation note. */
	output: string;
	/** True iff any trimming happened. */
	truncated: boolean;
	/** Original output size in characters. */
	originalSize: number;
	/** Size of the returned `output` in characters (includes the note). */
	visibleSize: number;
}

const NEWLINE = "\n";

/**
 * Apply the configured limit to a tool's output. If the output is within
 * the cap, returns it unchanged (no allocation, same string identity).
 *
 * Truncation strategy:
 *  1. If the tool has `maxLines` and the output has more than that many
 *     lines, keep only the first `maxLines` lines.
 *  2. If the (possibly already-trimmed) output exceeds `maxChars`, trim
 *     by characters. This is a safety net for very long single lines.
 *  3. If anything was trimmed, append a single-line note with counts
 *     and the tool's hint.
 */
export function truncateToolOutput(
	toolName: LimitedTool,
	output: string,
): TruncationResult {
	const limit = TOOL_LIMITS[toolName];
	const originalSize = output.length;

	let visible = output;
	let linesTrimmedFrom: number | null = null;

	// (1) Line-based trim.
	if (limit.maxLines !== undefined) {
		const lines = visible.split(/\r?\n/);
		if (lines.length > limit.maxLines) {
			linesTrimmedFrom = lines.length;
			visible = lines.slice(0, limit.maxLines).join(NEWLINE);
		}
	}

	// (2) Char-based safety net.
	if (limit.maxChars !== undefined && visible.length > limit.maxChars) {
		visible = visible.slice(0, limit.maxChars);
	}

	if (visible === output) {
		return { output, truncated: false, originalSize, visibleSize: originalSize };
	}

	// (3) Append the truncation note.
	const note = buildTruncationNote(
		visible,
		limit,
		linesTrimmedFrom,
		output,
	);
	return {
		output: visible + note,
		truncated: true,
		originalSize,
		visibleSize: visible.length + note.length,
	};
}

function buildTruncationNote(
	visible: string,
	limit: ToolLimit,
	originalLines: number | null,
	original: string,
): string {
	const parts: string[] = [];
	if (originalLines !== null) {
		const shownLines = visible.split(/\r?\n/).length;
		parts.push(`${shownLines} of ${originalLines} lines`);
	}
	if (original.length !== visible.length) {
		parts.push(`${visible.length} of ${original.length} chars`);
	}
	const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
	const hint = limit.hint ? ` ${limit.hint}.` : "";
	return `${NEWLINE}[... output truncated${detail}.${hint}]`;
}
