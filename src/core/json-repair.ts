/**
 * JSON repair for small-model tool-call arguments.
 *
 * Why: local / small / open-weight models frequently emit *almost-valid*
 * JSON in their `tool_calls[].function.arguments` strings — trailing
 * commas, single quotes, unquoted keys, JS comments, Python booleans,
 * etc. Strict `JSON.parse` throws on all of these, leaving the caller
 * to either crash the turn or fall back to a raw string the tool
 * handler can't use.
 *
 * Strategy: try strict JSON.parse first. If that fails, apply a fixed
 * sequence of conservative, well-known repairs (one at a time, with a
 * parse attempt between each) until something parses or we run out of
 * ideas. Repairs are ordered from cheapest/safest (BOM, comments) to
 * most aggressive (single quotes → double quotes), so a fix that would
 * have side effects in strings is only attempted if nothing else worked.
 *
 * This is intentionally NOT a general JSON5/JSONC parser: it's a
 * best-effort patcher for the *common* mistakes small models make. The
 * caller is expected to surface the structured `{ok: false, error, received}`
 * to the model so it can self-correct on the next turn.
 */

export type JsonRepairResult<T = unknown> =
	| { ok: true; value: T; repairs: string[] }
	| { ok: false; error: string; received: string };

type RepairStep = [name: string, fn: (s: string) => string];

const REPAIR_STEPS: RepairStep[] = [
	[
		"strip BOM",
		(s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s),
	],
	["strip line comments", (s) => s.replace(/\/\/[^\n]*/g, "")],
	[
		"strip block comments",
		(s) => s.replace(/\/\*[\s\S]*?\*\//g, ""),
	],
	[
		"remove trailing commas",
		(s) => s.replace(/,(\s*[}\]])/g, "$1"),
	],
	[
		"remove trailing semicolons",
		(s) => s.replace(/;(\s*[}\]]|\s*$)/, "$1"),
	],
	[
		"Python booleans → JSON",
		(s) =>
			s
				.replace(/\bTrue\b/g, "true")
				.replace(/\bFalse\b/g, "false")
				.replace(/\bNone\b/g, "null"),
	],
		[
			"quote unquoted keys",
			(s) =>
				s.replace(
					/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g,
					'$1"$2":',
				),
		],
		[
			// Single-quoted strings after `{`, `[`, `,`, or `:`. The content
			// is captured as a non-greedy run of non-`'` chars (or escapes),
			// so `"it's"` inside a double-quoted key is left alone.
			"single quotes → double quotes",
			(s) =>
				s.replace(
					/([{,[]\s*|:\s*)'((?:\\.|[^'\\])*)'/g,
					'$1"$2"',
				),
		],
];

/**
 * Try to parse `input` as JSON. If strict parsing fails, apply a series
 * of well-known repairs and retry. Returns a structured result so the
 * caller can decide what to do with malformed input — typically,
 * surface `received` and `error` to the model so it self-corrects.
 */
export function tryRepairJson<T = unknown>(input: string): JsonRepairResult<T> {
	const received = input;

	// (1) Strict parse first — happy path, no allocations.
	try {
		return { ok: true, value: JSON.parse(input) as T, repairs: [] };
	} catch {
		// fall through to repairs
	}

	// (2) Apply each repair in order. After every step, try strict
	// parse again — if it works, we're done.
	const repairs: string[] = [];
	let candidate = input;
	for (const [name, repair] of REPAIR_STEPS) {
		const next = repair(candidate);
		if (next === candidate) continue;
		candidate = next;
		repairs.push(name);
		try {
			return {
				ok: true,
				value: JSON.parse(candidate) as T,
				repairs,
			};
		} catch {
			// keep trying the next repair
		}
	}

	// (3) Nothing worked. Return a structured failure so the caller can
	// surface the original input back to the model.
	return {
		ok: false,
		error: "Could not parse arguments as JSON, even after repairs",
		received,
	};
}
