import type {
	AgentCapability,
	AgentConfig,
	AgentRole,
	Plugin,
	PluginHostAPI,
} from "../../../core/types.js";

export const CHAT_CONFIG: AgentConfig = {
	id: "agent-chat",
	role: "chat" as AgentRole,
	specialty:
		"Versatile coding assistant: directory audits, file exploration, code reviews, and general tasks. Uses tools to actually DO things.",
	defaultModel: {
		// Coder-specialized, agentic + tool_use capable. Primary stays on
		// NVIDIA NIM because the free tier is fast and has the best
		// tool-use reliability for a chat agent. The reasoning 49B model
		// was too verbose/slow for interactive coding.
		provider: "nvidia-nim",
		model: "qwen/qwen3-coder-480b-a35b-instruct",
		maxTokens: 8192,
	},
	// Local-first safety net: ollama → lmstudio → llama-server, in that
	// order. If nvidia-nim is unreachable, the agent keeps working on
	// the same model family on the user's machine.
	fallbackModels: [
		{ provider: "ollama", model: "qwen2.5-coder-7b" },
		{ provider: "lmstudio", model: "qwen2.5-coder-7b" },
		{ provider: "llama-server", model: "qwen2.5-coder-7b-q4_k_m" },
	],
	maxTokens: 8192,
	timeoutMs: 60_000,
	capabilities: [
		"context",
		"tool_use",
		"code",
		"plan",
		"review",
		"decision",
		"scout",
	] as AgentCapability[],
};

export class ChatAgent implements Plugin {
	manifest = {
		id: "agent-chat",
		name: "Chat Agent",
		version: "0.1.0",
		type: "agent" as const,
		capabilities: [
			"context",
			"tool_use",
			"code",
			"plan",
			"review",
			"decision",
			"scout",
		],
		dependencies: [] as string[],
	};

	async initialize(_host: PluginHostAPI): Promise<void> {}
	async activate(): Promise<void> {}
	async deactivate(): Promise<void> {}
	async unload(): Promise<void> {}

	getConfig(): AgentConfig {
		return CHAT_CONFIG;
	}

	getSystemPrompt(): string {
		return `You are a helpful coding assistant in MiuraSwarm — a multi-agent orchestrator.

CRITICAL: When the user asks you to do something with files, code, or their project, you MUST use the available tools. NEVER just describe what you would do — actually DO it.

Available tools (USE THEM):
- read_file(file_path): Read file contents from disk — use for exploring code
- grep(pattern, path): Search for patterns in files — use for finding things
- glob(pattern, path): Find files matching a pattern — use for listing files
- run_shell_command(command): Run shell commands — use for git, ls, etc.
- edit_file(file_path, old_string, new_string): Surgically replace an exact string in an existing file — PREFER THIS to modify files
- write_file(file_path, content): Create a new file or fully overwrite one — only for new files or full rewrites

Examples of what to do:

User: "revisa el directorio actual"
→ Use glob("**/*", ".") to list files, then read_file on key files

User: "busca archivos .ts que tengan 'fix'"
→ Use grep with pattern "fix" on .ts files

User: "audita el proyecto"
→ Use glob("**/*.{ts,js,json}", ".") to get overview, read key files, run git commands

User: "explica este archivo"
→ Use read_file to read it, then explain

IMPORTANT RULES:
1. You have tools. USE THEM. Do not ask the user to do steps manually.
2. If a task requires multiple steps, use multiple tool calls in sequence.
3. Return actual results: file contents, search results, file listings.
4. Be concise but thorough. Show real data.
5. Respond in the same language the user uses.
6. For simple greetings, just chat. For anything that needs file access, use tools.`;
	}
}
