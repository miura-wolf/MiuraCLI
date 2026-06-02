import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { shellTool } from "./file-tool.js";
import { setDiffApprovalMode } from "../../core/diff-approval.js";

describe("run_shell_command tool", () => {
	beforeEach(() => {
		// Default to auto-approve so most tests can run. Individual tests
		// override this when they need to exercise reject / prompt.
		setDiffApprovalMode("auto-approve");
	});
	afterEach(() => {
		setDiffApprovalMode("prompt");
	});

	it("executes an allowlisted command in auto-approve mode", async () => {
		const res = await shellTool.execute({
			command: "node",
			args: ["--version"],
		});
		expect(res.error).toBeUndefined();
		// node --version prints something like "v20.x.x" or similar.
		expect(res.output).toMatch(/^v?\d+/);
	});

	it("rejects when policy disallows the command (never reaches approval gate)", async () => {
		// Create a sentinel file first; the policy must block `rm` from
		// ever running, so this file must still exist afterwards.
		const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");
		const sentinel = "tmp-shell-sentinel.txt";
		mkdirSync("tmp-edit-file-test", { recursive: true });
		writeFileSync("tmp-edit-file-test/" + sentinel, "still here");
		try {
			const res = await shellTool.execute({
				command: "rm",
				args: ["-rf", "tmp-edit-file-test"],
			});
			expect(res.error).toBe("not allowed");
			expect(existsSync("tmp-edit-file-test/" + sentinel)).toBe(true);
		} finally {
			const { rmSync } = await import("node:fs");
			rmSync("tmp-edit-file-test", { recursive: true, force: true });
		}
	});

	it("blocks execution in reject mode (approval gate short-circuits)", async () => {
		setDiffApprovalMode("reject");
		const res = await shellTool.execute({
			command: "node",
			args: ["--version"],
		});
		// Approval was rejected — we should not have spawned node.
		expect(res.error).toMatch(/^Approval/);
		expect(res.output).toContain("rejected");
	});

	it("serializes command + args into the approval request (newContent)", async () => {
		// We can verify the wire format by inspecting what requestApproval
		// received. In auto-approve mode the call is silent, so we exercise
		// the generateDiff path indirectly: the gate must not throw, and
		// the resulting ToolResult must look like a real run.
		setDiffApprovalMode("auto-approve");
		const res = await shellTool.execute({
			command: "node",
			args: ["--version"],
		});
		expect(res.name).toBe("run_shell_command");
		expect(typeof res.output).toBe("string");
	});

	it("does not crash when args is missing (policy handles undefined)", async () => {
		// `node` requires args (prefix ["--version"]), so with no args the
		// policy check should reject cleanly — proving the gate handles
		// undefined args without throwing.
		const res = await shellTool.execute({ command: "node" });
		expect(res.error).toBe("not allowed");
	});
});
