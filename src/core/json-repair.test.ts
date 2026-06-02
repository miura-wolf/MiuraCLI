import { describe, it, expect } from "bun:test";
import { tryRepairJson } from "./json-repair.js";

describe("json-repair: happy path", () => {
	it("parses strict JSON with no repairs", () => {
		const r = tryRepairJson('{"file_path":"a.ts","limit":10}');
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value).toEqual({ file_path: "a.ts", limit: 10 });
			expect(r.repairs).toEqual([]);
		}
	});

	it("parses arrays", () => {
		const r = tryRepairJson("[1, 2, 3]");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual([1, 2, 3]);
	});

	it("parses primitives", () => {
		expect(tryRepairJson("42").ok).toBe(true);
		expect(tryRepairJson('"hello"').ok).toBe(true);
		expect(tryRepairJson("true").ok).toBe(true);
		expect(tryRepairJson("null").ok).toBe(true);
	});
});

describe("json-repair: trailing comma", () => {
	it("removes trailing comma in object", () => {
		const r = tryRepairJson('{"a": 1, "b": 2,}');
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value).toEqual({ a: 1, b: 2 });
			expect(r.repairs).toContain("remove trailing commas");
		}
	});

	it("removes trailing comma in array", () => {
		const r = tryRepairJson("[1, 2, 3,]");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual([1, 2, 3]);
	});
});

describe("json-repair: unquoted keys", () => {
	it("quotes simple unquoted keys", () => {
		const r = tryRepairJson("{file_path: 'a.ts'}");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value).toEqual({ file_path: "a.ts" });
		}
	});

	it("quotes unquoted keys in nested objects", () => {
		const r = tryRepairJson("{outer: {inner: 1}}");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual({ outer: { inner: 1 } });
	});
});

describe("json-repair: single quotes", () => {
	it("converts single-quoted values", () => {
		const r = tryRepairJson("{'file_path': 'a.ts'}");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual({ file_path: "a.ts" });
	});

	it("preserves apostrophes inside double-quoted strings", () => {
		const r = tryRepairJson('{"a": "it\'s fine"}');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual({ a: "it's fine" });
	});
});

describe("json-repair: comments", () => {
	it("strips line comments", () => {
		const r = tryRepairJson('{"a": 1, // comment\n"b": 2}');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual({ a: 1, b: 2 });
	});

	it("strips block comments", () => {
		const r = tryRepairJson('{"a": 1, /* note */ "b": 2}');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual({ a: 1, b: 2 });
	});
});

describe("json-repair: Python literals", () => {
	it("converts True/False/None", () => {
		const r = tryRepairJson('{"a": True, "b": False, "c": None}');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual({ a: true, b: false, c: null });
	});
});

describe("json-repair: trailing semicolons", () => {
	it("removes a trailing semicolon at the end of the input", () => {
		const r = tryRepairJson('{"a": 1};');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual({ a: 1 });
	});
});

describe("json-repair: BOM", () => {
	it("strips a leading BOM", () => {
		const r = tryRepairJson('\uFEFF{"a": 1}');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual({ a: 1 });
	});
});

describe("json-repair: real-world model output", () => {
	it("repairs the typical small-model mess (unquoted key + trailing comma + comment)", () => {
		const r = tryRepairJson(
			'{file_path: "src/core/pipeline.ts", // the target\n limit: 50,}',
		);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value).toEqual({
				file_path: "src/core/pipeline.ts",
				limit: 50,
			});
		}
	});

	it("repairs Python-style arguments", () => {
		const r = tryRepairJson(
			"{'pattern': '*.ts', 'recursive': True, 'max_depth': None}",
		);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value).toEqual({
				pattern: "*.ts",
				recursive: true,
				max_depth: null,
			});
		}
	});
});

describe("json-repair: failure cases", () => {
	it("returns structured error for completely unparseable input", () => {
		const r = tryRepairJson("this is not json at all, just text");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.received).toBe("this is not json at all, just text");
			expect(typeof r.error).toBe("string");
		}
	});

	it("preserves the original `received` for the caller's error message", () => {
		const broken = "{file_path: 'a.ts'";
		const r = tryRepairJson(broken);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			// The full broken input is returned so the model can see exactly
			// what it sent.
			expect(r.received).toBe(broken);
		}
	});

	it("handles empty string gracefully", () => {
		const r = tryRepairJson("");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.received).toBe("");
	});
});

describe("json-repair: edge cases", () => {
	it("does NOT touch single quotes inside double-quoted strings (apostrophes)", () => {
		const r = tryRepairJson('{"msg": "it\'s a test"}');
		expect(r.ok).toBe(true);
		if (r.ok) expect((r.value as { msg: string }).msg).toBe("it's a test");
	});

	it("does NOT corrupt strings that look like comments", () => {
		// The string contains `//` and `/*` — must be preserved.
		const r = tryRepairJson('{"url": "https://x.com/path?q=1"}');
		expect(r.ok).toBe(true);
		if (r.ok) expect((r.value as { url: string }).url).toBe("https://x.com/path?q=1");
	});
});
