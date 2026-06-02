/**
 * StreamingService — Manages real-time token output to terminal.
 *
 * Features:
 *   - Toggle streaming on/off
 *   - Buffer tokens for batch display
 *   - Show progress indicator during streaming
 *   - Support for partial word display
 *   - Clear line on completion
 */

import { EventEmitter } from "events";

export interface StreamingConfig {
	enabled: boolean;
	batchSize: number; // Tokens per batch
	batchDelayMs: number; // Delay between batches
	showProgress: boolean; // Show "..." animation
	clearOnComplete: boolean;
}

export const DEFAULT_STREAMING_CONFIG: Required<StreamingConfig> = {
	enabled: true,
	batchSize: 5,
	batchDelayMs: 50,
	showProgress: true,
	clearOnComplete: true,
};

type TokenHandler = (token: string) => void;
type StreamHandler = (text: string) => void;

export class StreamingService {
	private config: Required<StreamingConfig>;
	private enabled: boolean;
	private buffer: string;
	private lastOutput: string;
	private tokenCount: number;
	private isStreaming: boolean;
	private eventEmitter = new EventEmitter();
	private tokenHandlers: TokenHandler[] = [];
	private streamHandlers: StreamHandler[] = [];
	private write: (text: string) => void;

	constructor(
		config: Partial<StreamingConfig> = {},
		writeFn?: (text: string) => void,
	) {
		this.config = { ...DEFAULT_STREAMING_CONFIG, ...config };
		this.enabled = this.config.enabled;
		this.buffer = "";
		this.lastOutput = "";
		this.tokenCount = 0;
		this.isStreaming = false;
		this.write = writeFn ?? this.defaultWrite;
	}

	private defaultWrite(text: string): void {
		process.stdout.write(text);
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	toggle(): boolean {
		this.enabled = !this.enabled;
		return this.enabled;
	}

	/**
	 * Start streaming session.
	 */
	startStream(): void {
		if (!this.enabled) return;
		this.isStreaming = true;
		this.buffer = "";
		this.lastOutput = "";
		this.tokenCount = 0;
		this.eventEmitter.emit("stream:start");
	}

	/**
	 * End streaming session and flush remaining buffer.
	 */
	endStream(): void {
		if (!this.enabled) return;
		this.isStreaming = false;
		if (this.buffer.length > 0) {
			this.write(this.buffer);
			this.lastOutput += this.buffer;
			this.buffer = "";
		}
		if (this.config.clearOnComplete) {
			this.write("\x1b[0m"); // Reset ANSI
		}
		this.eventEmitter.emit("stream:end", { tokenCount: this.tokenCount });
	}

	/**
	 * Write tokens to stream.
	 */
	writeToken(token: string): void {
		if (!this.enabled) {
			// If disabled, collect everything and write at end
			this.buffer += token;
			return;
		}

		this.tokenCount++;
		this.buffer += token;
		this.tokenHandlers.forEach((h) => h(token));
		this.streamHandlers.forEach((h) => h(this.buffer));

		// Batch display
		if (this.buffer.length >= this.config.batchSize) {
			this.flushBuffer();
		}
	}

	/**
	 * Write multiple tokens at once.
	 */
	writeTokens(tokens: string[]): void {
		for (const token of tokens) {
			this.writeToken(token);
		}
	}

	/**
	 * Flush the buffer to output.
	 */
	private flushBuffer(): void {
		if (this.buffer.length === 0) return;
		this.write(this.buffer);
		this.lastOutput += this.buffer;
		this.buffer = "";
	}

	/**
	 * Get the current accumulated text.
	 */
	getOutput(): string {
		return this.lastOutput + this.buffer;
	}

	/**
	 * Get token count.
	 */
	getTokenCount(): number {
		return this.tokenCount;
	}

	/**
	 * Check if currently streaming.
	 */
	isActive(): boolean {
		return this.isStreaming;
	}

	/**
	 * Register a handler for each token.
	 */
	onToken(handler: TokenHandler): void {
		this.tokenHandlers.push(handler);
	}

	/**
	 * Register a handler for each buffer flush.
	 */
	onStream(handler: StreamHandler): void {
		this.streamHandlers.push(handler);
	}

	/**
	 * Listen to streaming events.
	 */
	on(event: string, handler: (...args: any[]) => void): void {
		this.eventEmitter.on(event, handler);
	}

	off(event: string, handler: (...args: any[]) => void): void {
		this.eventEmitter.off(event, handler);
	}

	/**
	 * Process an async generator stream.
	 * Returns the full accumulated text.
	 */
	async processStream<T>(
		generator: AsyncGenerator<string>,
		options: {
			onToken?: (token: string) => void;
			onComplete?: (text: string) => void;
		} = {},
	): Promise<string> {
		this.startStream();

		try {
			for await (const token of generator) {
				this.writeToken(token);
				options.onToken?.(token);
			}
		} finally {
			this.endStream();
		}

		const output = this.getOutput();
		options.onComplete?.(output);
		return output;
	}
}

// Singleton
let streamingService: StreamingService | null = null;

export function getStreamingService(
	writeFn?: (text: string) => void,
): StreamingService {
	if (!streamingService) {
		streamingService = new StreamingService({}, writeFn);
	}
	return streamingService;
}

export function setStreamingEnabled(enabled: boolean): void {
	getStreamingService().setEnabled(enabled);
}

export function isStreamingEnabled(): boolean {
	return getStreamingService().isEnabled();
}
