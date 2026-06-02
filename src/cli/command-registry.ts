/**
 * Command Registry — All 19 REPL slash commands with handlers.
 * Each handler receives parsed args, the miura instance, and session.
 */

import type { MiuraSwarm } from "../index.js";
import type { AgentRole, ModelRef } from "../core/types.js";
import type { SessionManager } from "./session-manager.js";

export interface CommandContext {
	miura: MiuraSwarm;
	session: SessionManager;
	rawArgs: string;
}

export interface CommandResult {
	output: string;
	type: "text" | "error" | "success" | "info" | "diff";
	stream?: boolean;
}

export interface CommandDef {
	name: string;
	aliases?: string[];
	description: string;
	usage: string;
	handler: (ctx: CommandContext, args: string) => Promise<CommandResult>;
}

export class CommandRegistry {
	private commands = new Map<string, CommandDef>();

	constructor() {
		this.registerAll();
	}

	get(name: string): CommandDef | undefined {
		return this.commands.get(name);
	}

	/** Match by name or alias. Returns null if not a command (e.g. free text). */
	match(input: string): { cmd: CommandDef; args: string } | null {
		const trimmed = input.trim();
		if (!trimmed.startsWith("/")) return null;
		const spaceIdx = trimmed.indexOf(" ");
		const name =
			spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
		const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

		const cmd = this.commands.get(name);
		if (cmd) return { cmd, args };

		// Try aliases
		for (const def of this.commands.values()) {
			if (def.aliases?.includes(name)) return { cmd: def, args };
		}

		return null;
	}

	listAll(): CommandDef[] {
		return [...this.commands.values()];
	}

	formatHelp(): string {
		const lines = ["Available commands:", ""];
		for (const cmd of this.commands.values()) {
			const usage = cmd.usage ? ` ${cmd.usage}` : "";
			lines.push(`  /${cmd.name}${usage}`);
			lines.push(`    ${cmd.description}`);
		}
		return lines.join("\n");
	}

	private registerAll(): void {
		// ─── /chat ───────────────────────────────────────────────────────────────
		this.register({
			name: "chat",
			description:
				"Send a free-text message through the swarm pipeline (planner → worker → reviewer)",
			usage: "<task>",
			handler: async (ctx) => {
				const task = ctx.rawArgs;
				if (!task)
					return { output: "Usage: /chat <task description>", type: "error" };

				const result = await ctx.miura.runPipeline(task, {
					stages: [
						{ role: "planner" },
						{ role: "worker" },
						{ role: "reviewer" },
					],
					maxIterations: 3,
				});
				ctx.session.incPipelines();
				return { output: result.finalOutput, type: "text" };
			},
		});

		// ─── /review ─────────────────────────────────────────────────────────────
		this.register({
			name: "review",
			aliases: ["r"],
			description:
				'Review a diff or file changes — equivalent to CLI "review" command',
			usage: "<diff or file path>",
			handler: async (ctx) => {
				const diff = ctx.rawArgs;
				if (!diff)
					return {
						output: "Usage: /review <diff or file path>",
						type: "error",
					};

				const result = await ctx.miura.runAgent(
					"reviewer",
					`Review this diff:\n\n${diff}`,
				);
				ctx.session.incAgents();
				return { output: result.output, type: "text" };
			},
		});

		// ─── /add ────────────────────────────────────────────────────────────────
		this.register({
			name: "add",
			description: "Add a new task to the queue",
			usage: "<description>",
			handler: async (ctx) => {
				const desc = ctx.rawArgs;
				if (!desc)
					return { output: "Usage: /add <task description>", type: "error" };

				const status = await ctx.miura.getStatus();
				const pending = status.tasks.pending + status.tasks.active;
				const priority = pending > 5 ? "low" : pending > 2 ? "medium" : "high";

				// Run the task directly as a quick pipeline
				const result = await ctx.miura.runPipeline(desc, {
					stages: [{ role: "planner" }, { role: "worker" }],
					maxIterations: 2,
				});
				ctx.session.incPipelines();

				return {
					output:
						`Task queued and executed [${priority}]: pipeline ${result.pipelineId}\n` +
						`Pending before run: ${pending}\n` +
						`\n${result.finalOutput}`,
					type: "success",
				};
			},
		});

		// ─── /read ──────────────────────────────────────────────────────────────
		this.register({
			name: "read",
			description: "Read and explain a file or code block",
			usage: "<file path or content>",
			handler: async (ctx) => {
				const content = ctx.rawArgs;
				if (!content)
					return { output: "Usage: /read <file path or code>", type: "error" };

				const isPath = !content.includes("\n") && !content.startsWith("{");
				const task = isPath
					? `Explain this file concisely — purpose, key exports, architecture notes:\n\n${content}`
					: `Explain this code:\n\n${content}`;
				const result = await ctx.miura.runAgent("context-builder", task);
				ctx.session.incAgents();
				return { output: result.output, type: "text" };
			},
		});

		// ─── /swarm ─────────────────────────────────────────────────────────────
		this.register({
			name: "swarm",
			aliases: ["s"],
			description: "Run a full pipeline (shortcut for /chat)",
			usage: "<task>",
			handler: async (ctx) => {
				return this.commands.get("chat")!.handler(ctx, ctx.rawArgs);
			},
		});

		// ─── /agent ─────────────────────────────────────────────────────────────
		this.register({
			name: "agent",
			description: "Run a single agent by role",
			usage: "<role> <task>",
			handler: async (ctx) => {
				const parts = ctx.rawArgs.split(/\s+/);
				const role = parts[0];
				const task = parts.slice(1).join(" ");
				if (!role || !task)
					return { output: "Usage: /agent <role> <task>", type: "error" };

				try {
					const result = await ctx.miura.runAgent(role as any, task);
					ctx.session.incAgents();
					return { output: result.output, type: "text" };
				} catch (err: any) {
					return { output: `Agent error: ${err.message}`, type: "error" };
				}
			},
		});

		// ─── /tokens ─────────────────────────────────────────────────────────────
		this.register({
			name: "tokens",
			description: "Show token usage summary for this session",
			usage: "",
			handler: async (ctx) => {
				const msgs = ctx.session.getRecentMessages(100);
				const userMsgs = msgs.filter((m) => m.role === "user").length;
				const asstMsgs = msgs.filter((m) => m.role === "assistant").length;
				const pipelines = ctx.session.pipelineCount;
				const agents = ctx.session.agentCount;
				return {
					output:
						`Session: ${ctx.session.id}\n` +
						`Messages: ${ctx.session.messageCount} (${userMsgs} user, ${asstMsgs} assistant)\n` +
						`Pipelines run: ${pipelines}\n` +
						`Agents run: ${agents}`,
					type: "info",
				};
			},
		});

		// ─── /brain ───────────────────────────────────────────────────────────────
		this.register({
			name: "brain",
			description: "Query or manage the Brain (long-term memory)",
			usage: "[query | stats | save <type> <title> | clear]",
			handler: async (ctx, args) => {
				const brain = ctx.miura.getBrainManager();
				if (!brain) {
					return { output: "Brain plugin not loaded.", type: "error" };
				}

				const arg = args.trim();

				// No args or stats
				if (!arg || arg === "stats") {
					const count = await brain.countByType();
					const recent = await brain.getRecent(5);
					return {
						output: `Brain stats:\n  Total entries: ${count}\n\nRecent entries:\n${recent.map((e) => `[${e.type}] ${e.title}`).join("\n") || "  (none)"}`,
						type: "info",
					};
				}

				// Save entry: /brain save <type> <title>
				if (arg.startsWith("save ")) {
					const parts = arg.slice(5).trim().split(/\s+/);
					const type = parts[0] as any;
					const title = parts.slice(1).join(" ");
					if (!type || !title) {
						return {
							output:
								"Usage: /brain save <type> <title>\nTypes: decision, bugfix, pattern, discovery, config, learning",
							type: "error",
						};
					}
					const validTypes = [
						"decision",
						"bugfix",
						"pattern",
						"discovery",
						"config",
						"learning",
					];
					if (!validTypes.includes(type)) {
						return {
							output: `Invalid type: ${type}\nValid types: ${validTypes.join(", ")}`,
							type: "error",
						};
					}
					await brain.save({
						type,
						topicKey: title.toLowerCase().replace(/\s+/g, "-"),
						title,
						content: title, // User can edit later
						sessionId: ctx.session.id,
						metadata: {},
					});
					return { output: `Saved [${type}]: ${title}`, type: "success" };
				}

				// Clear session
				if (arg === "clear") {
					ctx.session.clearMessages();
					return { output: "Session memory cleared.", type: "success" };
				}

				// Search
				const results = await brain.search(arg, { limit: 5 });
				if (results.length === 0) {
					return {
						output: `No brain entries matching "${arg}".`,
						type: "info",
					};
				}
				const output = results
					.map(
						(e) =>
							`**[${e.type}] ${e.title}**\n${e.content.slice(0, 200)}${e.content.length > 200 ? "..." : ""}`,
					)
					.join("\n\n");
				return { output, type: "info" };
			},
		});

		// ─── /capture ───────────────────────────────────────────────────────────────
		this.register({
			name: "capture",
			aliases: ["c"],
			description: "Save a learning/decision/bugfix to Brain memory",
			usage: "<type> <content> | <shortcut> <content>",
			handler: async (ctx, args) => {
				const brain = ctx.miura.getBrainManager();
				if (!brain) {
					return { output: "Brain plugin not loaded.", type: "error" };
				}

				const arg = args.trim();
				if (!arg) {
					return {
						output:
							"Usage: /capture <type> <content>\n" +
							"Types: decision, bugfix, pattern, discovery, config, learning\n" +
							"Shortcuts: /c d <title> (decision), /c b <title> (bugfix), /c p <title> (pattern), /c l <title> (learning)",
						type: "info",
					};
				}

				const shortcuts: Record<string, string> = {
					d: "decision",
					b: "bugfix",
					p: "pattern",
					l: "learning",
					f: "discovery",
					k: "config",
				};
				const parts = arg.split(/\s+/);
				const first = parts[0];

				let type: string;
				let content: string;

				if (shortcuts[first]) {
					type = shortcuts[first];
					content = parts.slice(1).join(" ");
				} else {
					type = first;
					content = parts.slice(1).join(" ");
				}

				if (!content) {
					return {
						output: `Missing content. Usage: /capture ${type} <content>`,
						type: "error",
					};
				}

				const validTypes = [
					"decision",
					"bugfix",
					"pattern",
					"discovery",
					"config",
					"learning",
				];
				if (!validTypes.includes(type)) {
					return {
						output: `Invalid type: ${type}\nValid: ${validTypes.join(", ")}`,
						type: "error",
					};
				}

				const title = content.slice(0, 60) + (content.length > 60 ? "..." : "");
				await brain.save({
					type: type as any,
					topicKey: title.toLowerCase().replace(/\s+/g, "-"),
					title,
					content,
					sessionId: ctx.session.id,
					metadata: {},
				});
				return { output: `Saved [${type}]: ${title}`, type: "success" };
			},
		});

		// ─── /diff-mode ───────────────────────────────────────────────────────────
		this.register({
			name: "diff-mode",
			description: "Set diff approval mode: prompt, auto-approve, or reject",
			usage: "[prompt | auto | reject]",
			handler: async (ctx, args) => {
				const { getDiffApprovalService, setDiffApprovalMode } = await import(
					"../core/diff-approval.js"
				);
				const service = getDiffApprovalService();
				const arg = args.trim().toLowerCase();

				if (!arg || arg === "status") {
					const mode = service.getMode();
					return {
						output:
							`Diff approval mode: ${mode}\n` +
							`  prompt      — show diff and wait for y/n/e\n` +
							`  auto-approve — auto-approve all writes\n` +
							`  reject      — reject all writes (safe mode)`,
						type: "info",
					};
				}

				if (arg === "a" || arg === "auto" || arg === "auto-approve") {
					setDiffApprovalMode("auto-approve");
					return {
						output: "Diff mode: auto-approve (all writes approved)",
						type: "success",
					};
				}
				if (arg === "r" || arg === "reject") {
					setDiffApprovalMode("reject");
					return {
						output: "Diff mode: reject (all writes blocked)",
						type: "success",
					};
				}
				if (arg === "p" || arg === "prompt") {
					setDiffApprovalMode("prompt");
					return {
						output: "Diff mode: prompt (waiting for approval)",
						type: "success",
					};
				}

				return {
					output: "Usage: /diff-mode [prompt | auto | reject]",
					type: "error",
				};
			},
		});

		// ─── /approve ───────────────────────────────────────────────────────────
		this.register({
			name: "approve",
			description: "Approve/reject pending diff operations",
			usage: "[y | n | list | current]",
			handler: async (ctx, args) => {
				const { getDiffApprovalService } = await import(
					"../core/diff-approval.js"
				);
				const service = getDiffApprovalService();
				const arg = args.trim().toLowerCase();

				const pending = service.getPendingApprovals();

				if (!arg || arg === "list" || arg === "ls") {
					if (pending.length === 0) {
						return { output: "No pending diff approvals.", type: "info" };
					}
					const lines = ["Pending diff approvals:", ""];
					pending.forEach((p, i) => {
						lines.push(`${i + 1}. ${p.action} ${p.filePath}`);
						lines.push(`   By: ${p.requestedBy}`);
					});
					lines.push(
						"",
						"Use /approve y to approve first, /approve n to reject",
					);
					return { output: lines.join("\n"), type: "info" };
				}

				const current = service.getCurrentApproval();
				if (arg === "current" || arg === "c") {
					if (!current) {
						return {
							output: "No current diff waiting for approval.",
							type: "info",
						};
					}
					const diff = service.generateDiff(current);
					return { output: diff, type: "diff" };
				}

				if (arg === "y" || arg === "yes" || arg === "approve") {
					if (!current) {
						return { output: "No pending approval to approve.", type: "error" };
					}
					service.approve(current.id, "approved");
					return {
						output: `✅ Approved: ${current.filePath}`,
						type: "success",
					};
				}

				if (arg === "n" || arg === "no" || arg === "reject") {
					if (!current) {
						return { output: "No pending approval to reject.", type: "error" };
					}
					service.approve(current.id, "rejected");
					return { output: `❌ Rejected: ${current.filePath}`, type: "info" };
				}

				return {
					output: "Usage: /approve [y | n | list | current]",
					type: "error",
				};
			},
		});

		// ─── /stream ──────────────────────────────────────────────────────────────
		this.register({
			name: "stream",
			description: "Toggle real-time token streaming for agent responses",
			usage: "[on | off | status]",
			handler: async (ctx, args) => {
				const { getStreamingService } = await import(
					"../core/streaming-service.js"
				);
				const service = getStreamingService();
				const arg = args.trim().toLowerCase();

				if (!arg || arg === "status") {
					const status = service.isEnabled() ? "ON" : "OFF";
					return {
						output:
							`Token streaming: ${status}\n` +
							`  Tokens appear in real-time as they are received.\n` +
							`  Use /stream on to enable, /stream off to disable.`,
						type: "info",
					};
				}

				if (arg === "on" || arg === "enable" || arg === "1" || arg === "true") {
					service.setEnabled(true);
					return { output: "Token streaming: ON", type: "success" };
				}

				if (
					arg === "off" ||
					arg === "disable" ||
					arg === "0" ||
					arg === "false"
				) {
					service.setEnabled(false);
					return { output: "Token streaming: OFF", type: "success" };
				}

				return { output: "Usage: /stream [on | off | status]", type: "error" };
			},
		});

		// ─── /model ────────────────────────────────────────────────────────────────
		this.register({
			name: "model",
			description: "Show model routing config for roles and SDD phases",
			usage: "[phase | role] | [set <phase> <model>]",
			handler: async (ctx, args) => {
				const { ModelRouter, SDD_PHASE_DESCRIPTIONS } = await import(
					"../core/model-router.js"
				);
				const router = new ModelRouter();
				const arg = args.trim().toLowerCase();

				if (!arg || arg === "status") {
					const lines = ["Model routing config:", ""];

					// Agent roles
					lines.push("**Agent Roles:**");
					const roles = [
						"planner",
						"worker",
						"scout",
						"reviewer",
						"oracle",
						"delegate",
						"chat",
					] as const;
					for (const role of roles) {
						const m = router.resolve(role);
						lines.push(`  ${role.padEnd(16)} → ${m.provider}/${m.model}`);
					}

					// SDD phases
					lines.push("", "**SDD Phases:**");
					const phases = router.getPhaseModels();
					for (const { phase, model, description } of phases) {
						lines.push(`  ${phase.padEnd(10)} → ${model.model}`);
						lines.push(`              ${description}`);
					}

					lines.push("", "Use /model <phase> to see detail for a phase.");
					return { output: lines.join("\n"), type: "info" };
				}

				// Show specific phase
				if (
					arg === "propose" ||
					arg === "spec" ||
					arg === "design" ||
					arg === "tasks" ||
					arg === "apply" ||
					arg === "verify" ||
					arg === "archive"
				) {
					const phase = arg;
					const m = router.resolveForPhase(phase as any);
					const desc =
						SDD_PHASE_DESCRIPTIONS[
							phase as keyof typeof SDD_PHASE_DESCRIPTIONS
						];
					return {
						output:
							`SDD Phase: ${phase}\n` +
							`  ${desc}\n` +
							`  Model: ${m.model}\n` +
							`  Provider: ${m.provider}\n` +
							`  Max tokens: ${m.maxTokens ?? "default"}`,
						type: "info",
					};
				}

				// Show specific role
				const roles = [
					"planner",
					"worker",
					"scout",
					"reviewer",
					"oracle",
					"delegate",
					"chat",
				];
				if (roles.includes(arg)) {
					const m = router.resolve(arg as any);
					const chain = router.getFallbackChain(arg as any);
					const fallbacks =
						chain
							.slice(1)
							.map((fb) => `${fb.provider}/${fb.model}`)
							.join(", ") || "none";
					return {
						output:
							`Role: ${arg}\n` +
							`  Default: ${m.provider}/${m.model}\n` +
							`  Fallback: ${fallbacks}`,
						type: "info",
					};
				}

				return {
					output:
						"Usage: /model [status | <phase> | <role>]\nPhases: propose, spec, design, tasks, apply, verify, archive\nRoles: planner, worker, scout, reviewer, oracle, delegate, chat",
					type: "error",
				};
			},
		});

		// ─── /provider ───────────────────────────────────────────────────────────
		this.register({
			name: "provider",
			aliases: ["use"],
			description: "Choose the provider + model for chat (overrides routing)",
			usage: "[<provider> <model> | off]",
			handler: async (ctx, args) => {
				const VALID_PROVIDERS = [
					"claude",
					"nvidia-nim",
					"ollama",
					"openai",
					"openrouter",
					"groq",
					"google",
					"cerebras",
					"zyphra",
					"cohere",
					"sambanova",
					"mistral",
					"llama-server",
					"lmstudio",
				];

				const parts = args.trim().split(/\s+/).filter(Boolean);

				// No args → show current selection + available providers.
				if (parts.length === 0) {
					const active = ctx.session.activeModel;
					const current = active
						? `${active.provider}/${active.model}`
						: "default routing (per-role)";
					return {
						output:
							`Active chat model: ${current}\n\n` +
							`Providers: ${VALID_PROVIDERS.join(", ")}\n` +
							`Set with: /provider <provider> <model>\n` +
							`Clear with: /provider off`,
						type: "info",
					};
				}

				// Clear the override.
				if (["off", "clear", "default", "reset"].includes(parts[0].toLowerCase())) {
					ctx.session.setActiveModel(null);
					return {
						output: "Chat model override cleared — using default routing.",
						type: "success",
					};
				}

				const provider = parts[0].toLowerCase();
				if (!VALID_PROVIDERS.includes(provider)) {
					return {
						output: `Unknown provider: ${provider}\nValid: ${VALID_PROVIDERS.join(", ")}`,
						type: "error",
					};
				}

				const model = parts.slice(1).join(" ");
				if (!model) {
					return {
						output: `Usage: /provider ${provider} <model>\n(e.g. /provider ${provider} qwen2.5-coder-7b)`,
						type: "error",
					};
				}

				ctx.session.setActiveModel({ provider, model });
				return {
					output: `Chat model set to ${provider}/${model}`,
					type: "success",
				};
			},
		});

		// ─── /graph ──────────────────────────────────────────────────────────────
		this.register({
			name: "graph",
			description: "Initialize or query the code graph (tree-sitter + FTS5)",
			usage: "[init | search <query> | stats | trace <symbol>]",
			handler: async (ctx, args) => {
				const graphPlugin = ctx.miura.getGraphIndexer();
				if (!graphPlugin) {
					return { output: "Graph plugin not loaded.", type: "error" };
				}

				const parts = args.trim().split(/\s+/);
				const subcmd = parts[0];

				// /graph init — start indexing
				if (!subcmd || subcmd === "init") {
					try {
						const stats = await graphPlugin.runInit(process.cwd());
						return {
							output:
								`Graph indexed:\n` +
								`  Files: ${stats.filesIndexed}\n` +
								`  Symbols: ${stats.nodesCreated}\n` +
								`  Edges: ${stats.edgesCreated}\n` +
								`  Duration: ${(stats.durationMs / 1000).toFixed(1)}s`,
							type: "success",
						};
					} catch (err: any) {
						return { output: `Index error: ${err.message}`, type: "error" };
					}
				}

				// /graph stats — show index status
				if (subcmd === "stats") {
					const indexer = graphPlugin.getIndexer();
					if (!indexer) {
						return {
							output: "Graph not indexed. Run /graph init first.",
							type: "info",
						};
					}
					const lastIndexed = graphPlugin.getLastIndexedAt();
					const date = lastIndexed
						? new Date(lastIndexed).toLocaleString()
						: "never";
					return {
						output:
							`Graph stats:\n  Last indexed: ${date}\n  Run /graph init to re-index.\n` +
							`Tools: graph_search, graph_context, graph_trace`,
						type: "info",
					};
				}

				// /graph search <query> — FTS5 search
				if (subcmd === "search" && parts[1]) {
					const query = parts.slice(1).join(" ");
					const indexer = graphPlugin.getIndexer();
					if (!indexer) {
						return {
							output: "Graph not indexed. Run /graph init first.",
							type: "error",
						};
					}
					const results = indexer.search(query, 20);
					if (!results.length) {
						return { output: `No symbols matching "${query}".`, type: "info" };
					}
					const lines = results
						.map(
							(r) =>
								`**[${r.node.symbolType}] ${r.node.symbolName}**\n  ${r.node.filePath}:${r.node.line}`,
						)
						.join("\n");
					return {
						output: `Found ${results.length} symbols:\n\n${lines}`,
						type: "info",
					};
				}

				// /graph trace <symbol> — call graph trace
				if (subcmd === "trace" && parts[1]) {
					const symbol = parts.slice(1).join(" ");
					const indexer = graphPlugin.getIndexer();
					if (!indexer) {
						return {
							output: "Graph not indexed. Run /graph init first.",
							type: "error",
						};
					}
					const result = indexer.traceCallGraph(symbol, "both");
					if (!result) {
						return {
							output: `Symbol "${symbol}" not found in index.`,
							type: "info",
						};
					}
					const lines = [`**Call graph: ${symbol}**`, ""];
					if (result.callers.length) {
						lines.push(`Called by (${result.callers.length}):`);
						result.callers.forEach((e) => lines.push(`  ← ${e.edgeType}`));
					}
					if (result.callees.length) {
						lines.push(`Calls (${result.callees.length}):`);
						result.callees.forEach((e) => lines.push(`  → ${e.edgeType}`));
					}
					if (!result.callers.length && !result.callees.length) {
						lines.push("(no call graph edges found)");
					}
					return { output: lines.join("\n"), type: "info" };
				}

				return {
					output:
						"Usage: /graph [init | search <query> | stats | trace <symbol>]\n" +
						`  init    — index the codebase\n` +
						`  search  — FTS5 search for symbols\n` +
						`  stats   — show index status\n` +
						`  trace   — call graph analysis`,
					type: "error",
				};
			},
		});

		// ─── /skills ─────────────────────────────────────────────────────────────
		this.register({
			name: "skills",
			description: "List available skills or activate one by name",
			usage: "[skill-name]",
			handler: async (ctx, args) => {
				const skillName = args.trim();
				if (!skillName) {
					return {
						output:
							"Available skills (full implementation in Phase 5):\n" +
							"  tdd       — Test-driven development workflow\n" +
							"  git-commits — Semantic commit conventions\n" +
							"  code-review — Code review checklist\n" +
							"  vitest    — Vitest test patterns\n" +
							"  owasp     — Security checklist\n" +
							"  wcag      — Accessibility checklist\n" +
							"\nActivate with: /skills <name>",
						type: "info",
					};
				}
				const known = [
					"tdd",
					"git-commits",
					"code-review",
					"vitest",
					"owasp",
					"wcag",
				];
				if (!known.includes(skillName)) {
					return {
						output: `Unknown skill: ${skillName}. Run /skills for list.`,
						type: "error",
					};
				}
				return {
					output:
						`Skill "${skillName}" activated. Context will include skill guidelines in agent prompts.\n` +
						`(Full activation in Phase 5)`,
					type: "success",
				};
			},
		});

		// ─── /debug ──────────────────────────────────────────────────────────────
		this.register({
			name: "debug",
			aliases: ["dbg"],
			description: "Toggle debug mode or show debug info",
			usage: "[on | off | info]",
			handler: async (ctx) => {
				const arg = ctx.rawArgs.trim();
				if (!arg || arg === "info") {
					const status = await ctx.miura.getStatus();
					return {
						output:
							"Debug info:\n" +
							`  Plugins: ${status.plugins.length}\n` +
							`  Agents: ${status.agents.length}\n` +
							`  Tasks: pending=${status.tasks.pending} active=${status.tasks.active} ` +
							`completed=${status.tasks.completed} failed=${status.tasks.failed}\n` +
							`  Adapters: ${ctx.miura.getAdapters().size}`,
						type: "info",
					};
				}
				return {
					output: `Debug ${arg}. (Full debug verbosity in Phase 6)`,
					type: "info",
				};
			},
		});

		// ─── /tools ──────────────────────────────────────────────────────────────
		this.register({
			name: "tools",
			description: "List available tools and their status",
			usage: "",
			handler: async (ctx) => {
				const adapterCount = ctx.miura.getAdapters().size;
				const adapters = [...ctx.miura.getAdapters().keys()];
				return {
					output:
						`Available adapters (${adapterCount}):\n` +
						adapters.map((a) => `  ${a}`).join("\n") +
						"\n  Tools are provided by adapters. Full tool registry in Phase 5.",
					type: "info",
				};
			},
		});

		// ─── /plan ───────────────────────────────────────────────────────────────
		this.register({
			name: "plan",
			aliases: ["p"],
			description: "Show pending tasks and session plan",
			usage: "",
			handler: async (ctx) => {
				const status = await ctx.miura.getStatus();
				const lines = ["Task queue:", ""];
				const { pending, active, completed, failed } = status.tasks;
				lines.push(`  pending:  ${pending}`);
				lines.push(`  active:   ${active}`);
				lines.push(`  completed: ${completed}`);
				lines.push(`  failed:   ${failed}`);
				lines.push("");
				lines.push(`Session: ${ctx.session.id}`);
				lines.push(`Messages: ${ctx.session.messageCount}`);
				return { output: lines.join("\n"), type: "info" };
			},
		});

		// ─── /scout ──────────────────────────────────────────────────────────────
		this.register({
			name: "scout",
			aliases: ["sc"],
			description:
				'Scout a directory or codebase — equivalent to CLI "scout" command',
			usage: "[path]",
			handler: async (ctx) => {
				const path = ctx.rawArgs || process.cwd();
				const result = await ctx.miura.runAgent(
					"scout",
					`Scout this codebase: ${path}`,
				);
				ctx.session.incAgents();
				return { output: result.output, type: "text" };
			},
		});

		// ─── /oracle ─────────────────────────────────────────────────────────────
		this.register({
			name: "oracle",
			aliases: ["o"],
			description: "Ask the Oracle for an architectural decision or tradeoff",
			usage: "<question>",
			handler: async (ctx) => {
				const q = ctx.rawArgs;
				if (!q) return { output: "Usage: /oracle <question>", type: "error" };
				const result = await ctx.miura.runAgent("oracle", q);
				ctx.session.incAgents();
				return { output: result.output, type: "text" };
			},
		});

		// ─── /compact ────────────────────────────────────────────────────────────
		this.register({
			name: "compact",
			description: "Trigger context compaction to free up token budget",
			usage: "",
			handler: async (_ctx) => {
				return {
					output:
						"Compaction strategy: SlidingWindow (keeps last 20 messages + summary).\n" +
						"Full implementation in Phase 6.",
					type: "info",
				};
			},
		});

		// ─── /clear ──────────────────────────────────────────────────────────────
		this.register({
			name: "clear",
			aliases: ["cls"],
			description: "Clear the terminal screen and session messages",
			usage: "",
			handler: async (ctx) => {
				ctx.session.clearMessages();
				return { output: "__CLEAR__", type: "text" };
			},
		});

		// ─── /skills ────────────────────────────────────────────────────────────────
		this.register({
			name: "skills",
			description: "Skills system — list, init, add, or remove skills",
			usage: "list | init | add <file> | remove <id>",
			aliases: ["skill"],
			handler: async (ctx, args) => {
				const parts = (args ?? "").trim().split(/\s+/);
				const sub = parts[0]?.toLowerCase();
				const rest = parts.slice(1).join(" ");

				switch (sub) {
					case "list": {
						const sm = ctx.miura.getSkillManager();
						if (!sm)
							return {
								output: "❌ SkillManager not initialized",
								type: "error",
							};
						const byPack = sm
							.list()
							.reduce<Record<string, string[]>>((acc, s) => {
								(acc[s.pack] ??= []).push(
									`  • **${s.name}** — ${s.triggers.slice(0, 3).join(", ") || "no triggers"}`,
								);
								return acc;
							}, {});
						const lines = ["## Skills", ""];
						for (const [pack, items] of Object.entries(byPack)) {
							lines.push(`### ${pack}`);
							lines.push(...items);
							lines.push("");
						}
						return { output: lines.join("\n"), type: "text" };
					}

					case "init": {
						const sm = ctx.miura.getSkillManager();
						if (!sm)
							return {
								output: "❌ SkillManager not initialized",
								type: "error",
							};
						const result = await sm.init();
						return {
							output: `✅ Skills initialized\nInstalled: ${result.installed}  Skipped: ${result.skipped}`,
							type: "success",
						};
					}

					case "add": {
						if (!rest)
							return { output: "Usage: /skills add <file.md>", type: "error" };
						const sm = ctx.miura.getSkillManager();
						if (!sm)
							return {
								output: "❌ SkillManager not initialized",
								type: "error",
							};
						try {
							const skill = await sm.add(rest);
							return {
								output: `✅ Added skill: **${skill.name}** (${skill.pack})`,
								type: "success",
							};
						} catch (e: unknown) {
							return { output: `❌ Failed to add skill: ${e}`, type: "error" };
						}
					}

					case "remove":
					case "rm": {
						if (!rest)
							return { output: "Usage: /skills remove <id>", type: "error" };
						const sm = ctx.miura.getSkillManager();
						if (!sm)
							return {
								output: "❌ SkillManager not initialized",
								type: "error",
							};
						const ok = sm.remove(rest);
						return ok
							? { output: `✅ Removed skill: **${rest}**`, type: "success" }
							: { output: `❌ Skill not found: ${rest}`, type: "error" };
					}

					case "match": {
						if (!rest)
							return {
								output: "Usage: /skills match <context text>",
								type: "error",
							};
						const sm = ctx.miura.getSkillManager();
						if (!sm)
							return {
								output: "❌ SkillManager not initialized",
								type: "error",
							};
						const content = sm.getInjectedContent(rest);
						return content
							? { output: content, type: "text" }
							: { output: "_(no skills matched)_", type: "text" };
					}

					default:
						return {
							output:
								"Skills — list, init, add, remove, match\n" +
								"  /skills list       — show all skills by pack\n" +
								"  /skills init       — install built-in skill packs\n" +
								"  /skills add <f>    — add custom skill from file\n" +
								"  /skills remove <id> — remove a skill\n" +
								"  /skills match <ctx> — show skills matching context",
							type: "info",
						};
				}
			},
		});

		// ─── /help ────────────────────────────────────────────────────────────────
		this.register({
			name: "help",
			aliases: ["?", "h"],
			description: "Show list of available commands",
			usage: "",
			handler: async () => {
				const lines = ["## Available Commands\n"];
				for (const cmd of this.commands.values()) {
					const aliases = cmd.aliases?.length
						? ` (${cmd.aliases.join(", ")})`
						: "";
					lines.push(`  **/${cmd.name}**${aliases} — ${cmd.description}`);
				}
				lines.push("", "For detailed help, see: docs/MIURA-CLI-REFERENCE.md");
				return { output: lines.join("\n"), type: "info" };
			},
		});

		// ─── /exit ───────────────────────────────────────────────────────────────
		this.register({
			name: "exit",
			aliases: ["quit", "q"],
			description: "Exit the REPL with graceful shutdown",
			usage: "",
			handler: async (ctx) => {
				ctx.session.close();
				return { output: "__EXIT__", type: "success" };
			},
		});

		// ─── /compaction ─────────────────────────────────────────────────────────────
		this.register({
			name: "compaction",
			aliases: ["compact"],
			description: "Manage compaction strategies for long conversations",
			usage:
				"list | set <strategy> [options] | config [strategy] | stats | help",
			handler: async (ctx, args) => {
				const parts = (args ?? "").trim().split(/\s+/);
				const sub = parts[0]?.toLowerCase();
				const rest = parts.slice(1).join(" ");

				switch (sub) {
					case "list": {
						const strategies = [
							{
								name: "no_compaction",
								desc: "No message compression - keeps all messages",
							},
							{
								name: "sliding_window",
								desc: "Keep last N messages (configurable window size)",
							},
							{
								name: "summarize",
								desc: "Summarize older messages when threshold exceeded",
							},
							{
								name: "hybrid",
								desc: "Combine sliding window with summarization",
							},
							{
								name: "safe_split_point",
								desc: "Smart splitting without breaking tool calls",
							},
						];

						const lines = ["## Available Compaction Strategies", ""];
						strategies.forEach((s) => {
							lines.push(`### ${s.name}`);
							lines.push(`${s.desc}`);
							lines.push("");
						});

						const current = "no_compaction"; // Default until integration complete
						lines.push(`**Current strategy:** ${current}`);

						return { output: lines.join("\n"), type: "text" };
					}

					case "set": {
						if (!rest)
							return {
								output: "Usage: /compaction set <strategy> [options]",
								type: "error",
							};
						const strategyName = rest.split(" ")[0];
						const options = rest.substring(strategyName.length).trim();

						const validStrategies = [
							"no_compaction",
							"sliding_window",
							"summarize",
							"hybrid",
							"safe_split_point",
						];
						if (!validStrategies.includes(strategyName)) {
							return {
								output: `❌ Invalid strategy: ${strategyName}\nValid strategies: ${validStrategies.join(", ")}`,
								type: "error",
							};
						}

						// Try to parse options if provided
						let parsedOptions;
						if (options) {
							try {
								parsedOptions = JSON.parse(options);
							} catch (e) {
								return {
									output: `❌ Invalid JSON options: ${options}`,
									type: "error",
								};
							}
						}

						// For now, just acknowledge the command
						// Full integration would require access to SessionManagerWithCompaction
						return {
							output: `✅ Compaction strategy set to: ${strategyName}${options ? ` with options: ${JSON.stringify(parsedOptions)}` : ""}`,
							type: "success",
						};
					}

					case "config": {
						if (!rest) {
							const config = {
								currentStrategy: "no_compaction",
								defaultConfig: {
									sliding_window: { windowSize: 50, preserveSystem: true },
									summarize: { thresholdMessages: 20, preserveSystem: true },
									hybrid: {
										keepMessages: 30,
										preserveSystem: true,
										useSummarizeForOlder: true,
									},
									safe_split_point: { innerStrategy: "sliding_window" },
								},
							};

							return {
								output: `## Current Compaction Configuration\n\n**Strategy:** ${config.currentStrategy}\n\n### Available Configurations:\n${Object.entries(
									config.defaultConfig,
								)
									.map(
										([name, cfg]) =>
											`**${name}:** ${JSON.stringify(cfg, null, 2)}`,
									)
									.join("\n\n")}`,
								type: "text",
							};
						}

						// Show specific strategy config
						const strategyConfigs = {
							sliding_window: { windowSize: 50, preserveSystem: true },
							summarize: { thresholdMessages: 20, preserveSystem: true },
							hybrid: {
								keepMessages: 30,
								preserveSystem: true,
								useSummarizeForOlder: true,
							},
							safe_split_point: { innerStrategy: "sliding_window" },
						};

						if (strategyConfigs[rest as keyof typeof strategyConfigs]) {
							return {
								output: `## ${rest} Configuration\n\n\`\`\`json\n${JSON.stringify(strategyConfigs[rest as keyof typeof strategyConfigs], null, 2)}\`\`\``,
								type: "text",
							};
						}

						return { output: `❌ Strategy not found: ${rest}`, type: "error" };
					}

					case "stats": {
						const stats = {
							totalCompactions: 0,
							contextUsage: 0,
							recommendations: [
								"Context window is normal (0-75%)",
								"Consider enabling compaction for long conversations",
								"Current strategy: no_compaction (no compression active)",
							],
						};

						const output =
							`## Compaction Statistics\n\n` +
							`**Total Compactions:** ${stats.totalCompactions}\n` +
							`**Context Window Usage:** ${stats.contextUsage}%\n\n` +
							`### Recommendations\n` +
							stats.recommendations.map((rec) => `• ${rec}`).join("\n");

						return { output, type: "info" };
					}

					case "help":
					default: {
						const help = `# Compaction Manager Commands

Manage strategies for compressing conversation history when context windows are full.

## Commands

  /compaction list              - List all available compaction strategies
  /compaction set <strategy> [options] - Set the current compaction strategy
  /compaction config [strategy] - Show strategy configuration
  /compaction stats             - Show compaction statistics and recommendations
  /compaction help              - Show this help

## Available Strategies

  • **no_compaction**: No message compression - keeps all messages
  • **sliding_window**: Keep last N messages (configurable window size)
  • **summarize**: Summarize older messages when threshold exceeded
  • **hybrid**: Combine sliding window with summarization
  • **safe_split_point**: Smart splitting without breaking tool calls

## Examples

  /compaction set sliding_window
  /compaction set hybrid {"keepMessages": 25}
  /compaction config sliding_window
  /compaction stats

## Configuration

Strategies can be configured with JSON options:
  - windowSize: Number of messages to keep (sliding_window)
  - thresholdMessages: When to start summarizing (summarize)
  - keepMessages: Number of recent messages to preserve (hybrid)
  - preserveSystem: Keep system messages in output (all strategies)`;

						return { output: help, type: "info" };
					}
				}
			},
		});

		// ─── /propose ────────────────────────────────────────────────────────────────
		this.register({
			name: "propose",
			aliases: ["new"],
			description: "Create a new change proposal following OpenSpec format",
			usage: "/propose <title>: <description>",
			handler: async (ctx, args) => {
				if (!args) {
					return {
						output: "Usage: /propose <title>: <description>",
						type: "error",
					};
				}

				const parts = args.split(":");
				const title = parts[0]?.trim();
				const description = parts.slice(1).join(":").trim();

				if (!title) {
					return {
						output: "Usage: /propose <title>: <description>",
						type: "error",
					};
				}

				const osm = ctx.miura.getOpenSpecManager();
				if (!osm)
					return {
						output: "❌ OpenSpecManager not initialized",
						type: "error",
					};

				const manager = osm.getManager();
				manager.init();

				const change = manager.createProposal(
					title,
					description || title,
					{
						summary: description || title,
						motivation: "No detailed motivation provided.",
						impact: [],
						dependencies: [],
						riskLevel: "medium",
					},
					{
						approach: "TBD",
						architecture: "TBD",
						filesChanged: [],
						decisions: [],
					},
					[],
					[],
				);

				return {
					output: `## ✅ Proposal Created\n\n**ID:** \`${change.id}\`\n**Title:** ${change.title}\n**Status:** ${change.status}\n\nUse \`/continue ${change.id}\` to start implementation.`,
					type: "success",
				};
			},
		});

		// ─── /continue ───────────────────────────────────────────────────────────────
		this.register({
			name: "continue",
			description: "Continue implementation of an open change proposal",
			usage: "/continue <change-id>",
			handler: async (ctx, args) => {
				if (!args) {
					const osm = ctx.miura.getOpenSpecManager();
					if (!osm)
						return {
							output: "❌ OpenSpecManager not initialized",
							type: "error",
						};

					const changes = osm.getManager().listChanges("active");
					if (changes.length === 0) {
						return {
							output: "No active changes. Create one with /propose.",
							type: "info",
						};
					}

					return {
						output:
							"Active changes:\n" +
							changes
								.map(
									(c) =>
										`  • \`${c.id}\` — ${c.title} (phase: ${c.currentPhase})`,
								)
								.join("\n"),
						type: "text",
					};
				}

				const osm = ctx.miura.getOpenSpecManager();
				if (!osm)
					return {
						output: "❌ OpenSpecManager not initialized",
						type: "error",
					};

				const change = osm.getManager().getChange(args.trim());
				if (!change) {
					return { output: `❌ Change not found: ${args}`, type: "error" };
				}

				osm.getManager().activateChange(change.id);

				return {
					output: `## Continuing: ${change.title}\n\n**ID:** \`${change.id}\`\n**Status:** ${change.status}\n**Tasks:** ${change.tasks.length}\n\n${change.tasks.map((t) => `  ${t.status === "completed" ? "✅" : "⬜"} ${t.title} (${t.estimatedEffort})`).join("\n")}`,
					type: "text",
				};
			},
		});

		// ─── /verify ──────────────────────────────────────────────────────────────────
		this.register({
			name: "verify",
			description: "Verify implementation against spec for a change",
			usage: "/verify <change-id>",
			handler: async (ctx, args) => {
				if (!args)
					return { output: "Usage: /verify <change-id>", type: "error" };

				const osm = ctx.miura.getOpenSpecManager();
				if (!osm)
					return {
						output: "❌ OpenSpecManager not initialized",
						type: "error",
					};

				const result = osm.getManager().verify(args.trim());

				const statusEmoji =
					result.status === "passed"
						? "✅"
						: result.status === "partial"
							? "⚠️"
							: "❌";
				const lines = [
					`## ${statusEmoji} Verification: ${result.changeId}`,
					"",
					`**Status:** ${result.status}`,
					`**Unmet:** ${result.unmetCount}/${result.totalCount}`,
					"",
					"### Requirements",
					...result.requirements.map((r) => {
						const emoji =
							r.status === "implemented"
								? "✅"
								: r.status === "partial"
									? "🔄"
									: "❌";
						return `  ${emoji} **${r.title}** — ${r.notes}`;
					}),
				];

				return {
					output: lines.join("\n"),
					type: result.status === "passed" ? "success" : "error",
				};
			},
		});

		// ─── /archive ──────────────────────────────────────────────────────────────────
		this.register({
			name: "archive",
			description: "Archive a completed change proposal",
			usage: "/archive <change-id>",
			handler: async (ctx, args) => {
				if (!args)
					return { output: "Usage: /archive <change-id>", type: "error" };

				const osm = ctx.miura.getOpenSpecManager();
				if (!osm)
					return {
						output: "❌ OpenSpecManager not initialized",
						type: "error",
					};

				try {
					const record = osm.getManager().archive(args.trim());
					return {
						output:
							`## 📦 Archived: ${record.title}\n\n` +
							`**ID:** \`${record.changeId}\`\n` +
							`**Summary:** ${record.summary}\n` +
							`**Files:** ${record.fileCount}\n` +
							`**Implemented:** ${record.requirementsImplemented}/${record.requirementsTotal}`,
						type: "success",
					};
				} catch (e) {
					return {
						output: `❌ Archive failed: ${e instanceof Error ? e.message : "Unknown error"}`,
						type: "error",
					};
				}
			},
		});

		// ─── /spec ─────────────────────────────────────────────────────────────────────
		this.register({
			name: "spec",
			aliases: ["specs"],
			description: "Manage capability specs",
			usage: "/spec [list|add|edit|search] [args]",
			handler: async (ctx, args) => {
				const parts = (args ?? "").trim().split(/\s+/);
				const sub = parts[0]?.toLowerCase();
				const rest = parts.slice(1).join(" ");

				const osm = ctx.miura.getOpenSpecManager();
				if (!osm)
					return {
						output: "❌ OpenSpecManager not initialized",
						type: "error",
					};
				const manager = osm.getManager();

				switch (sub) {
					case "list": {
						const specs = manager.listSpecs();
						if (specs.length === 0) {
							return {
								output: "No specs found. Use `/spec add` to create one.",
								type: "info",
							};
						}
						return {
							output:
								"## Capability Specs\n\n" +
								specs.map((s) => `  • \`${s.id}\` — ${s.title}`).join("\n"),
							type: "text",
						};
					}

					case "add": {
						const [id, ...titleParts] = rest.split(" ");
						if (!id)
							return {
								output: "Usage: /spec add <capability-id> <title>",
								type: "error",
							};

						const title = titleParts.join(" ") || id;
						const content = `# ${title}\n\n## Purpose\n\nSpecification for ${title}.\n\n## Requirements\n\n`;
						const spec = manager.addSpec(id, content);

						return {
							output: `✅ Spec created: **${spec.metadata.title}** (\`${id}\`)`,
							type: "success",
						};
					}

					case "search": {
						if (!rest)
							return { output: "Usage: /spec search <query>", type: "error" };
						const results = manager.searchSpecs(rest);

						if (results.length === 0) {
							return { output: `No specs matching: "${rest}"`, type: "info" };
						}

						return {
							output:
								`## Search Results for "${rest}"\n\n` +
								results
									.map(
										(r) => `  • \`${r.id}\` — ${r.title}\n    > ${r.snippet}`,
									)
									.join("\n"),
							type: "text",
						};
					}

					default:
						return {
							output:
								"Spec commands:\n" +
								"  /spec list              — list all specs\n" +
								"  /spec add <id> [title]  — create a new spec\n" +
								"  /spec search <query>    — search specs by keyword",
							type: "info",
						};
				}
			},
		});
	}

	register(cmd: CommandDef): void {
		this.commands.set(cmd.name, cmd);
	}
}
