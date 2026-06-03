/**
 * EngramReaderPlugin tests
 *
 * The plugin's read methods (`getRecentContext`, `searchContext`,
 * `getObservation`) are stubs that return empty results until the
 * real MCP transport is wired. We mock those methods to drive the
 * `/memory` slash command's formatting and routing.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	EngramReaderPlugin,
	type EngramObservation,
} from "./index.js";

describe("EngramReaderPlugin", () => {
	let plugin: EngramReaderPlugin;
	let mockRegistry: { register: ReturnType<typeof vi.fn> };
	let registeredHandler: (
		ctx: unknown,
		args: string,
	) => Promise<{ output: string; type: string }>;

	beforeEach(() => {
		vi.clearAllMocks();
		plugin = new EngramReaderPlugin();
		mockRegistry = { register: vi.fn() };
		// Initialize so mcpClient is non-null (otherwise the read
		// methods early-return []/null).
		plugin.initialize({
			getCommandRegistry: () => undefined,
			getToolRegistry: () => ({ register: () => {} }),
		} as any);
		plugin.registerCommands(mockRegistry as any);
		// Capture the registered handler.
		registeredHandler = mockRegistry.register.mock.calls[0][0].handler as any;
	});

	function mockObservations(...items: Partial<EngramObservation>[]): EngramObservation[] {
		return items.map((o, i) => ({
			id: o.id ?? i + 1,
			title: o.title ?? `obs ${i + 1}`,
			type: o.type ?? "discovery",
			content: o.content ?? "content",
			project: o.project,
			scope: o.scope,
			createdAt: o.createdAt ?? "2026-06-02T00:00:00Z",
		}));
	}

	describe("command registration", () => {
		it("registers /memory with /mem alias", () => {
			expect(mockRegistry.register).toHaveBeenCalledOnce();
			const cmd = mockRegistry.register.mock.calls[0][0];
			expect(cmd.name).toBe("memory");
			expect(cmd.aliases).toContain("mem");
			expect(typeof cmd.handler).toBe("function");
		});
	});

	describe("/memory help", () => {
		it("returns the help block when no subcommand is given", async () => {
			const r = await registeredHandler({}, "");
			expect(r.type).toBe("info");
			expect(r.output).toContain("Memory commands");
			expect(r.output).toContain("/memory recent");
			expect(r.output).toContain("/memory search");
			expect(r.output).toContain("/memory get");
		});

		it("also returns help when subcommand is 'help'", async () => {
			const r = await registeredHandler({}, "help");
			expect(r.output).toContain("Memory commands");
		});

		it("returns help for an unknown subcommand", async () => {
			const r = await registeredHandler({}, "wat");
			expect(r.output).toContain("Memory commands");
		});
	});

	describe("/memory recent", () => {
		it("shows observations for the current project (default)", async () => {
			vi.spyOn(plugin, "getRecentContext").mockResolvedValue(
				mockObservations(
					{ id: 1, title: "first", content: "x" },
					{ id: 2, title: "second", content: "y" },
				),
			);
			const r = await registeredHandler({}, "recent 5");
			expect(r.type).toBe("text");
			expect(r.output).toContain("Recent 2 observations");
			expect(r.output).toContain("first");
			expect(r.output).toContain("second");
		});

		it("shows '(none)' when no observations", async () => {
			vi.spyOn(plugin, "getRecentContext").mockResolvedValue([]);
			const r = await registeredHandler({}, "recent");
			expect(r.output).toContain("(none)");
		});

		it("clamps N to a sane range", async () => {
			const spy = vi
				.spyOn(plugin, "getRecentContext")
				.mockResolvedValue([]);
			await registeredHandler({}, "recent 9999");
			expect(spy).toHaveBeenCalledWith(expect.any(String), 50);
			await registeredHandler({}, "recent -5");
			expect(spy).toHaveBeenLastCalledWith(expect.any(String), 1);
		});

		it("uses 10 as the default count", async () => {
			const spy = vi
				.spyOn(plugin, "getRecentContext")
				.mockResolvedValue([]);
			await registeredHandler({}, "recent");
			expect(spy).toHaveBeenCalledWith(expect.any(String), 10);
		});

		it("truncates long content to 200 chars", async () => {
			const long = "a".repeat(500);
			vi.spyOn(plugin, "getRecentContext").mockResolvedValue(
				mockObservations({ id: 1, content: long }),
			);
			const r = await registeredHandler({}, "recent");
			// The preview line should be 200 chars + the ellipsis
			expect(r.output).toContain("…");
			expect(r.output.length).toBeLessThan(800);
		});
	});

	describe("/memory search", () => {
		it("shows search results", async () => {
			vi.spyOn(plugin, "searchContext").mockResolvedValue(
				mockObservations({ id: 7, title: "match" }),
			);
			const r = await registeredHandler({}, "search TODO");
			expect(r.type).toBe("text");
			expect(r.output).toContain('Search results for "TODO"');
			expect(r.output).toContain("1 hit");
			expect(r.output).toContain("match");
		});

		it("returns an error if no query is given", async () => {
			const r = await registeredHandler({}, "search");
			expect(r.type).toBe("error");
			expect(r.output).toContain("Usage: /memory search");
		});

		it("passes the project scope to searchContext", async () => {
			const spy = vi
				.spyOn(plugin, "searchContext")
				.mockResolvedValue([]);
			await registeredHandler({}, "project my-app");
			await registeredHandler({}, "search foo");
			expect(spy).toHaveBeenLastCalledWith("foo", "my-app");
		});
	});

	describe("/memory get", () => {
		it("shows the observation when it exists", async () => {
			vi.spyOn(plugin, "getObservation").mockResolvedValue(
				mockObservations({
					id: 42,
					title: "Found a bug",
					type: "bugfix",
					content: "Fixed N+1 query",
				})[0],
			);
			const r = await registeredHandler({}, "get 42");
			expect(r.type).toBe("text");
			expect(r.output).toContain("Observation #42");
			expect(r.output).toContain("Found a bug");
			expect(r.output).toContain("type: bugfix");
			expect(r.output).toContain("Fixed N+1 query");
		});

		it("returns info when the id doesn't exist", async () => {
			vi.spyOn(plugin, "getObservation").mockResolvedValue(null);
			const r = await registeredHandler({}, "get 999");
			expect(r.type).toBe("info");
			expect(r.output).toContain("No observation with id 999");
		});

		it("rejects non-numeric ids", async () => {
			const r = await registeredHandler({}, "get abc");
			expect(r.type).toBe("error");
			expect(r.output).toContain("Invalid observation id");
		});

		it("rejects non-positive ids", async () => {
			const r = await registeredHandler({}, "get -3");
			expect(r.type).toBe("error");
		});

		it("rejects zero as an id", async () => {
			const r = await registeredHandler({}, "get 0");
			expect(r.type).toBe("error");
		});
	});

	describe("/memory project", () => {
		it("shows the current project scope when no name is given", async () => {
			const r = await registeredHandler({}, "project");
			expect(r.type).toBe("info");
			expect(r.output).toContain("Current project scope");
			expect(r.output).toContain("miura-swarm");
		});

		it("sets the project scope for subsequent calls", async () => {
			const setR = await registeredHandler({}, "project my-app");
			expect(setR.type).toBe("success");
			expect(setR.output).toContain("Project scope set to `my-app`");
			const getR = await registeredHandler({}, "project");
			expect(getR.output).toContain("my-app");
		});

		it("persists project scope across multiple invocations", async () => {
			const spy = vi
				.spyOn(plugin, "getRecentContext")
				.mockResolvedValue([]);
			await registeredHandler({}, "project other-app");
			await registeredHandler({}, "recent");
			await registeredHandler({}, "search foo");
			expect(spy).toHaveBeenCalledWith("other-app", 10);
		});
	});

	describe("error handling", () => {
		it("catches and surfaces errors from the read methods", async () => {
			vi.spyOn(plugin, "getRecentContext").mockRejectedValue(
				new Error("MCP connection lost"),
			);
			const r = await registeredHandler({}, "recent");
			expect(r.type).toBe("error");
			expect(r.output).toContain("Memory command failed");
			expect(r.output).toContain("MCP connection lost");
		});
	});

	describe("formatting", () => {
		it("emits a single-line entry for an observation in recent/search", async () => {
			vi.spyOn(plugin, "getRecentContext").mockResolvedValue(
				mockObservations({
					id: 5,
					type: "pattern",
					title: "Use composition over inheritance",
					content: "Sets a strong default for new code.",
				}),
			);
			const r = await registeredHandler({}, "recent");
			expect(r.output).toContain("#5 [pattern] Use composition over inheritance");
			expect(r.output).toContain("Sets a strong default for new code.");
		});

		it("singularizes '1 observation' / '1 hit'", async () => {
			vi.spyOn(plugin, "searchContext").mockResolvedValue(
				mockObservations({ id: 1, title: "only" }),
			);
			const r = await registeredHandler({}, "search only");
			expect(r.output).toContain("1 hit");
			expect(r.output).not.toContain("1 hits");
		});
	});
});
