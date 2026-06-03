/**
 * CommandRegistry tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommandRegistry } from "./command-registry.js";

describe("CommandRegistry", () => {
	let registry: CommandRegistry;

	// Minimal mock context — only override what's needed per test
	function makeCtx(
		overrides: Partial<import("./command-registry.js").CommandContext> = {},
	) {
		return {
			miura: {
				getStatus: vi.fn().mockResolvedValue({
					agents: [],
					tasks: { pending: 0, active: 0, completed: 0, failed: 0 },
					plugins: [],
					modelRouting: { defaults: {}, fallbacks: {}, capabilities: {} },
				}),
				getConfig: vi.fn().mockReturnValue({
					defaults: {
						planner: { provider: "deepseek", model: "v4-flash" },
						worker: { provider: "qwen", model: "3-coder" },
						reviewer: { provider: "glm", model: "5.1" },
						scout: { provider: "groq", model: "llama-3.3-70b" },
						oracle: { provider: "deepseek", model: "v4-pro" },
						researcher: { provider: "groq", model: "mixtral-8x7b" },
						"context-builder": { provider: "qwen", model: "3-coder" },
						delegate: { provider: "google", model: "gemma-4" },
					},
					fallbacks: {},
					capabilities: {},
				}),
				runPipeline: vi.fn().mockResolvedValue({
					pipelineId: "test-pipeline-1",
					finalOutput: "Pipeline complete.",
				}),
				runAgent: vi.fn().mockResolvedValue({
					output: "Agent output.",
				}),
				getAdapters: vi.fn().mockReturnValue(new Map([["claude", {}]])),
				getCompactionManager: vi.fn().mockReturnValue(undefined),
				getOpenSpecManager: vi.fn().mockReturnValue(undefined),
				getMCPClient: vi.fn().mockReturnValue(undefined),
				getBrainManager: vi.fn().mockReturnValue(undefined),
			} as any,
			session: {
				incPipelines: vi.fn(),
				incAgents: vi.fn(),
				messageCount: 0,
				pipelineCount: 0,
				agentCount: 0,
				id: "test-session",
				close: vi.fn(),
				clearMessages: vi.fn(),
				getRecentMessages: vi.fn().mockReturnValue([]),
			},
			rawArgs: "",
			...overrides,
		} as any;
	}

	beforeEach(() => {
		registry = new CommandRegistry();
		vi.clearAllMocks();
	});

	describe("match()", () => {
		it("returns null for plain text (no slash)", () => {
			expect(registry.match("hello world")).toBeNull();
		});

		it("matches /chat command", () => {
			const result = registry.match("/chat hello");
			expect(result).not.toBeNull();
			expect(result!.cmd.name).toBe("chat");
			expect(result!.args).toBe("hello");
		});

		it("extracts args correctly", () => {
			const result = registry.match("/chat fix the auth bug");
			expect(result!.args).toBe("fix the auth bug");
		});

		it("handles command with no args", () => {
			const result = registry.match("/plan");
			expect(result!.cmd.name).toBe("plan");
			expect(result!.args).toBe("");
		});

		it("matches command aliases", () => {
			const result = registry.match("/r some diff");
			expect(result).not.toBeNull();
			expect(result!.cmd.name).toBe("review");
		});

		it("returns null for unknown command", () => {
			expect(registry.match("/unknown-cmd")).toBeNull();
		});

		it("trims whitespace before command", () => {
			const result = registry.match("  /plan");
			expect(result).not.toBeNull();
			expect(result!.cmd.name).toBe("plan");
		});
	});

	describe("listAll()", () => {
		it("returns all registered commands", () => {
			const all = registry.listAll();
			expect(all.length).toBeGreaterThanOrEqual(19);
			const names = all.map((c) => c.name);
			expect(names).toContain("chat");
			expect(names).toContain("review");
			expect(names).toContain("plan");
			expect(names).toContain("exit");
		});
	});

	describe("formatHelp()", () => {
		it("includes command names in help output", () => {
			const help = registry.formatHelp();
			expect(help).toContain("/chat");
			expect(help).toContain("/review");
			expect(help).toContain("/plan");
		});
	});

	describe("/help", () => {
		it("returns help command for /help", () => {
			const result = registry.match("/help");
			expect(result).not.toBeNull();
			expect(result!.cmd.name).toBe("help");
		});

		it("matches help aliases", () => {
			expect(registry.match("/?")).not.toBeNull();
			expect(registry.match("/h")).not.toBeNull();
		});
	});

	describe("/plan command", () => {
		it("returns task queue info", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("plan")!;
			const result = await cmd.handler(ctx, "");
			expect(result.type).toBe("info");
			expect(result.output).toContain("pending:");
			expect(result.output).toContain("completed:");
		});
	});

	describe("/tokens command", () => {
		it("shows session stats", async () => {
			const session = {
				id: "test-id",
				messageCount: 5,
				pipelineCount: 3,
				agentCount: 7,
				getRecentMessages: vi.fn().mockReturnValue([
					{ role: "user", content: "a", timestamp: 1 },
					{ role: "user", content: "b", timestamp: 2 },
					{ role: "assistant", content: "c", timestamp: 3 },
				]),
			};
			const ctx = makeCtx({ session } as any);
			const cmd = registry.get("tokens")!;
			const result = await cmd.handler(ctx, "");
			expect(result.type).toBe("info");
			expect(result.output).toContain("test-id");
			expect(result.output).toContain("Pipelines run: 3");
			expect(result.output).toContain("Agents run: 7");
		});
	});

	describe("/model command", () => {
		it("shows all model assignments when no role given", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("model")!;
			const result = await cmd.handler(ctx, "");
			expect(result.type).toBe("info");
			expect(result.output).toContain("planner");
			expect(result.output).toContain("nvidia-nim"); // NVIDIA NIM as default
			expect(result.output).toContain("SDD Phases"); // Shows SDD phase routing
		});

		it("shows specific role model when role given", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("model")!;
			const result = await cmd.handler(ctx, "planner");
			expect(result.type).toBe("info");
			expect(result.output).toContain("planner");
			expect(result.output).toContain("nvidia-nim"); // NVIDIA NIM as default
		});

		it("returns error for unknown role", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("model")!;
			const result = await cmd.handler(ctx, "unknown-role");
			expect(result.type).toBe("error");
		});
	});

	describe("/brain command", () => {
		it("shows error when brain not loaded", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("brain")!;
			const result = await cmd.handler(ctx, "");
			// Without brain plugin, shows error
			expect(result.type).toBe("error");
			expect(result.output).toContain("not loaded");
		});

		it('clears memory when "clear" arg', async () => {
			const brain = {
				getRecent: vi.fn().mockResolvedValue([]),
				search: vi.fn().mockResolvedValue([]),
				countByType: vi.fn().mockResolvedValue(0),
				save: vi.fn().mockResolvedValue({} as any),
			};
			const session = {
				clearMessages: vi.fn(),
				id: "test",
				messageCount: 0,
				getRecentMessages: vi.fn().mockReturnValue([]),
			} as any;
			const ctx = makeCtx({ session });
			ctx.miura.getBrainManager = vi.fn().mockReturnValue(brain);
			const cmd = registry.get("brain")!;
			const result = await cmd.handler(ctx, "clear");
			expect(session.clearMessages).toHaveBeenCalled();
			expect(result.type).toBe("success");
		});
	});

	describe("/skills command", () => {
		it("shows usage info when no subcommand given", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("skills")!;
			const result = await cmd.handler(ctx, "");
			// Without a SkillManager in the test mock, shows usage
			expect(result.type).toBe("info");
			expect(result.output).toContain("/skills");
		});

		it("shows usage info for unrecognized subcommand", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("skills")!;
			// 'tdd' is not a known subcommand, shows usage info
			const result = await cmd.handler(ctx, "tdd");
			expect(result.type).toBe("info");
			expect(result.output).toContain("/skills");
		});

		it("returns error for unknown skill when SkillManager is unavailable", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("skills")!;
			// nonexistent subcommand or skill → info (usage shown)
			const result = await cmd.handler(ctx, "nonexistent-skill");
			expect(result.type).toBe("info");
		});
	});

	describe("/exit command", () => {
		it("returns __EXIT__ marker", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("exit")!;
			const result = await cmd.handler(ctx, "");
			expect(result.output).toBe("__EXIT__");
			expect(result.type).toBe("success");
		});
	});

	describe("/clear command", () => {
		it("returns __CLEAR__ marker", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("clear")!;
			const result = await cmd.handler(ctx, "");
			expect(result.output).toBe("__CLEAR__");
		});
	});

	describe("/propose command", () => {
		it("shows error when no args provided", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("propose")!;
			const result = await cmd.handler(ctx, "");
			expect(result.type).toBe("error");
			expect(result.output).toContain("Usage:");
		});

		it("returns error when OpenSpecManager unavailable", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("propose")!;
			const result = await cmd.handler(ctx, "test: description");
			// OpenSpecManager is not available in test mock
			expect(result.output).toContain("not initialized");
		});
	});

	describe("/verify command", () => {
		it("shows error when no args provided", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("verify")!;
			const result = await cmd.handler(ctx, "");
			expect(result.type).toBe("error");
			expect(result.output).toContain("Usage:");
		});

		it("returns error when OpenSpecManager unavailable", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("verify")!;
			const result = await cmd.handler(ctx, "test-change");
			expect(result.output).toContain("not initialized");
		});
	});

	describe("/archive command", () => {
		it("shows error when no args provided", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("archive")!;
			const result = await cmd.handler(ctx, "");
			expect(result.type).toBe("error");
			expect(result.output).toContain("Usage:");
		});

		it("returns error when OpenSpecManager unavailable", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("archive")!;
			const result = await cmd.handler(ctx, "test-change");
			expect(result.output).toContain("not initialized");
		});
	});

	describe("/spec command", () => {
		it("returns error when OpenSpecManager unavailable", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("spec")!;
			const result = await cmd.handler(ctx, "");
			expect(result.output).toContain("not initialized");
		});

		it("returns error when OpenSpecManager unavailable for list", async () => {
			const ctx = makeCtx();
			const cmd = registry.get("spec")!;
			const result = await cmd.handler(ctx, "list");
			expect(result.output).toContain("not initialized");
		});
	});

	describe("/sessions command", () => {
		it("is registered", () => {
			const cmd = registry.get("sessions");
			expect(cmd).toBeDefined();
			expect(cmd!.name).toBe("sessions");
		});

		it("returns info when no sessions exist", async () => {
			// Monkey-patch the static listSessions to a controlled value.
			const SM = (await import("./session-manager.js")).SessionManager;
			const original = SM.listSessions;
			SM.listSessions = () => [];
			try {
				const cmd = registry.get("sessions")!;
				const ctx = makeCtx();
				const result = await cmd.handler(ctx, "");
				expect(result.type).toBe("info");
				expect(result.output).toContain("No saved sessions");
			} finally {
				SM.listSessions = original;
			}
		});

		it("lists saved sessions, marking the current one", async () => {
			const SM = (await import("./session-manager.js")).SessionManager;
			const originalList = SM.listSessions;
			SM.listSessions = () => [
				{ id: "alpha", createdAt: 100, messageCount: 3 },
				{ id: "test-session", createdAt: 200, messageCount: 5 },
			];
			try {
				const cmd = registry.get("sessions")!;
				const ctx = makeCtx();
				const result = await cmd.handler(ctx, "");
				expect(result.type).toBe("info");
				expect(result.output).toContain("alpha");
				// 'test-session' is the ctx.session.id, so it gets the
				// '← current' marker appended on the same line.
				expect(result.output).toMatch(/test-session.*\u2190 current/);
				expect(result.output).toContain("Use /resume");
			} finally {
				SM.listSessions = originalList;
			}
		});
	});

	describe("/resume command", () => {
		it("is registered", () => {
			const cmd = registry.get("resume");
			expect(cmd).toBeDefined();
			expect(cmd!.name).toBe("resume");
		});

		it("returns error when no id is given", async () => {
			const cmd = registry.get("resume")!;
			const ctx = makeCtx();
			const result = await cmd.handler(ctx, "");
			expect(result.type).toBe("error");
			expect(result.output).toContain("Usage: /resume");
		});

		it("returns error when session does not exist", async () => {
			const SM = (await import("./session-manager.js")).SessionManager;
			const originalLoad = SM.load;
			SM.load = () => null;
			try {
				const cmd = registry.get("resume")!;
				const ctx = makeCtx();
				const result = await cmd.handler(ctx, "nonexistent-id");
				expect(result.type).toBe("error");
				expect(result.output).toContain("Session not found");
			} finally {
				SM.load = originalLoad;
			}
		});

		it("replaces the session with the loaded one and reports stats", async () => {
			const SM = (await import("./session-manager.js")).SessionManager;
			const originalLoad = SM.load;
			const loadedSession = {
				id: "loaded-1",
				createdAt: Date.now() - 1000,
				updatedAt: Date.now(),
				messages: [
					{ role: "user", content: "u", timestamp: 1 },
					{
						role: "assistant",
						content: "a",
						timestamp: 2,
						toolCalls: [{ id: "c1", name: "shell", arguments: {} }],
					},
					{
						role: "tool",
						content: "ok",
						timestamp: 3,
						toolCallId: "c1",
						name: "shell",
					},
				],
				metadata: { pipelineCount: 0, agentCount: 0 },
			};
			SM.load = () => loadedSession;
			try {
				const cmd = registry.get("resume")!;
				const replaced: any[] = [];
				const ctx = makeCtx({
					session: {
						id: "current",
						incPipelines: vi.fn(),
						incAgents: vi.fn(),
						messageCount: 0,
						pipelineCount: 0,
						agentCount: 0,
						close: vi.fn(),
						clearMessages: vi.fn(),
						getRecentMessages: vi.fn().mockReturnValue([]),
						replaceWith: (s: any) => replaced.push(s),
					} as any,
				});
				const result = await cmd.handler(ctx, "loaded-1");
				expect(result.type).toBe("success");
				expect(result.output).toContain("Resumed session loaded-1");
				expect(result.output).toContain("1 tool results");
				expect(result.output).toContain("1 tool-calling turns");
				expect(replaced).toHaveLength(1);
				expect(replaced[0].id).toBe("loaded-1");
			} finally {
				SM.load = originalLoad;
			}
		});
	});

	describe("/clear command", () => {
		it("is registered with /reset alias", () => {
			const cmd = registry.get("clear");
			expect(cmd).toBeDefined();
			expect(cmd!.aliases).toContain("reset");
		});

		it("returns the __CLEAR__ sentinel and calls clearMessages", async () => {
			const cmd = registry.get("clear")!;
			const ctx = makeCtx({
				session: {
					id: "sess_abc",
					incPipelines: vi.fn(),
					incAgents: vi.fn(),
					messageCount: 7,
					pipelineCount: 0,
					agentCount: 0,
					close: vi.fn(),
					clearMessages: vi.fn(),
					getRecentMessages: vi.fn().mockReturnValue([]),
				} as any,
			});
			const result = await cmd.handler(ctx, "");
			// The REPL intercepts this sentinel to also wipe the screen.
			expect(result.output).toBe("__CLEAR__");
			expect(result.type).toBe("text");
			expect((ctx.session as any).clearMessages).toHaveBeenCalledOnce();
		});
	});

	describe("/compact command", () => {
		it("is registered", () => {
			const cmd = registry.get("compact");
			expect(cmd).toBeDefined();
			expect(cmd!.name).toBe("compact");
		});

		it("returns error when CompactionManager is not initialized", async () => {
			const cmd = registry.get("compact")!;
			const ctx = makeCtx({
				miura: {
					getCompactionManager: () => undefined,
				} as any,
			});
			const result = await cmd.handler(ctx, "");
			expect(result.type).toBe("error");
			expect(result.output).toContain("not initialized");
		});

		it("returns info when the session has no messages", async () => {
			const fakeInner = {
				compact: vi.fn(),
				getCurrentStrategy: () => "no_compaction",
			};
			const cmd = registry.get("compact")!;
			const ctx = makeCtx({
				miura: {
					getCompactionManager: () => ({ compactionManager: fakeInner }),
				} as any,
				session: {
					id: "sess_empty",
					messageCount: 0,
					getHistoryAsLLMMessages: () => [],
					clearMessages: vi.fn(),
					addUser: vi.fn(),
					addAssistant: vi.fn(),
					addAssistantTurn: vi.fn(),
					addToolResult: vi.fn(),
				} as any,
			});
			const result = await cmd.handler(ctx, "");
			expect(result.type).toBe("info");
			expect(result.output).toContain("Nothing to compact");
		});

		it("rejects a non-numeric context window", async () => {
			const fakeInner = {
				compact: vi.fn(),
				getCurrentStrategy: () => "sliding_window",
			};
			const cmd = registry.get("compact")!;
			const ctx = makeCtx({
				miura: {
					getCompactionManager: () => ({ compactionManager: fakeInner }),
				} as any,
				session: { messageCount: 3, getHistoryAsLLMMessages: () => [] } as any,
			});
			const result = await cmd.handler(ctx, "abc");
			expect(result.type).toBe("error");
			expect(result.output).toContain("Invalid context window");
		});

		it("runs the active strategy, rebuilds the session, and reports stats", async () => {
			const fakeInner = {
				compact: vi.fn().mockReturnValue({
					compactedMessages: [
						{ role: "user", content: "u1" },
						{ role: "assistant", content: "summary" },
					],
					removedMessages: [
						{ role: "user", content: "u0" },
						{ role: "assistant", content: "old" },
						{ role: "user", content: "u1" },
						{ role: "assistant", content: "old2" },
						{ role: "tool", content: "x", toolCallId: "c", name: "shell" },
					],
					stats: {
						originalCount: 7,
						compactedCount: 2,
						removedCount: 5,
						compressionRatio: 0.71,
						strategyUsed: "sliding_window",
					},
				}),
				getCurrentStrategy: () => "sliding_window",
			};
			const adderLog: string[] = [];
			const cmd = registry.get("compact")!;
			const ctx = makeCtx({
				miura: {
					getCompactionManager: () => ({ compactionManager: fakeInner }),
				} as any,
				session: {
					id: "sess_c1",
					messageCount: 7,
					getHistoryAsLLMMessages: () => [
						{ role: "user", content: "u0" },
						{ role: "assistant", content: "old" },
					],
					clearMessages: () => adderLog.push("clear"),
					addUser: (c: string) => adderLog.push(`user:${c}`),
					addAssistant: (c: string) => adderLog.push(`asst:${c}`),
					addAssistantTurn: (c: string) => adderLog.push(`turn:${c}`),
					addToolResult: () => adderLog.push("tool"),
					persist: () => adderLog.push("persist"),
				} as any,
			});
			const result = await cmd.handler(ctx, "4000");
			expect(result.type).toBe("success");
			expect(result.output).toContain("sliding_window");
			expect(result.output).toContain("context window: 4000");
			expect(result.output).toContain("before: 7 messages");
			expect(result.output).toContain("after:  2 messages");
			expect(result.output).toContain("removed: 5");
			expect(result.output).toContain("71% compression");
			// 2 messages re-added in order, then explicit persist
			expect(adderLog).toEqual([
				"clear",
				"user:u1",
				"asst:summary",
				"persist",
			]);
			expect(fakeInner.compact).toHaveBeenCalledWith(
				expect.any(Array),
				4000,
			);
		});

		it("uses 8000 as the default context window", async () => {
			const fakeInner = {
				compact: vi.fn().mockReturnValue({
					compactedMessages: [{ role: "user", content: "u" }],
					removedMessages: [],
					stats: {
						originalCount: 1,
						compactedCount: 1,
						removedCount: 0,
						compressionRatio: 0,
						strategyUsed: "no_compaction",
					},
				}),
				getCurrentStrategy: () => "no_compaction",
			};
			const cmd = registry.get("compact")!;
			const ctx = makeCtx({
				miura: {
					getCompactionManager: () => ({ compactionManager: fakeInner }),
				} as any,
				session: {
					id: "sess_d",
					messageCount: 1,
					getHistoryAsLLMMessages: () => [{ role: "user", content: "u" }],
					clearMessages: vi.fn(),
					addUser: vi.fn(),
					persist: vi.fn(),
				} as any,
			});
			const result = await cmd.handler(ctx, "");
			expect(fakeInner.compact).toHaveBeenCalledWith(expect.any(Array), 8000);
			expect(result.output).toContain("context window: 8000");
		});

		it("rebuilds a full ReAct loop (user, assistant w/ tools, tool result)", async () => {
			const fakeInner = {
				compact: vi.fn().mockReturnValue({
					compactedMessages: [
						{ role: "user", content: "u" },
						{
							role: "assistant",
							content: "ok",
							toolCalls: [{ id: "c1", name: "read", arguments: { p: "/a" } }],
						},
						{
							role: "tool",
							content: "contents",
							toolCallId: "c1",
							name: "read",
						},
					],
					removedMessages: [],
					stats: {
						originalCount: 3,
						compactedCount: 3,
						removedCount: 0,
						compressionRatio: 0,
						strategyUsed: "no_compaction",
					},
				}),
				getCurrentStrategy: () => "no_compaction",
			};
			const adderLog: string[] = [];
			const cmd = registry.get("compact")!;
			const ctx = makeCtx({
				miura: {
					getCompactionManager: () => ({ compactionManager: fakeInner }),
				} as any,
				session: {
					id: "sess_r",
					messageCount: 3,
					getHistoryAsLLMMessages: () => [
						{ role: "user", content: "u" },
					],
					clearMessages: () => adderLog.push("clear"),
					addUser: (c: string) => adderLog.push(`u:${c}`),
					addAssistant: () => adderLog.push("asst"),
					addAssistantTurn: (c: string) => adderLog.push(`turn:${c}`),
					addToolResult: (id: string, name: string, out: string) =>
						adderLog.push(`tool:${id}:${name}:${out}`),
					persist: () => adderLog.push("persist"),
				} as any,
			});
			await cmd.handler(ctx, "");
			expect(adderLog).toEqual([
				"clear",
				"u:u",
				"turn:ok",
				"tool:c1:read:contents",
				"persist",
			]);
		});
	});

	describe("/cost command", () => {
		it("is registered", () => {
			const cmd = registry.get("cost");
			expect(cmd).toBeDefined();
			expect(cmd!.name).toBe("cost");
		});

		it("returns info when no token usage has been recorded", async () => {
			const cmd = registry.get("cost")!;
			const ctx = makeCtx({
				session: {
					id: "sess_cost_1",
					tokenUsage: { prompt: 0, completion: 0 },
					resetTokenUsage: vi.fn(),
					getTokenBreakdown: () => [],
				} as any,
			});
			const result = await cmd.handler(ctx, "");
			expect(result.type).toBe("info");
			expect(result.output).toContain("No token usage recorded yet");
		});

		it("shows totals and per-model breakdown", async () => {
			const cmd = registry.get("cost")!;
			const ctx = makeCtx({
				session: {
					id: "sess_cost_2",
					tokenUsage: { prompt: 1500, completion: 500 },
					resetTokenUsage: vi.fn(),
					getTokenBreakdown: () => [
						{
							key: "claude/opus-4",
							provider: "claude",
							model: "opus-4",
							prompt: 1000,
							completion: 400,
							calls: 3,
						},
						{
							key: "groq/llama-3.3-70b",
							provider: "groq",
							model: "llama-3.3-70b",
							prompt: 500,
							completion: 100,
							calls: 1,
						},
					],
				} as any,
			});
			const result = await cmd.handler(ctx, "");
			expect(result.type).toBe("text");
			expect(result.output).toContain("Session sess_cost_2");
			expect(result.output).toContain("prompt:     1500");
			expect(result.output).toContain("completion: 500");
			expect(result.output).toContain("total:      2000");
			expect(result.output).toContain("25% completion");
			expect(result.output).toContain("claude/opus-4");
			expect(result.output).toContain("groq/llama-3.3-70b");
		});

		it("reset subcommand clears the counters", async () => {
			const cmd = registry.get("cost")!;
			const reset = vi.fn();
			const ctx = makeCtx({
				session: {
					id: "sess_cost_3",
					tokenUsage: { prompt: 100, completion: 50 },
					resetTokenUsage: reset,
					getTokenBreakdown: () => [],
				} as any,
			});
			const result = await cmd.handler(ctx, "reset");
			expect(result.type).toBe("success");
			expect(result.output).toContain("reset");
			expect(reset).toHaveBeenCalledOnce();
		});
	});
});
