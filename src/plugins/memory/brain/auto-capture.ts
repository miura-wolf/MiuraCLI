/**
 * AutoCaptureService — Detecta y guarda automáticamente decisiones y hallazgos.
 *
 * Patterns detectados:
 *   - "**What**:" / "**Why**:" / "**Where**:" → bugfix format
 *   - "decision:" → decisión explícita
 *   - "Fixed X by" → bugfix
 *   - "workaround:" → workaround
 *   - "Gotcha:" / "Gotcha:" → patrón/gotcha
 *   - "Learned:" → aprendizaje
 */

import type { BrainManager } from "./brain-manager.js";
import type { EventBus } from "../../../core/event-bus.js";

export interface AutoCaptureConfig {
	enabled: boolean;
	minConfidence: number;
	captureDecisions: boolean;
	captureBugfixes: boolean;
	capturePatterns: boolean;
}

export const DEFAULT_AUTO_CAPTURE_CONFIG: Required<AutoCaptureConfig> = {
	enabled: true,
	minConfidence: 0.7,
	captureDecisions: true,
	captureBugfixes: true,
	capturePatterns: true,
};

// Pattern definitions
const PATTERNS = {
	// Bugfix format (ADR style): **What**: ... **Why**: ... **Where**: ...
	bugfixAdr: {
		regex: /\*\*What\*\*:\s*(.+?)(?=\*\*Why\*\*:)/s,
		type: "bugfix" as const,
		confidence: 0.95,
	},
	bugfixAdrWhy: {
		regex: /\*\*Why\*\*:\s*(.+?)(?=\*\*Where\*\*:)/s,
		type: "bugfix" as const,
		confidence: 0.9,
	},
	bugfixAdrWhere: {
		regex: /\*\*Where\*\*:\s*(.+?)(?=\*\*Learned\*\*:)/s,
		type: "bugfix" as const,
		confidence: 0.85,
	},

	// Decision: explicit decision marker
	decision: {
		regex: /decision:\s*(.+)/is,
		type: "decision" as const,
		confidence: 0.95,
	},

	// Fixed X by Y
	bugfixFixed: {
		regex: /fixed\s+(\w+)\s+by\s+([^.]+)/i,
		type: "bugfix" as const,
		confidence: 0.8,
	},

	// Workaround detected
	workaround: {
		regex: /workaround:\s*(.+)/is,
		type: "bugfix" as const,
		confidence: 0.9,
	},

	// Gotcha / Pattern detected
	gotcha: {
		regex: /(gotcha|g?otcha):\s*(.+)/is,
		type: "pattern" as const,
		confidence: 0.85,
	},

	// Learned something
	learned: {
		regex: /learned:\s*(.+)/is,
		type: "learning" as const,
		confidence: 0.8,
	},

	// Architecture decision
	archDecision: {
		regex: /arch(?:itecture)?\s+decision:\s*(.+)/is,
		type: "decision" as const,
		confidence: 0.95,
	},

	// Configuration change
	configChange: {
		regex: /(?:config|setting):\s*(.+)/is,
		type: "config" as const,
		confidence: 0.75,
	},

	// Discovery / non-obvious finding
	discovery: {
		regex: /discovery:\s*(.+)/is,
		type: "discovery" as const,
		confidence: 0.85,
	},
};

export class AutoCaptureService {
	private brain: BrainManager;
	private config: Required<AutoCaptureConfig>;
	private boundHandler: (payload: any) => void;

	constructor(brain: BrainManager, config: Partial<AutoCaptureConfig> = {}) {
		this.brain = brain;
		this.config = { ...DEFAULT_AUTO_CAPTURE_CONFIG, ...config };
		this.boundHandler = this.onAgentCompleted.bind(this);
	}

	start(eventBus: EventBus): void {
		if (!this.config.enabled) return;
		eventBus.on("agent.completed", this.boundHandler as any);
	}

	stop(eventBus: EventBus): void {
		eventBus.off("agent.completed", this.boundHandler as any);
	}

	/**
	 * Analyze text and extract auto-capturable content.
	 * Returns array of captures to be saved.
	 */
	analyzeText(text: string, sessionId?: string): CapturedEntry[] {
		const captures: CapturedEntry[] = [];

		for (const [name, pattern] of Object.entries(PATTERNS)) {
			const match = text.match(pattern.regex);
			if (match && match[1]) {
				const content = match[1].trim();
				if (content.length < 10) continue; // Too short

				const type = this.mapPatternToType(name, pattern.type);
				if (!this.shouldCapture(type)) continue;

				captures.push({
					type,
					title: this.generateTitle(type, content),
					content: content,
					confidence: pattern.confidence,
					sessionId,
					metadata: { pattern: name },
				});
			}
		}

		return captures;
	}

	private onAgentCompleted(payload: {
		agentId: string;
		result: { output?: string };
	}): void {
		if (!this.config.enabled) return;

		const output = payload.result?.output;
		if (!output || typeof output !== "string") return;

		const captures = this.analyzeText(output);
		for (const cap of captures) {
			this.saveCapture(cap).catch(console.error);
		}
	}

	private async saveCapture(cap: CapturedEntry): Promise<void> {
		const saveMethods: Record<
			string,
			(title: string, content: string, sessionId?: string) => Promise<any>
		> = {
			decision: (t, c, s) => this.brain.saveDecision(t, c, s),
			bugfix: (t, c, s) => this.brain.saveBugFix(t, c, c, "", s),
			pattern: (t, c, s) => this.brain.savePattern(t, c, s),
			discovery: (t, c, s) =>
				this.brain.save({
					type: "discovery",
					topicKey: t.toLowerCase().replace(/\s+/g, "-"),
					title: t,
					content: c,
					sessionId: s,
					metadata: {},
				}),
			learning: (t, c, s) =>
				this.brain.save({
					type: "learning",
					topicKey: t.toLowerCase().replace(/\s+/g, "-"),
					title: t,
					content: c,
					sessionId: s,
					metadata: {},
				}),
			config: (t, c, s) =>
				this.brain.save({
					type: "config",
					topicKey: t.toLowerCase().replace(/\s+/g, "-"),
					title: t,
					content: c,
					sessionId: s,
					metadata: {},
				}),
		};

		const saver = saveMethods[cap.type];
		if (saver) {
			await saver(cap.title, cap.content, cap.sessionId);
		}
	}

	private shouldCapture(type: string): boolean {
		if (!this.config.enabled) return false;
		if (type === "decision" && this.config.captureDecisions) return true;
		if (type === "bugfix" && this.config.captureBugfixes) return true;
		if (
			["pattern", "discovery", "learning"].includes(type) &&
			this.config.capturePatterns
		)
			return true;
		return false;
	}

	private mapPatternToType(patternName: string, defaultType: string): string {
		const typeMap: Record<string, string> = {
			decision: "decision",
			archDecision: "decision",
			bugfixAdr: "bugfix",
			bugfixAdrWhy: "bugfix",
			bugfixAdrWhere: "bugfix",
			bugfixFixed: "bugfix",
			workaround: "bugfix",
			gotcha: "pattern",
			learned: "learning",
			discovery: "discovery",
			configChange: "config",
		};
		return typeMap[patternName] ?? defaultType;
	}

	private generateTitle(type: string, content: string): string {
		const preview = content.slice(0, 50).replace(/\n/g, " ").trim();
		const suffix = content.length > 50 ? "..." : "";

		const prefixes: Record<string, string> = {
			decision: "Decision:",
			bugfix: "Fix:",
			pattern: "Pattern:",
			discovery: "Found:",
			learning: "Learned:",
			config: "Config:",
		};

		return `${prefixes[type] ?? "Note:"} ${preview}${suffix}`;
	}
}

interface CapturedEntry {
	type: string;
	title: string;
	content: string;
	confidence: number;
	sessionId?: string;
	metadata: Record<string, unknown>;
}
