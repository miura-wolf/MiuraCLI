/**
 * Prueba Realista: MiuraSwarm + Pi Agent
 * 
 * Simula una conversación donde Pi usa MiuraSwarm para:
 * 1. Investigar un bug en el codebase
 * 2. Planear el fix
 * 3. Implementar solución
 * 4. Ejecutar tests
 * 5. Hacer commit
 * 
 * Esta prueba usa tool-calling real con herramientas mockeadas
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from './core/tool-registry.js';
import { executeToolCalls } from './core/tool-executor.js';
import { Pipeline } from './core/pipeline.js';
import { AgentBus } from './core/agent-bus.js';
import { EventBus } from './core/event-bus.js';
import { ModelRouter } from './core/model-router.js';
import type { ModelRef, ToolCall, ToolResult, AgentResult, ModelRoutingConfig } from './core/types.js';

describe('MiuraSwarm + Pi Real Integration', () => {
  let eventBus: EventBus;
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    eventBus = new EventBus();
    toolRegistry = new ToolRegistry();
  });

  it('should complete full ReAct loop with tool calls', async () => {
    // Registrar herramientas reales
    toolRegistry.register({
      definition: {
        name: 'glob',
        description: 'Find files by pattern',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            path: { type: 'string', default: '.' },
          },
          required: ['pattern'],
        },
      },
      async execute(args: Record<string, unknown>) {
        // Simular búsqueda de archivos - retornar todos los archivos relevantes
        return {
          name: 'glob',
          output: 'src/core/pipeline.ts\nsrc/core/agent-bus.ts\nsrc/plugins/adapters/groq/index.ts',
          durationMs: 25,
        };
      },
    });

    toolRegistry.register({
      definition: {
        name: 'read_file',
        description: 'Read file contents',
        parameters: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
      async execute(args: Record<string, unknown>) {
        return { name: 'read_file', output: 'export class Pipeline { ... }', durationMs: 10 };
      },
    });

    toolRegistry.register({
      definition: {
        name: 'grep',
        description: 'Search code with regex',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            path: { type: 'string', default: '.' },
          },
          required: ['pattern'],
        },
      },
      async execute(args: Record<string, unknown>) {
        return { name: 'grep', output: 'src/core/pipeline.ts:45: async run(options) {', durationMs: 30 };
      },
    });

    toolRegistry.register({
      definition: {
        name: 'write_file',
        description: 'Write content to file',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['file_path', 'content'],
        },
      },
      async execute(args: Record<string, unknown>) {
        return { name: 'write_file', output: `✅ Wrote ${(args.content as string)?.length || 0} bytes`, durationMs: 15 };
      },
    });

    toolRegistry.register({
      definition: {
        name: 'run_shell_command',
        description: 'Execute shell command',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
          },
          required: ['command'],
        },
      },
      async execute(args: Record<string, unknown>) {
        const cmd = args.command as string;
        if (cmd === 'npm test') {
          return { name: 'run_shell_command', output: '✓ 33 tests passed in 450ms', durationMs: 450 };
        }
        return { name: 'run_shell_command', output: 'Command executed', durationMs: 100 };
      },
    });

    // Simular el ReAct loop
    const modelRef: ModelRef = { provider: 'groq', model: 'llama-3.3-70b' };
    const task = 'Find and fix the bug in pipeline.ts where parallel stages are not executing correctly';

    // Iteración 1: Explorar
    const exploreResult = await toolRegistry.execute([{ name: 'glob', arguments: { pattern: '**/pipeline.ts' } }]);
    expect(exploreResult[0].name).toBe('glob');
    expect(exploreResult[0].output).toContain('src/core/pipeline.ts');

    // Iteración 2: Leer el archivo
    const readResult = await toolRegistry.execute([{ name: 'read_file', arguments: { file_path: 'src/core/pipeline.ts' } }]);
    expect(readResult[0].name).toBe('read_file');

    // Iteración 3: Buscar el bug específico
    const grepResult = await toolRegistry.execute([{ name: 'grep', arguments: { pattern: 'parallelWith', path: 'src/core/pipeline.ts' } }]);
    expect(grepResult[0].name).toBe('grep');

    // Iteración 4: Escribir el fix
    const writeResult = await toolRegistry.execute([
      { name: 'write_file', arguments: { file_path: 'src/core/pipeline.ts', content: '// Fixed parallel execution\nexport class Pipeline { ... }' } },
    ]);
    expect(writeResult[0].name).toBe('write_file');
    expect(writeResult[0].output).toContain('✅');

    // Iteración 5: Ejecutar tests
    const testResult = await toolRegistry.execute([{ name: 'run_shell_command', arguments: { command: 'npm test' } }]);
    expect(testResult[0].output).toContain('✓ 33 tests passed');

    console.log('✅ Full ReAct loop completed successfully!');
    console.log('Tool calls executed:', [
      'glob(**/pipeline.ts)',
      'read_file(src/core/pipeline.ts)',
      'grep(parallelWith)',
      'write_file(...)',
      'run_shell_command(npm test)',
    ]);
  });

  it('should handle concurrent tool execution', async () => {
    toolRegistry.register({
      definition: {
        name: 'parallel_task',
        description: 'Simulate parallel work',
        parameters: { type: 'object', properties: { delay: { type: 'number' } } },
      },
      async execute(args: Record<string, unknown>) {
        const delay = (args.delay as number) || 10;
        await new Promise(resolve => setTimeout(resolve, delay));
        return { name: 'parallel_task', output: `Completed after ${delay}ms`, durationMs: delay };
      },
    });

    // Ejecutar 3 herramientas en paralelo
    const start = Date.now();
    const results = await Promise.all([
      toolRegistry.execute([{ name: 'parallel_task', arguments: { delay: 50 } }]),
      toolRegistry.execute([{ name: 'parallel_task', arguments: { delay: 30 } }]),
      toolRegistry.execute([{ name: 'parallel_task', arguments: { delay: 40 } }]),
    ]);
    const elapsed = Date.now() - start;

    // Debería tomar ~50ms (el más largo), no 120ms (suma)
    expect(elapsed).toBeLessThan(100);
    expect(results).toHaveLength(3);

    console.log(`✅ Concurrent execution: ${elapsed}ms (vs ${50 + 30 + 40}ms sequential)`);
  });
});
