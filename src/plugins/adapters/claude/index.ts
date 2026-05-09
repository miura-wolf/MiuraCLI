import type {
  LLMAdapter,
  LLMMessage,
  LLMOptions,
  LLMResult,
  ModelRef,
  Plugin,
  PluginHostAPI,
} from '../../../core/types.js';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export class ClaudeAdapter implements LLMAdapter {
  manifest = {
    id: 'adapter-claude',
    name: 'Claude Code Adapter',
    version: '0.1.0',
    type: 'adapter' as const,
    capabilities: ['code', 'plan', 'review', 'decision', 'context', 'tool_use', 'streaming', 'delegate', 'scout', 'research'],
    dependencies: [] as string[],
  };

  private host: PluginHostAPI | null = null;
  private processMap = new Map<string, { process: ReturnType<typeof spawn>; output: string; error: string }>();

  async initialize(host: PluginHostAPI): Promise<void> {
    this.host = host;
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async unload(): Promise<void> {
    // Kill all running processes
    for (const [id, entry] of this.processMap) {
      entry.process.kill();
      this.processMap.delete(id);
    }
  }

  supports(model: ModelRef): boolean {
    return model.provider === 'claude';
  }

  async prompt(model: ModelRef, messages: LLMMessage[], options: LLMOptions): Promise<LLMResult> {
    const startTime = Date.now();

    // Build the prompt from messages
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMessages = messages.filter((m) => m.role !== 'system');

    const prompt = userMessages.map((m) => m.content).join('\n\n');

    // Build claude CLI arguments
    const args: string[] = [
      '--print',           // Non-interactive mode
      '--model', this.resolveModelName(model.model),
    ];

    if (options.maxTokens) {
      args.push('--max-tokens', String(options.maxTokens));
    }

    // Execute claude CLI
    const output = await this.executeClaude(args, prompt, options);

    return {
      output,
      tokenUsage: {
        prompt: this.estimateTokens(prompt),
        completion: this.estimateTokens(output),
      },
      model: model.model,
      durationMs: Date.now() - startTime,
    };
  }

  async *stream(model: ModelRef, messages: LLMMessage[], options: LLMOptions): AsyncGenerator<string> {
    const userMessages = messages.filter((m) => m.role !== 'system');
    const prompt = userMessages.map((m) => m.content).join('\n\n');

    const args: string[] = [
      '--print',
      '--model', this.resolveModelName(model.model),
      '--stream',          // Stream output
    ];

    if (options.maxTokens) {
      args.push('--max-tokens', String(options.maxTokens));
    }

    const processId = randomUUID();
    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.processMap.set(processId, { process: child, output: '', error: '' });

    // Write prompt to stdin
    child.stdin.write(prompt);
    child.stdin.end();

    // Yield chunks from stdout
    let buffer = '';
    for await (const chunk of child.stdout) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) yield line;
      }
    }

    // Cleanup
    this.processMap.delete(processId);
  }

  private executeClaude(args: string[], prompt: string, _options: LLMOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const processId = randomUUID();

      const child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      let error = '';

      child.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        error += data.toString();
      });

      // Write prompt to stdin
      child.stdin.write(prompt);
      child.stdin.end();

      this.processMap.set(processId, { process: child, output, error });

      child.on('close', (code) => {
        this.processMap.delete(processId);

        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Claude CLI exited with code ${code}: ${error.trim()}`));
        }
      });

      child.on('error', (err) => {
        this.processMap.delete(processId);
        reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
      });
    });
  }

  private resolveModelName(model: string): string {
    const modelMap: Record<string, string> = {
      'opus': 'claude-opus-4-20250514',
      'sonnet': 'claude-sonnet-4-20250514',
      'haiku': 'claude-haiku-3-5-20241022',
    };
    return modelMap[model] ?? model;
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 chars per token for English
    return Math.ceil(text.length / 4);
  }
}
