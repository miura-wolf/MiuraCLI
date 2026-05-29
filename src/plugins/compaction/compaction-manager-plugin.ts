import { Plugin, PluginType } from '../../core/plugin-host.js';
import type { PluginHostAPI } from '../../core/types.js';
import { CompactionManager } from './compaction-manager.js';
import { CompactionObserver, CompactionLogger } from './compaction-observer.js';

export class CompactionManagerPlugin implements Plugin {
  name = 'compaction-manager';
  type = 'knowledge' as const;
  manifest = {
    id: 'compaction-manager',
    name: 'CompactionManager',
    version: '1.0.0',
    type: 'knowledge' as const,
    capabilities: ['compaction', 'session-management'],
  };
  
  private compactionManager: CompactionManager;
  private observer: CompactionObserver;
  private logger: CompactionLogger;

  constructor() {
    this.compactionManager = new CompactionManager();
    this.observer = new CompactionObserver();
    this.logger = new CompactionLogger();
  }

  async initialize(host: PluginHostAPI): Promise<void> {
    // Register CLI commands
    const commandRegistry = host.getCommandRegistry?.() as any;
    if (commandRegistry?.register) {
      commandRegistry.register({
        name: 'compaction',
        aliases: ['compact'],
        description: 'Manage compaction strategies for long conversations',
        usage: '/compaction [list|set|config|stats|help]',
        execute: this.handleCompactionCommand.bind(this),
      });
    }

    // Register tools
    const toolRegistry = host.getToolRegistry();
    toolRegistry.register({
      definition: {
        name: 'compaction_strategies',
        description: 'List available compaction strategies',
        parameters: {},
      },
      execute: async () => {
        const strategies = await this.listStrategiesTool();
        return { name: 'compaction_strategies', output: JSON.stringify(strategies), durationMs: 0 };
      },
    });

    toolRegistry.register({
      definition: {
        name: 'set_compaction_strategy',
        description: 'Set the current compaction strategy',
        parameters: {
          strategy: {
            type: 'string',
            description: 'Name of the strategy to use',
            enum: ['no_compaction', 'sliding_window', 'summarize', 'hybrid', 'safe_split_point']
          },
          options: {
            type: 'object',
            description: 'Strategy-specific options',
            properties: {
              windowSize: { type: 'number', description: 'Number of messages to keep (sliding_window)' },
              thresholdMessages: { type: 'number', description: 'Threshold for summarization (summarize)' },
              keepMessages: { type: 'number', description: 'Number of messages to keep (hybrid)' },
              preserveSystem: { type: 'boolean', description: 'Preserve system messages' }
            }
          }
        }
      },
      execute: async (args: Record<string, unknown>) => {
        const result = await this.setStrategyTool(args);
        return { name: 'set_compaction_strategy', output: JSON.stringify(result), durationMs: 0 };
      }
    });

    toolRegistry.register({
      definition: {
        name: 'get_compaction_stats',
        description: 'Get compaction statistics and metrics',
        parameters: {},
      },
      execute: async () => {
        const result = await this.getStatsTool();
        return { name: 'get_compaction_stats', output: JSON.stringify(result), durationMs: 0 };
      }
    });

    console.log(`[CompactionManager] Plugin activated with strategies: ${this.compactionManager.getAvailableStrategies().join(', ')}`);
  }

  async deactivate(): Promise<void> {
    console.log('[CompactionManager] Plugin deactivated');
  }

  private handleCompactionCommand(ctx: any): Promise<string> {
    const [action, ...args] = ctx.args;
    
    switch (action) {
      case 'list':
        return Promise.resolve(this.listStrategies());
      case 'set':
        return this.setStrategyCLI(args[0], args[1]);
      case 'config':
        return Promise.resolve(this.showConfig(args[0]));
      case 'stats':
        return Promise.resolve(this.showDetailedStats());
      case 'help':
        return Promise.resolve(this.showHelp());
      default:
        return Promise.resolve(this.showHelp());
    }
  }

  private listStrategies(): string {
    const strategies = this.compactionManager.getAvailableStrategies();
    let result = 'Available compaction strategies:\n\n';
    
    strategies.forEach(name => {
      result += `  ${name}:\n    ${this.compactionManager.describeStrategy(name)}\n`;
    });
    
    result += '\nCurrent strategy: ' + this.getCurrentStrategy();
    return result;
  }

  private async setStrategyCLI(strategyName: string, options?: string): Promise<string> {
    try {
      let parsedOptions;
      
      if (options) {
        try {
          parsedOptions = JSON.parse(options);
        } catch (e) {
          return `Error: Invalid JSON options: ${options}`;
        }
      }
      
      this.compactionManager.setStrategy(strategyName, parsedOptions);
      
      return `✅ Compaction strategy set to: ${strategyName}${parsedOptions ? ' with options: ' + JSON.stringify(parsedOptions) : ''}`;
    } catch (error) {
      return `❌ Error setting strategy: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private showConfig(strategyName?: string): string {
    if (!strategyName) {
      const current = this.getCurrentStrategy();
      return `Current configuration:\n\nStrategy: ${current}\nOptions: ${JSON.stringify(this.compactionManager.getStrategyConfig(current), null, 2)}`;
    }
    
    const config = this.compactionManager.getStrategyConfig(strategyName);
    if (!config) {
      return `❌ Strategy not found: ${strategyName}`;
    }
    
    return `${strategyName} configuration:\n${JSON.stringify(config, null, 2)}`;
  }

  private showDetailedStats(): string {
    const report = this.observer.getPerformanceReport();
    
    let result = '🔍 Compaction Performance Report\n';
    result += '='.repeat(50) + '\n\n';
    
    // Overall metrics
    result += `📊 Overall Statistics:\n`;
    result += `  Total Compactions: ${report.totalCompactions}\n`;
    result += `  Average Time: ${report.avgTimeMs.toFixed(0)}ms\n`;
    result += `  Compression Ratio: ${report.compressionRatio.toFixed(2)}\n`;
    result += `  Context Window Usage: ${report.contextWindowUsage.toFixed(1)}%\n\n`;
    
    // Strategy performance
    result += `🎯 Strategy Performance:\n`;
    report.strategyPerformance.forEach(strategy => {
      const emoji = strategy.avgTimeMs < 1000 ? '⚡' : strategy.avgTimeMs < 2000 ? '🐌' : '🐢';
      result += `  ${emoji} ${strategy.strategy}:\n`;
      result += `    Compactions: ${strategy.totalCompactions}\n`;
      result += `    Avg Time: ${strategy.avgTimeMs.toFixed(0)}ms\n`;
      result += `    Min/Max: ${strategy.minTimeMs}ms/${strategy.maxTimeMs}ms\n`;
      result += `    Tokens Saved: ${strategy.totalTokensSaved}\n`;
    });
    
    // Recent performance
    if (report.recentPerformance.length > 0) {
      result += `\n🕐 Recent Activity (last ${Math.min(5, report.recentPerformance.length)}):\n`;
      report.recentPerformance.slice(0, 5).forEach((entry, index) => {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        result += `  ${index + 1}. ${time} - ${entry.strategy}: ${entry.timeMs}ms (${entry.compressionRatio.toFixed(2)} ratio)\n`;
      });
    }
    
    // Recommendations
    if (report.recommendations.length > 0) {
      result += `\n💡 Recommendations:\n`;
      report.recommendations.forEach(rec => {
        result += `  ${rec}\n`;
      });
    }
    
    return result;
  }

  private showHelp(): string {
    return `Compaction Manager Commands:

  /compaction list              - List available strategies
  /compaction set <strategy> [options] - Set compaction strategy
  /compaction config [strategy] - Show strategy configuration
  /compaction stats             - Show compaction statistics
  /compaction help              - Show this help

Examples:
  /compaction set sliding_window
  /compaction set hybrid {"keepMessages": 25}
  /compaction config sliding_window
  /compaction stats`;
  }

  // Tool implementations
  private listStrategiesTool(): Promise<Record<string, string>> {
    const strategies = this.compactionManager.getAvailableStrategies();
    const result: Record<string, string> = {};
    
    strategies.forEach(name => {
      result[name] = this.compactionManager.describeStrategy(name);
    });
    
    return Promise.resolve(result);
  }

  private async setStrategyTool(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const strategyName = args.strategy as string;
    const options = args.options as Record<string, unknown>;
    
    try {
      this.compactionManager.setStrategy(strategyName, options);
      
      return {
        success: true,
        message: `Strategy set to: ${strategyName}`,
        strategy: strategyName,
        options: options
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private getStatsTool(): Promise<Record<string, unknown>> {
    const report = this.observer.getPerformanceReport();
    const metrics = this.observer.getMetrics();
    
    return Promise.resolve({
      metrics,
      performanceReport: report,
      currentStrategy: this.getCurrentStrategy(),
      timestamp: new Date().toISOString(),
      logs: this.logger.getLogs().slice(0, 10) // Last 10 logs
    });
  }

  private getCurrentStrategy(): string {
    // This would normally track the current strategy from session manager
    // For now, return the default
    return 'no_compaction';
  }
}