import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { editFileTool } from "./file-tool.js";
import { setDiffApprovalMode } from "../../core/diff-approval.js";
import { promises as fs } from "fs";
import { join } from "path";

const TMP = "tmp-edit-file-test";

describe("edit_file tool", () => {
	beforeEach(async () => {
		// Auto-approve so the approval gate doesn't block tests.
		setDiffApprovalMode("auto-approve");
		await fs.mkdir(TMP, { recursive: true });
	});
	afterEach(async () => {
		setDiffApprovalMode("prompt");
		await fs.rm(TMP, { recursive: true, force: true });
	});

	it("replaces a unique exact string", async () => {
		const rel = join(TMP, "a.ts");
		await fs.writeFile(rel, "const x = 1;\nconst y = 2;\n");
		const res = await editFileTool.execute({
			file_path: rel,
			old_string: "const x = 1;",
			new_string: "const x = 42;",
		});
		expect(res.error).toBeUndefined();
		expect(await fs.readFile(rel, "utf-8")).toBe("const x = 42;\nconst y = 2;\n");
	});

	it("errors when old_string is not found", async () => {
		const rel = join(TMP, "b.ts");
		await fs.writeFile(rel, "hello");
		const res = await editFileTool.execute({
			file_path: rel,
			old_string: "missing",
			new_string: "x",
		});
		expect(res.error).toBe("not-found");
	});

	it("errors when old_string is not unique (without replace_all)", async () => {
		const rel = join(TMP, "c.ts");
		await fs.writeFile(rel, "a\na\na\n");
		const res = await editFileTool.execute({
			file_path: rel,
			old_string: "a",
			new_string: "b",
		});
		expect(res.error).toBe("not-unique");
		// file unchanged
		expect(await fs.readFile(rel, "utf-8")).toBe("a\na\na\n");
	});

	it("replaces all occurrences when replace_all=true", async () => {
		const rel = join(TMP, "d.ts");
		await fs.writeFile(rel, "a\na\na\n");
		const res = await editFileTool.execute({
			file_path: rel,
			old_string: "a",
			new_string: "b",
			replace_all: true,
		});
		expect(res.error).toBeUndefined();
		expect(await fs.readFile(rel, "utf-8")).toBe("b\nb\nb\n");
	});

	it("errors when the file does not exist", async () => {
		const res = await editFileTool.execute({
			file_path: join(TMP, "nope.ts"),
			old_string: "x",
			new_string: "y",
		});
		expect(res.error).toBe("ENOENT");
	});
});
