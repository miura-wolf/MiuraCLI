import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CompactionManagerPlugin } from './compaction-manager-plugin.js';

describe('CompactionManagerPlugin', () => {
  let plugin: CompactionManagerPlugin;
  let mockHost: any;
  let mockCommandRegistry: any;
  let mockToolRegistry: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    plugin = new CompactionManagerPlugin();
    
    mockHost = {
      getCommandRegistry: vi.fn(),
      getToolRegistry: vi.fn()
    };
    
    mockCommandRegistry = {
      register: vi.fn()
    };
    
    mockToolRegistry = {
      register: vi.fn()
    };
    
    mockHost.getCommandRegistry.mockReturnValue(mockCommandRegistry);
    mockHost.getToolRegistry.mockReturnValue(mockToolRegistry);
  });

  describe('Plugin Lifecycle', () => {
    it('should activate successfully (tools only; command registration is deferred)', async () => {
      await plugin.initialize(mockHost);

      // Tools still register in initialize() — the command registration
      // moved to registerCommands() because the CLI's CommandRegistry
      // doesn't exist until after miura.initialize() returns.
      expect(mockHost.getToolRegistry).toHaveBeenCalled();
      expect(mockToolRegistry.register).toHaveBeenCalledTimes(3);
      const toolNames = mockToolRegistry.register.mock.calls.map(
        (c: any[]) => c[0].definition?.name ?? c[0].name,
      );
      expect(toolNames).toContain('compaction_strategies');
      expect(toolNames).toContain('set_compaction_strategy');
      expect(toolNames).toContain('get_compaction_stats');
    });

    it('should NOT touch the command registry during initialize()', async () => {
      await plugin.initialize(mockHost);
      // The command registry doesn't exist yet during initialize();
      // a stray call would be a regression to the pre-fix bug.
      expect(mockHost.getCommandRegistry).not.toHaveBeenCalled();
      expect(mockCommandRegistry.register).not.toHaveBeenCalled();
    });

    it('should deactivate successfully', async () => {
      await plugin.initialize(mockHost);
      await plugin.deactivate();
    });
  });

  describe('registerCommands (late-bind)', () => {
    it('registers the /compaction command with /compact alias', () => {
      plugin.registerCommands(mockCommandRegistry);
      expect(mockCommandRegistry.register).toHaveBeenCalledOnce();
      const cmd = mockCommandRegistry.register.mock.calls[0][0];
      expect(cmd.name).toBe('compaction');
      expect(cmd.aliases).toContain('compact');
      expect(cmd.description).toContain('Manage compaction strategies');
      expect(typeof cmd.handler).toBe('function');
    });

    it('the registered handler routes subcommands to the right methods', async () => {
      plugin.registerCommands(mockCommandRegistry);
      const handler = mockCommandRegistry.register.mock.calls[0][0].handler;
      // help
      const helpOut = await handler({}, '');
      expect(helpOut).toMatchObject({ type: 'text' });
      expect((helpOut as any).output).toContain('Compaction Manager Commands');
      // list
      const listOut = await handler({}, 'list');
      expect((listOut as any).output).toContain('Available compaction strategies');
      // set (valid)
      const setOut = await handler({}, 'set sliding_window');
      expect((setOut as any).output).toContain('Compaction strategy set to: sliding_window');
      // config (specific)
      const cfgOut = await handler({}, 'config sliding_window');
      expect((cfgOut as any).output).toContain('sliding_window configuration');
    });

    it('is idempotent — multiple calls register the same command name', () => {
      plugin.registerCommands(mockCommandRegistry);
      plugin.registerCommands(mockCommandRegistry);
      // Both calls register, but the CommandRegistry uses .set() under
      // the hood, so the second call simply overwrites the first.
      // (Documented behaviour, not an error.)
      expect(mockCommandRegistry.register).toHaveBeenCalledTimes(2);
    });
  });

  describe('CLI Commands', () => {
    beforeEach(async () => {
      await plugin.initialize(mockHost);
    });

    describe('list command', () => {
      it('should list available strategies', async () => {
        const result = await plugin['handleCompactionCommand']({ args: ['list'] });
        
        expect(result).toContain('Available compaction strategies');
        expect(result).toContain('no_compaction');
        expect(result).toContain('sliding_window');
        expect(result).toContain('summarize');
        expect(result).toContain('hybrid');
        expect(result).toContain('safe_split_point');
      });
    });

    describe('set command', () => {
      it('should set strategy successfully', async () => {
        const result = await plugin['handleCompactionCommand']({ args: ['set', 'sliding_window'] });
        expect(result).toContain('Compaction strategy set to: sliding_window');
      });

      it('should handle invalid JSON options', async () => {
        const result = await plugin['handleCompactionCommand']({ args: ['set', 'hybrid', 'invalid-json'] });
        expect(result).toContain('Invalid JSON options');
      });

      it('should handle unknown strategy', async () => {
        const result = await plugin['handleCompactionCommand']({ args: ['set', 'unknown_strategy'] });
        expect(result).toContain('Error setting strategy');
      });
    });

    describe('config command', () => {
      it('should show current configuration', async () => {
        const result = await plugin['handleCompactionCommand']({ args: ['config'] });
        expect(result).toContain('Current configuration');
        expect(result).toContain('Strategy:');
      });

      it('should show specific strategy configuration', async () => {
        const result = await plugin['handleCompactionCommand']({ args: ['config', 'sliding_window'] });
        expect(result).toContain('sliding_window configuration');
      });

      it('should handle unknown strategy for config', async () => {
        const result = await plugin['handleCompactionCommand']({ args: ['config', 'unknown_strategy'] });
        expect(result).toContain('Strategy not found');
      });
    });

    describe('stats command', () => {
      it('should show compaction statistics', async () => {
        const result = await plugin['handleCompactionCommand']({ args: ['stats'] });
        
        expect(result).toContain('Compaction Performance Report');
        expect(result).toContain('Overall Statistics');
        expect(result).toContain('Strategy Performance');
      });
    });

    describe('help command', () => {
      it('should show help information', async () => {
        const result = await plugin['handleCompactionCommand']({ args: ['help'] });
        
        expect(result).toContain('Compaction Manager Commands');
        expect(result).toContain('/compaction list');
        expect(result).toContain('/compaction set');
        expect(result).toContain('/compaction config');
        expect(result).toContain('/compaction stats');
      });
    });
  });

  describe('Tool Implementations', () => {
    beforeEach(async () => {
      await plugin.initialize(mockHost);
    });

    describe('listStrategiesTool', () => {
      it('should return list of strategies', async () => {
        const result = await plugin['listStrategiesTool']();
        
        expect(result).toHaveProperty('no_compaction');
        expect(result).toHaveProperty('sliding_window');
        expect(result).toHaveProperty('summarize');
        expect(result).toHaveProperty('hybrid');
        expect(result).toHaveProperty('safe_split_point');
      });
    });

    describe('setStrategyTool', () => {
      it('should set strategy successfully', async () => {
        const args = { strategy: 'sliding_window', options: { windowSize: 25 } };
        const result = await plugin['setStrategyTool'](args);
        
        expect(result.success).toBe(true);
        expect(result.strategy).toBe('sliding_window');
      });

      it('should handle strategy setting error', async () => {
        const args = { strategy: 'unknown_strategy' };
        const result = await plugin['setStrategyTool'](args);
        
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('getStatsTool', () => {
      it('should return statistics', async () => {
        const result = await plugin['getStatsTool']();
        
        expect(result).toHaveProperty('metrics');
        expect(result).toHaveProperty('performanceReport');
        expect(result).toHaveProperty('currentStrategy');
        expect(result).toHaveProperty('timestamp');
      });
    });
  });
});