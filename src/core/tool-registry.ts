import type { ToolDefinition, ToolHandler, ToolCall, ToolResult } from './types.js';

export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();

  register(handler: ToolHandler): void {
    const name = handler.definition.name;
    if (this.handlers.has(name)) {
      throw new Error(`Tool '${name}' already registered`);
    }
    this.handlers.set(name, handler);
  }

  get(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.handlers.values()].map(h => h.definition);
  }

  async execute(calls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of calls) {
      const h = this.handlers.get(call.name);
      if (!h) {
        results.push({
          name: call.name,
          output: `❌ Tool '${call.name}' not found`,
          durationMs: 0,
          error: 'not found',
        });
        continue;
      }
      const start = Date.now();
      try {
        const res = await h.execute(call.arguments);
        results.push({ ...res, durationMs: Date.now() - start });
      } catch (e: any) {
        results.push({
          name: call.name,
          output: `❌ ${e.message ?? e}`,
          durationMs: Date.now() - start,
          error: String(e),
        });
      }
    }
    return results;
  }
}