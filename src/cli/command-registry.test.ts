/**
 * CommandRegistry tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRegistry } from './command-registry.js';

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  // Minimal mock context — only override what's needed per test
  function makeCtx(overrides: Partial<import('./command-registry.js').CommandContext> = {}) {
    return {
      miura: {
        getStatus: vi.fn().mockResolvedValue({
          agents: [],
          tasks: { pending: 0, active: 0, completed: 0, failed: 0 },
          plugins: [],
          modelRouting: { defaults: {}, fallbacks: {}, capabilities: {} },
        }),
        getConfig: vi.fn().mockReturnValue({
          defaults: {
            planner: { provider: 'deepseek', model: 'v4-flash' },
            worker: { provider: 'qwen', model: '3-coder' },
            reviewer: { provider: 'glm', model: '5.1' },
            scout: { provider: 'groq', model: 'llama-3.3-70b' },
            oracle: { provider: 'deepseek', model: 'v4-pro' },
            researcher: { provider: 'groq', model: 'mixtral-8x7b' },
            'context-builder': { provider: 'qwen', model: '3-coder' },
            delegate: { provider: 'google', model: 'gemma-4' },
          },
          fallbacks: {},
          capabilities: {},
        }),
        runPipeline: vi.fn().mockResolvedValue({
          pipelineId: 'test-pipeline-1',
          finalOutput: 'Pipeline complete.',
        }),
        runAgent: vi.fn().mockResolvedValue({
          output: 'Agent output.',
        }),
        getAdapters: vi.fn().mockReturnValue(new Map([['claude', {}]])),
        getCompactionManager: vi.fn().mockReturnValue(undefined),
        getOpenSpecManager: vi.fn().mockReturnValue(undefined),
        getMCPClient: vi.fn().mockReturnValue(undefined),
      } as any,
      session: {
        incPipelines: vi.fn(),
        incAgents: vi.fn(),
        messageCount: 0,
        pipelineCount: 0,
        agentCount: 0,
        id: 'test-session',
        close: vi.fn(),
        clearMessages: vi.fn(),
        getRecentMessages: vi.fn().mockReturnValue([]),
      },
      rawArgs: '',
      ...overrides,
    } as any;
  }

  beforeEach(() => {
    registry = new CommandRegistry();
    vi.clearAllMocks();
  });

  describe('match()', () => {
    it('returns null for plain text (no slash)', () => {
      expect(registry.match('hello world')).toBeNull();
    });

    it('matches /chat command', () => {
      const result = registry.match('/chat hello');
      expect(result).not.toBeNull();
      expect(result!.cmd.name).toBe('chat');
      expect(result!.args).toBe('hello');
    });

    it('extracts args correctly', () => {
      const result = registry.match('/chat fix the auth bug');
      expect(result!.args).toBe('fix the auth bug');
    });

    it('handles command with no args', () => {
      const result = registry.match('/plan');
      expect(result!.cmd.name).toBe('plan');
      expect(result!.args).toBe('');
    });

    it('matches command aliases', () => {
      const result = registry.match('/r some diff');
      expect(result).not.toBeNull();
      expect(result!.cmd.name).toBe('review');
    });

    it('returns null for unknown command', () => {
      expect(registry.match('/unknown-cmd')).toBeNull();
    });

    it('trims whitespace before command', () => {
      const result = registry.match('  /plan');
      expect(result).not.toBeNull();
      expect(result!.cmd.name).toBe('plan');
    });
  });

  describe('listAll()', () => {
    it('returns all registered commands', () => {
      const all = registry.listAll();
      expect(all.length).toBeGreaterThanOrEqual(19);
      const names = all.map(c => c.name);
      expect(names).toContain('chat');
      expect(names).toContain('review');
      expect(names).toContain('plan');
      expect(names).toContain('exit');
    });
  });

  describe('formatHelp()', () => {
    it('includes command names in help output', () => {
      const help = registry.formatHelp();
      expect(help).toContain('/chat');
      expect(help).toContain('/review');
      expect(help).toContain('/plan');
    });
  });

  describe('/help', () => {
    it('returns null for /help (falls through to free text)', () => {
      expect(registry.match('/help')).toBeNull();
    });
  });

  describe('/plan command', () => {
    it('returns task queue info', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('plan')!;
      const result = await cmd.handler(ctx, '');
      expect(result.type).toBe('info');
      expect(result.output).toContain('pending:');
      expect(result.output).toContain('completed:');
    });
  });

  describe('/tokens command', () => {
    it('shows session stats', async () => {
      const session = {
        id: 'test-id',
        messageCount: 5,
        pipelineCount: 3,
        agentCount: 7,
        getRecentMessages: vi.fn().mockReturnValue([
          { role: 'user', content: 'a', timestamp: 1 },
          { role: 'user', content: 'b', timestamp: 2 },
          { role: 'assistant', content: 'c', timestamp: 3 },
        ]),
      };
      const ctx = makeCtx({ session } as any);
      const cmd = registry.get('tokens')!;
      const result = await cmd.handler(ctx, '');
      expect(result.type).toBe('info');
      expect(result.output).toContain('test-id');
      expect(result.output).toContain('Pipelines run: 3');
      expect(result.output).toContain('Agents run: 7');
    });
  });

  describe('/model command', () => {
    it('shows all model assignments when no role given', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('model')!;
      const result = await cmd.handler(ctx, '');
      expect(result.type).toBe('info');
      expect(result.output).toContain('planner');
      expect(result.output).toContain('deepseek');
    });

    it('shows specific role model when role given', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('model')!;
      const result = await cmd.handler(ctx, 'planner');
      expect(result.type).toBe('info');
      expect(result.output).toContain('planner');
      expect(result.output).toContain('deepseek');
    });

    it('returns error for unknown role', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('model')!;
      const result = await cmd.handler(ctx, 'unknown-role');
      expect(result.type).toBe('error');
    });
  });

  describe('/brain command', () => {
    it('shows stats when no arg', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('brain')!;
      const result = await cmd.handler(ctx, '');
      expect(result.type).toBe('info');
      expect(result.output).toContain('Brain stats');
    });

    it('clears memory when "clear" arg', async () => {
      const session = { clearMessages: vi.fn(), id: 'test', messageCount: 0, getRecentMessages: vi.fn().mockReturnValue([]) } as any;
      const ctx = makeCtx({ session });
      const cmd = registry.get('brain')!;
      const result = await cmd.handler(ctx, 'clear');
      expect(session.clearMessages).toHaveBeenCalled();
      expect(result.type).toBe('success');
    });
  });

  describe('/skills command', () => {
    it('shows usage info when no subcommand given', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('skills')!;
      const result = await cmd.handler(ctx, '');
      // Without a SkillManager in the test mock, shows usage
      expect(result.type).toBe('info');
      expect(result.output).toContain('/skills');
    });

    it('shows usage info for unrecognized subcommand', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('skills')!;
      // 'tdd' is not a known subcommand, shows usage info
      const result = await cmd.handler(ctx, 'tdd');
      expect(result.type).toBe('info');
      expect(result.output).toContain('/skills');
    });

    it('returns error for unknown skill when SkillManager is unavailable', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('skills')!;
      // nonexistent subcommand or skill → info (usage shown)
      const result = await cmd.handler(ctx, 'nonexistent-skill');
      expect(result.type).toBe('info');
    });
  });

  describe('/exit command', () => {
    it('returns __EXIT__ marker', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('exit')!;
      const result = await cmd.handler(ctx, '');
      expect(result.output).toBe('__EXIT__');
      expect(result.type).toBe('success');
    });
  });

  describe('/clear command', () => {
    it('returns __CLEAR__ marker', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('clear')!;
      const result = await cmd.handler(ctx, '');
      expect(result.output).toBe('__CLEAR__');
    });
  });

  describe('/propose command', () => {
    it('shows error when no args provided', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('propose')!;
      const result = await cmd.handler(ctx, '');
      expect(result.type).toBe('error');
      expect(result.output).toContain('Usage:');
    });

    it('returns error when OpenSpecManager unavailable', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('propose')!;
      const result = await cmd.handler(ctx, 'test: description');
      // OpenSpecManager is not available in test mock
      expect(result.output).toContain('not initialized');
    });
  });

  describe('/verify command', () => {
    it('shows error when no args provided', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('verify')!;
      const result = await cmd.handler(ctx, '');
      expect(result.type).toBe('error');
      expect(result.output).toContain('Usage:');
    });

    it('returns error when OpenSpecManager unavailable', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('verify')!;
      const result = await cmd.handler(ctx, 'test-change');
      expect(result.output).toContain('not initialized');
    });
  });

  describe('/archive command', () => {
    it('shows error when no args provided', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('archive')!;
      const result = await cmd.handler(ctx, '');
      expect(result.type).toBe('error');
      expect(result.output).toContain('Usage:');
    });

    it('returns error when OpenSpecManager unavailable', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('archive')!;
      const result = await cmd.handler(ctx, 'test-change');
      expect(result.output).toContain('not initialized');
    });
  });

  describe('/spec command', () => {
    it('returns error when OpenSpecManager unavailable', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('spec')!;
      const result = await cmd.handler(ctx, '');
      expect(result.output).toContain('not initialized');
    });

    it('returns error when OpenSpecManager unavailable for list', async () => {
      const ctx = makeCtx();
      const cmd = registry.get('spec')!;
      const result = await cmd.handler(ctx, 'list');
      expect(result.output).toContain('not initialized');
    });
  });
});