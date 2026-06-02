/**
 * LlamaServerManager — spawns and manages a llama-server child process.
 *
 * Responsibilities:
 * - Detect if llama-server already running on the configured port
 * - If not running, spawn it as a child process with the configured model
 * - Health check polling
 * - Auto-restart on unexpected exit
 * - Graceful shutdown (SIGTERM → SIGKILL)
 *
 * Lives in the "provider" plugin type — not an LLMAdapter, but the infrastructure
 * that provides a local HTTP endpoint for adapters to call.
 */

import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

export interface LlamaServerConfig {
	/** Path to llama-server.exe (or llama-server on Unix) */
	serverPath: string;
	/** Path to .gguf model file */
	modelPath: string;
	/** Port to listen on. Default: 8050 */
	port?: number;
	/** Context size. Default: 8192 */
	contextSize?: number;
	/** GPU layers to offload. 99 = all. Default: 99 */
	gpuLayers?: number;
	/** Additional llama-server CLI args */
	extraArgs?: string[];
	/**
	 * Optional spawn function override.
	 * Allows test injection of a mock spawn.
	 * Defaults to `child_process.spawn`.
	 */
	spawnFn?: (command: string, args: string[], opts: object) => ChildProcess;
	/**
	 * Optional fetch function override for testing.
	 * Allows injecting a mock fetch without replacing globalThis.
	 * Defaults to the global `fetch`.
	 */
	fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface LlamaHealthStatus {
	running: boolean;
	uptimeMs: number;
	memoryUsageMb: number;
	gpuMemoryUsedMb: number;
	lastTokenTime: number | null;
	port: number;
	model: string;
	pid: number | null;
}

const DEFAULT_PORT = 8050;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const STARTUP_GRACE_MS = 5_000;

export class LlamaServerManager extends EventEmitter {
	private config: Required<Omit<LlamaServerConfig, "spawnFn" | "fetchFn">>;
	private spawnImpl: (
		command: string,
		args: string[],
		opts: object,
	) => ChildProcess;
	private fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
	private process: ChildProcess | null = null;
	private startedAt: number | null = null;
	private lastTokenTime: number | null = null;
	private externallyManaged = false;
	private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
	private restarting = false;
	private manualStop = false;

	constructor(config: LlamaServerConfig) {
		super();
		this.config = {
			port: config.port ?? DEFAULT_PORT,
			contextSize: config.contextSize ?? 8192,
			gpuLayers: config.gpuLayers ?? 99,
			extraArgs: config.extraArgs ?? [],
			serverPath: config.serverPath,
			modelPath: config.modelPath,
		};
		this.spawnImpl = config.spawnFn ?? spawn;
		this.fetchImpl = config.fetchFn ?? fetch;
	}

	// === Public API ===

	get baseUrl(): string {
		return `http://127.0.0.1:${this.config.port}`;
	}

	get modelPath(): string {
		return this.config.modelPath;
	}

	get port(): number {
		return this.config.port;
	}

	get isRunning(): boolean {
		// Externally managed: we detect a server on the port but don't own the process
		if (this.externallyManaged && this.startedAt !== null) return true;
		return this.process !== null && this.startedAt !== null;
	}

	async start(): Promise<void> {
		if (this.isRunning) {
			this.emit("info", "llama-server already running, skipping start");
			return;
		}

		// First, check if a server is already listening on the port
		const existing = await this.checkPortInUse(this.config.port);
		if (existing) {
			this.emit(
				"info",
				`llama-server already listening on port ${this.config.port}`,
			);
			this.externallyManaged = true;
			this.startedAt = Date.now();
			this.process = null; // externally managed
			this.startHealthPolling();
			return;
		}

		// Spawn our own server
		await this.spawnServer();
	}

	async stop(): Promise<void> {
		this.manualStop = true;
		this.stopHealthPolling();

		if (!this.process) {
			// Either not running or externally managed
			this.externallyManaged = false;
			this.process = null;
			this.startedAt = null;
			this.emit("info", "llama-server stopped (no process to kill)");
			return;
		}

		this.emit("info", "Sending SIGTERM to llama-server...");

		// Graceful shutdown
		this.process.kill("SIGTERM");
		const killTimeout = setTimeout(() => {
			if (this.process && !this.process.killed) {
				this.emit("warn", "SIGTERM timed out, sending SIGKILL");
				this.process.kill("SIGKILL");
			}
		}, 5_000);

		await new Promise<void>((resolve) => {
			this.process!.once("exit", () => {
				clearTimeout(killTimeout);
				resolve();
			});
		});

		this.process = null;
		this.startedAt = null;
		this.emit("info", "llama-server stopped");
	}

	async healthCheck(): Promise<LlamaHealthStatus> {
		const pid = this.process?.pid ?? null;
		const uptimeMs = this.startedAt ? Date.now() - this.startedAt : 0;

		// If we manage the process, check if it's still alive
		if (this.process && this.process.exitCode !== null) {
			return {
				running: false,
				uptimeMs: 0,
				memoryUsageMb: 0,
				gpuMemoryUsedMb: 0,
				lastTokenTime: null,
				port: this.config.port,
				model: this.config.modelPath.split(/[/\\]/).pop() ?? "unknown",
				pid: null,
			};
		}

		// Try to reach the health endpoint
		try {
			const controller = new AbortController();
			const timeout = setTimeout(
				() => controller.abort(),
				HEALTH_CHECK_TIMEOUT_MS,
			);

			const response = await this.fetchImpl(`${this.baseUrl}/health`, {
				signal: controller.signal,
			});

			clearTimeout(timeout);

			if (response.ok) {
				let gpuMemoryUsedMb = 0;
				try {
					const data = (await response.json()) as {
						gpu_memory_used_mb?: number;
					};
					gpuMemoryUsedMb = data.gpu_memory_used_mb ?? 0;
				} catch {
					// Some llama-server builds don't expose this endpoint
				}

				return {
					running: true,
					uptimeMs,
					memoryUsageMb: 0, // not available without platform-specific code
					gpuMemoryUsedMb,
					lastTokenTime: this.lastTokenTime,
					port: this.config.port,
					model: this.config.modelPath.split(/[/\\]/).pop() ?? "unknown",
					pid,
				};
			}
		} catch {
			// Health endpoint not available — fall back to basic connectivity check
		}

		// Fallback: just check if port is open
		const portOpen = await this.checkPortInUse(this.config.port);
		return {
			running: portOpen,
			uptimeMs: portOpen ? uptimeMs : 0,
			memoryUsageMb: 0,
			gpuMemoryUsedMb: 0,
			lastTokenTime: portOpen ? this.lastTokenTime : null,
			port: this.config.port,
			model: this.config.modelPath.split(/[/\\]/).pop() ?? "unknown",
			pid,
		};
	}

	markTokenGenerated(): void {
		this.lastTokenTime = Date.now();
	}

	// === Private ===

	private async spawnServer(): Promise<void> {
		const { serverPath, modelPath, port, contextSize, gpuLayers, extraArgs } =
			this.config;

		const args = [
			"-m",
			modelPath,
			"-c",
			String(contextSize),
			"-ngl",
			String(gpuLayers),
			"--port",
			String(port),
			"--host",
			"127.0.0.1",
			...extraArgs,
		];

		this.emit("info", `Starting llama-server: ${serverPath} ${args.join(" ")}`);

		this.process = this.spawnImpl(serverPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
			env: { ...process.env },
		});

		this.startedAt = Date.now();
		const startupTimeout = setTimeout(() => {
			this.emit("info", "llama-server startup grace period passed");
		}, STARTUP_GRACE_MS);

		this.process.stdout?.on("data", (data: Buffer) => {
			const line = data.toString().trim();
			this.emit("server-log", line);
			if (
				line.includes("HTTP server listening") ||
				line.includes("server started")
			) {
				clearTimeout(startupTimeout);
				this.emit("ready");
			}
		});

		this.process.stderr?.on("data", (data: Buffer) => {
			const line = data.toString().trim();
			if (line) {
				this.emit("server-log", `[stderr] ${line}`);
			}
		});

		this.process.on("exit", (code, signal) => {
			clearTimeout(startupTimeout);
			this.emit(
				"server-log",
				`llama-server exited: code=${code} signal=${signal}`,
			);

			if (this.manualStop) {
				this.process = null;
				this.startedAt = null;
				return;
			}

			// Auto-restart on unexpected exit
			if (!this.restarting) {
				this.emit(
					"warn",
					`llama-server crashed (${signal ?? code}), restarting in 3s...`,
				);
				this.restarting = true;
				this.startedAt = null;
				this.process = null;

				setTimeout(async () => {
					this.restarting = false;
					try {
						await this.spawnServer();
					} catch (err) {
						this.emit("error", `Failed to restart llama-server: ${err}`);
					}
				}, 3_000);
			}
		});

		this.startHealthPolling();
	}

	private startHealthPolling(): void {
		this.stopHealthPolling();
		this.healthCheckInterval = setInterval(async () => {
			const status = await this.healthCheck();
			if (!status.running && !this.manualStop) {
				this.emit("server-down");
			}
		}, HEALTH_CHECK_INTERVAL_MS);
	}

	private stopHealthPolling(): void {
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
			this.healthCheckInterval = null;
		}
	}

	private async checkPortInUse(port: number): Promise<boolean> {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 2_000);
			const response = await this.fetchImpl(
				`http://127.0.0.1:${port}/v1/models`,
				{
					signal: controller.signal,
				},
			);
			clearTimeout(timeout);
			return response.ok;
		} catch {
			return false;
		}
	}
}
