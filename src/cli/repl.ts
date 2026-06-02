/**
 * MiuraSwarm REPL — Interactive shell with /commands, streaming, and styled output.
 *
 * Usage:
 *   bun run src/cli/repl.ts
 *   bun run src/cli/repl.ts --resume <session-id>
 */

import { loadEnv } from "../env.js";
import { mkdirSync } from "fs";
import { resolve } from "path";
import { MiuraSwarm } from "../index.js";
import { CommandRegistry } from "./command-registry.js";
import type { CommandResult } from "./command-registry.js";
import { SessionManager } from "./session-manager.js";

loadEnv();

// Ensure .miura directory exists for state DB
try {
	mkdirSync(resolve(".miura"), { recursive: true });
} catch {}

// ANSI color codes
const C = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	italic: "\x1b[3m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	gray: "\x1b[90m",
	brightRed: "\x1b[91m",
	brightGreen: "\x1b[92m",
	brightYellow: "\x1b[93m",
	brightBlue: "\x1b[94m",
	brightMagenta: "\x1b[95m",
	brightCyan: "\x1b[96m",
};

const BANNER = `${C.cyan}
  ███╗   ██╗███████╗ ██████╗ ███╗   ██╗
  ████╗  ██║██╔════╝██╔═══██╗████╗  ██║
  ██╔██╗ ██║█████╗  ██║   ██║██╔██╗ ██║
  ██║╚██╗██║██╔══╝  ██║   ██║██║╚██╗██║
  ██║ ╚████║███████╗╚██████╔╝██║ ╚████║
  ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
${C.reset}${C.gray}Swarm REPL — Type /help for commands${C.reset}
`;

const PROMPT = `${C.blue}miura${C.reset} ${C.gray}›${C.reset} `;
const CONTINUATION_PROMPT = `${C.gray}... ${C.reset}`;

export async function runRepl(
	opts: { resumeSessionId?: string } = {},
): Promise<void> {
	// Initialize MiuraSwarm
	const miura = new MiuraSwarm();
	await miura.initialize();

	// Session management
	const session = new SessionManager();

	session.startAutoPersist();

	// Command registry
	const registry = new CommandRegistry();

	// Readline setup
	const rl = await createReadline({
		history: loadHistory(),
		completer: (line: string) => completeCommand(line, registry),
	});

	// Print banner
	console.log(BANNER);
	if (opts.resumeSessionId) {
		console.log(`${C.gray}Resumed session: ${session.id}${C.reset}`);
	} else {
		console.log(`${C.gray}Session: ${session.id}${C.reset}`);
	}
	console.log(`${C.gray}─────────────────────────────────────────${C.reset}\n`);

	// Main loop
	let multilineBuffer: string[] = [];
	let isMultiline = false;

	const shutdown = async () => {
		session.close();
		await miura.shutdown();
		saveHistory(rl.history);
		rl.close();
	};

	try {
		while (true) {
			const raw = await rl.question(isMultiline ? CONTINUATION_PROMPT : PROMPT);
			const line = raw.trimEnd();

			if (!line) continue;

			// Add to history (skip empty and pure command calls)
			if (line.trim()) rl.history.push(line);

			// Handle exit commands
			if (["/exit", "/quit", "/q"].some((c) => line === c)) {
				await shutdown();
				break;
			}

			// Check if this line closes a multiline block
			if (isMultiline && line === "```") {
				isMultiline = false;
				const fullInput = multilineBuffer.join("\n");
				multilineBuffer = [];
				const result = await executeInput(miura, session, registry, fullInput);
				await handleResult(result, session);
				continue;
			}

			if (isMultiline) {
				multilineBuffer.push(line);
				continue;
			}

			// Start multiline on ```
			if (line === "```") {
				isMultiline = true;
				multilineBuffer = [];
				continue;
			}

			// Normal single-line input
			const result = await executeInput(miura, session, registry, line);
			await handleResult(result, session);
		}
	} catch (err: any) {
		if (err?.message?.includes("EOF") || err?.message?.includes("cancel")) {
			console.log(`\n${C.yellow}Goodbye!${C.reset}`);
		} else {
			console.error(`${C.red}REPL error: ${err.message}${C.reset}`);
		}
	} finally {
		await shutdown();
	}
}

// === Input Execution ===

async function executeInput(
	miura: MiuraSwarm,
	session: SessionManager,
	registry: CommandRegistry,
	input: string,
): Promise<CommandResult> {
	const match = registry.match(input);

	if (!match) {
		// Free-text → run as a quick chat agent
		session.addUser(input);
		const recent = session.getRecentMessages(10);
		const contextPrompt =
			recent.length > 0
				? `Recent session context:\n${recent.map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join("\n")}\n\nCurrent task:\n${input}`
				: input;

		// Subscribe to live events BEFORE calling runAgent. The agent loop
		// emits `agent.token` per streamed content chunk and `agent.toolCalled`
		// after each tool executes. We render both in place. If no token
		// arrives (e.g. /stream is off, or the adapter doesn't expose
		// streamChat), we fall back to printing the final result once.
		const eventBus = miura.getEventBus();
		let streamedAny = false;
		const STREAMED_SENTINEL = "__STREAMED__";

		const onToken = (_payload: { agentId: string; token: string }) => {
			streamedAny = true;
			process.stdout.write(_payload.token);
		};
		const onToolCalled = (payload: {
			agentId: string;
			name: string;
			output: string;
			error?: string;
			durationMs: number;
		}) => {
			// If we're inside a streaming response, print a blank line first
			// so the tool-call card stands out from the streamed text.
			if (streamedAny) process.stdout.write("\n");
			const ok = !payload.error;
			const sym = ok ? "⏺" : "✗";
			const color = ok ? C.cyan : C.red;
			const argsShort =
				payload.output.length > 0
					? ` → ${payload.output.length} chars`
					: "";
			process.stdout.write(
				`${color}${sym} ${payload.name}${C.reset}${C.dim}${argsShort} (${payload.durationMs}ms)${C.reset}\n`,
			);
		};

		eventBus.on("agent.token", onToken as any);
		eventBus.on("agent.toolCalled", onToolCalled as any);

		try {
			const override = session.activeModel;
			const result = await miura.runAgent(
				"chat",
				contextPrompt,
				override
					? { provider: override.provider as any, model: override.model }
					: undefined,
			);
			session.addAssistant(result.output);
			session.incAgents();

			if (streamedAny) {
				// Tokens were already printed live. End the streamed line
				// cleanly and tell handleResult to NOT re-print.
				process.stdout.write("\n");
				return { output: STREAMED_SENTINEL, type: "text" };
			}
			// No streaming happened (adapter has no streamChat, or /stream
			// is off). Use the normal success path.
			return { output: result.output, type: "success" };
		} catch (err: any) {
			if (streamedAny) process.stdout.write("\n");
			return {
				output: `❌ ${err.message || "Agent execution failed"}`,
				type: "error",
			};
		} finally {
			eventBus.off("agent.token", onToken as any);
			eventBus.off("agent.toolCalled", onToolCalled as any);
		}
	}

	const { cmd, args } = match;
	session.addUser(input);

	try {
		const result = await cmd.handler({ miura, session, rawArgs: args }, args);
		session.addAssistant(result.output);
		return result;
	} catch (err: any) {
		return { output: `${C.red}Error: ${err.message}${C.reset}`, type: "error" };
	}
}

// === Result Handling ===

async function handleResult(
	result: CommandResult,
	session: SessionManager,
): Promise<void> {
	// Streamed results already rendered live; the sentinel is just so we
	// don't double-print.
	if (result.output === "__STREAMED__") return;

	switch (result.type) {
		case "error":
			printError(result.output);
			break;
		case "success":
			printSuccess(result.output);
			break;
		case "info":
			printInfo(result.output);
			break;
		case "diff":
			printDiff(result.output);
			break;
		case "text":
		default:
			printOutput(result.output);
			break;
	}

	if (result.output === "__CLEAR__") {
		clearScreen();
	} else if (result.output === "__EXIT__") {
		session.close();
		throw new Error("exit");
	}
}

// === Styled Output ===

function printOutput(text: string): void {
	// Strip existing ANSI, then re-apply light styling
	const clean = stripAnsi(text);
	const lines = clean.split("\n");
	for (const line of lines) {
		console.log(`  ${C.gray}${line}${C.reset}`);
	}
}

function printError(text: string): void {
	console.log(`${C.brightRed}✗ ${stripAnsi(text)}${C.reset}`);
}

function printSuccess(text: string): void {
	console.log(`${C.brightGreen}✓ ${stripAnsi(text)}${C.reset}`);
}

function printInfo(text: string): void {
	const lines = stripAnsi(text).split("\n");
	for (const line of lines) {
		console.log(`${C.gray}  ${line}${C.reset}`);
	}
}

function printDiff(text: string): void {
	const lines = stripAnsi(text).split("\n");
	console.log(C.dim + "─".repeat(60) + C.reset);
	for (const line of lines) {
		if (line.startsWith("+")) {
			console.log(`${C.green}${line}${C.reset}`);
		} else if (line.startsWith("-")) {
			console.log(`${C.red}${line}${C.reset}`);
		} else if (line.startsWith("@@")) {
			console.log(`${C.cyan}${line}${C.reset}`);
		} else {
			console.log(`  ${line}`);
		}
	}
	console.log(C.dim + "─".repeat(60) + C.reset);
}

function clearScreen(): void {
	process.stdout.write("\x1b[2J\x1b[H");
}

// === Readline ===

interface HistoryInterface {
	history: string[];
	question(query: string): Promise<string>;
	close(): void;
}

async function createReadline(opts: {
	history: string[];
	completer: (line: string) => [string[], string];
}): Promise<HistoryInterface> {
	const readline = await import("readline");
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		completer: opts.completer,
		history: opts.history,
		historySize: 200,
		crlfDelay: 0.1,
	});

	const questionAsync = (query: string): Promise<string> =>
		new Promise((resolve) => rl.question(query, resolve));

	return {
		history: opts.history,
		question: questionAsync,
		close: () => rl.close(),
	};
}

function loadHistory(): string[] {
	try {
		const { readFileSync } = require("fs") as typeof import("fs");
		const path = getHistoryPath();
		return readFileSync(path, "utf-8").split("\n").filter(Boolean).slice(-200);
	} catch {
		return [];
	}
}

function saveHistory(history: string[]): void {
	try {
		const { writeFileSync, mkdirSync } = require("fs") as typeof import("fs");
		const { dirname } = require("path") as typeof import("path");
		const path = getHistoryPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, history.join("\n"), "utf-8");
	} catch {
		/* ignore */
	}
}

function getHistoryPath(): string {
	const { homedir } = require("os") as typeof import("os");
	const { join } = require("path") as typeof import("path");
	return join(homedir(), ".miura", "repl-history");
}

// === Tab Completion ===

function completeCommand(
	line: string,
	registry: CommandRegistry,
): [string[], string] {
	const commands = registry.listAll();
	const hits = commands
		.filter((c) => "/" + c.name.startsWith(line))
		.map((c) => "/" + c.name);
	return [hits, line];
}

// === ANSI Helpers ===

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

// === CLI Entry Point (only runs when repl.ts is executed directly) ===
const isMainModule =
	process.argv[1]?.endsWith("repl.ts") || process.argv[1]?.endsWith("repl.js");
if (isMainModule) {
	main(process.argv.slice(2)).catch((err) => {
		if (err?.message !== "exit") {
			console.error(C.red, err, C.reset);
			process.exit(1);
		}
	});
}

async function main(argv: string[]): Promise<void> {
	let resumeSessionId: string | undefined;

	// Parse --resume / -r flags
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--resume" || arg === "-r") {
			resumeSessionId = argv[i + 1];
			i++;
		} else if (arg === "--help" || arg === "-h") {
			printHelp();
			return;
		}
	}

	await runRepl({ resumeSessionId });
}

function printHelp(): void {
	console.log(`
MiuraSwarm REPL

  bun run src/cli/repl.ts [options]

Options:
  --resume, -r <session-id>   Resume a previous session
  --help, -h                 Show this help

Commands:
  /chat <task>     Run full pipeline
  /review <diff>   Review changes
  /add <task>      Queue a task
  /read <file>     Explain a file
  /swarm <task>    Run full pipeline (shortcut)
  /agent <role> <task>  Run single agent
  /model [role]    Show model assignments
  /tokens          Show token usage
  /brain [query]   Query session memory
  /graph [init|search]  Code graph
  /skills [name]   Skills system
  /debug [on|off]   Toggle debug
  /tools           List available tools
  /plan            Show pending tasks
  /scout [path]    Scout codebase
  /oracle <q>      Ask Oracle
  /compact         Trigger compaction
  /clear           Clear screen
  /exit            Exit REPL
`);
}
