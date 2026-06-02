/**
 * DiffApprovalService — Pide confirmación antes de escribir archivos.
 *
 * Modes:
 *   - "prompt": Muestra diff y espera input del usuario (y/n/e)
 *   - "auto-approve": Aprueba automáticamente (para pipelines automatizados)
 *   - "reject": Rechaza todos los writes (modo seguro)
 *
 * Flow:
 *   write_file → DiffApprovalService.request() → diff preview → user confirms → write
 */

import { EventEmitter } from "events";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

export type ApprovalMode = "prompt" | "auto-approve" | "reject";
export type ApprovalResult = "approved" | "rejected" | "edited" | "timeout";
export type ApprovalCallback = (result: ApprovalResult) => void;

export interface DiffRequest {
	id: string;
	filePath: string;
	newContent: string;
	oldContent: string | null;
	action: "create" | "edit" | "delete" | "execute";
	requestedBy: string; // agent role or source
}

export interface DiffApprovalConfig {
	mode: ApprovalMode;
	maxFileSizeBytes: number;
	timeoutMs: number;
	excludePatterns: string[];
}

export const DEFAULT_APPROVAL_CONFIG: Required<DiffApprovalConfig> = {
	mode: "prompt",
	maxFileSizeBytes: 1_000_000, // 1MB
	timeoutMs: 30_000, // 30s
	excludePatterns: [
		"*.lock",
		"*.log",
		"node_modules/**",
		".git/**",
		"dist/**",
		"build/**",
	],
};

// Pending approval queue
const pendingApprovals = new Map<
	string,
	{
		request: DiffRequest;
		callback: ApprovalCallback;
		timeout: ReturnType<typeof setTimeout>;
	}
>();

export class DiffApprovalService {
	private config: Required<DiffApprovalConfig>;
	private eventEmitter = new EventEmitter();
	private currentApproval: DiffRequest | null = null;

	constructor(config: Partial<DiffApprovalConfig> = {}) {
		this.config = { ...DEFAULT_APPROVAL_CONFIG, ...config };
	}

	setMode(mode: ApprovalMode): void {
		this.config.mode = mode;
	}

	getMode(): ApprovalMode {
		return this.config.mode;
	}

	/**
	 * Request approval for a write operation.
	 * Returns a promise that resolves when the user approves/rejects.
	 */
	async requestApproval(
		request: Omit<DiffRequest, "id">,
	): Promise<{
		approved: boolean;
		result: ApprovalResult;
		editedContent?: string;
	}> {
		const id = `diff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		const fullRequest: DiffRequest = { ...request, id };

		// Check exclude patterns
		if (this.shouldExclude(request.filePath)) {
			return { approved: true, result: "approved" };
		}

		// Check file size
		if (request.newContent.length > this.config.maxFileSizeBytes) {
			return { approved: false, result: "rejected" };
		}

		// Auto-approve mode
		if (this.config.mode === "auto-approve") {
			return { approved: true, result: "approved" };
		}

		// Reject mode
		if (this.config.mode === "reject") {
			return { approved: false, result: "rejected" };
		}

		// Prompt mode - wait for user input
		return this.promptUser(fullRequest);
	}

	/**
	 * Check if file matches exclude patterns.
	 */
	private shouldExclude(filePath: string): boolean {
		const normalized = filePath.replace(/\\/g, "/");
		for (const pattern of this.config.excludePatterns) {
			if (pattern.endsWith("/**")) {
				const base = pattern.slice(0, -3);
				if (normalized.startsWith(base) || normalized.includes(`/${base}/`)) {
					return true;
				}
			} else if (pattern.startsWith("*.")) {
				const ext = pattern.slice(1);
				if (normalized.endsWith(ext)) {
					return true;
				}
			} else if (normalized.includes(pattern)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Prompt user and wait for approval.
	 */
	private promptUser(request: DiffRequest): Promise<{
		approved: boolean;
		result: ApprovalResult;
		editedContent?: string;
	}> {
		return new Promise((resolve) => {
			this.currentApproval = request;

			// Show diff to user
			const diff = this.generateDiff(request);
			this.eventEmitter.emit("diff:pending", { request, diff });

			// Set timeout
			const timeout = setTimeout(() => {
				pendingApprovals.delete(request.id);
				this.currentApproval = null;
				this.eventEmitter.emit("diff:timeout", { request });
				resolve({ approved: false, result: "timeout" });
			}, this.config.timeoutMs);

			pendingApprovals.set(request.id, {
				request,
				callback: (result) => {
					clearTimeout(timeout);
					pendingApprovals.delete(request.id);
					this.currentApproval = null;

					if (result === "approved") {
						this.eventEmitter.emit("diff:approved", { request });
						resolve({ approved: true, result: "approved" });
					} else if (result === "edited") {
						this.eventEmitter.emit("diff:edited", { request });
						resolve({ approved: true, result: "edited" });
					} else {
						this.eventEmitter.emit("diff:rejected", { request });
						resolve({ approved: false, result: result });
					}
				},
				timeout,
			});
		});
	}

	/**
	 * Approve or reject a pending request.
	 */
	approve(
		id: string,
		result: "approved" | "rejected" | "edited",
		editedContent?: string,
	): void {
		const pending = pendingApprovals.get(id);
		if (pending) {
			pending.callback(result);
		}
	}

	/**
	 * Get current pending approval.
	 */
	getCurrentApproval(): DiffRequest | null {
		return this.currentApproval;
	}

	/**
	 * Get all pending approvals.
	 */
	getPendingApprovals(): DiffRequest[] {
		return Array.from(pendingApprovals.values()).map((p) => p.request);
	}

	/**
	 * Generate a diff for display.
	 */
	generateDiff(request: DiffRequest): string {
		const lines: string[] = [];
		const maxLines = 50;

		lines.push(
			`\n📝 ${request.action === "create" ? "CREATE" : request.action === "delete" ? "DELETE" : request.action === "execute" ? "EXECUTE" : "EDIT"}: ${request.filePath}`,
		);
		lines.push(`   Requested by: ${request.requestedBy}`);
		lines.push("─".repeat(60));

		if (request.action === "delete") {
			lines.push("- (file will be deleted)");
			return lines.join("\n");
		}

		if (request.action === "execute") {
			// Shell command: newContent holds the full command + args.
			lines.push("⚠️  Shell command about to run:");
			request.newContent.split("\n").forEach((line) => {
				lines.push(`  $ ${line}`);
			});
			lines.push("─".repeat(60));
			lines.push("Actions: [y] approve  [n] reject  [q] quit all");
			lines.push("");
			return lines.join("\n");
		}

		const newLines = request.newContent.split("\n");
		const oldLines = request.oldContent?.split("\n") ?? [];
		const contextLines = 3;

		if (request.action === "create") {
			// Show first N lines of new file
			lines.push("+ (new file)");
			const preview = newLines.slice(0, maxLines);
			preview.forEach((line, i) => {
				lines.push(`+ ${String(i + 1).padStart(3, " ")} | ${line}`);
			});
			if (newLines.length > maxLines) {
				lines.push(`+ ... (${newLines.length - maxLines} more lines)`);
			}
		} else {
			// Show diff with context
			const oldSet = new Set(oldLines);
			const newSet = new Set(newLines);

			// Simple line-by-line diff
			const maxDisplay = Math.min(
				Math.max(oldLines.length, newLines.length),
				maxLines,
			);

			for (let i = 0; i < maxDisplay; i++) {
				const oldLine = oldLines[i];
				const newLine = newLines[i];

				if (oldLine === undefined) {
					lines.push(`+ ${String(i + 1).padStart(3, " ")} | + ${newLine}`);
				} else if (newLine === undefined) {
					lines.push(`- ${String(i + 1).padStart(3, " ")} | - ${oldLine}`);
				} else if (oldLine !== newLine) {
					lines.push(`~ ${String(i + 1).padStart(3, " ")} | - ${oldLine}`);
					lines.push(`~ ${String(i + 1).padStart(3, " ")} | + ${newLine}`);
				} else {
					if (i < 10 || Math.random() < 0.1) {
						// Show first 10 and sample of rest
						lines.push(`  ${String(i + 1).padStart(3, " ")} |   ${oldLine}`);
					}
				}
			}

			// Summary
			const added = newLines.filter((l) => !oldSet.has(l)).length;
			const removed = oldLines.filter((l) => !newSet.has(l)).length;
			lines.push("─".repeat(60));
			lines.push(`📊 +${added} lines, -${removed} lines`);
		}

		lines.push("─".repeat(60));
		lines.push("Actions: [y] approve  [n] reject  [e] edit  [q] quit all");
		lines.push("");

		return lines.join("\n");
	}

	/**
	 * Listen to diff events.
	 */
	on(event: string, handler: (...args: any[]) => void): void {
		this.eventEmitter.on(event, handler);
	}

	off(event: string, handler: (...args: any[]) => void): void {
		this.eventEmitter.off(event, handler);
	}
}

// Singleton instance
let instance: DiffApprovalService | null = null;

export function getDiffApprovalService(
	config?: Partial<DiffApprovalConfig>,
): DiffApprovalService {
	if (!instance) {
		instance = new DiffApprovalService(config);
	}
	return instance;
}

export function setDiffApprovalMode(mode: ApprovalMode): void {
	getDiffApprovalService().setMode(mode);
}

/**
 * Wrapper for file writes with diff approval.
 */
export async function writeFileWithApproval(
	filePath: string,
	content: string,
	requestedBy: string,
	options: { cwd?: string } = {},
): Promise<{ success: boolean; result: ApprovalResult }> {
	const service = getDiffApprovalService();
	const cwd = options.cwd ?? process.cwd();
	const absPath = resolve(cwd, filePath);

	// Get old content if file exists
	let oldContent: string | null = null;
	if (existsSync(absPath)) {
		try {
			oldContent = readFileSync(absPath, "utf-8");
		} catch {
			// Ignore read errors
		}
	}

	const action = oldContent === null ? "create" : "edit";

	const { approved, result, editedContent } = await service.requestApproval({
		filePath: absPath,
		newContent: content,
		oldContent,
		action,
		requestedBy,
	});

	if (!approved) {
		return { success: false, result };
	}

	// Write the file (original or edited)
	const finalContent = editedContent ?? content;
	writeFileSync(absPath, finalContent, "utf-8");

	return { success: true, result: "approved" };
}
