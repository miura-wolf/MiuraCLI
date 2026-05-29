import { 
  LLMMessage, 
  CompactionStrategy, 
  CompactionResult, 
  CompactionOptions,
  CompactionConfig 
} from '../../core/types.js';

/**
 * Base class for all compaction strategies
 */
export abstract class BaseCompactionStrategy implements CompactionStrategy {
  abstract compact(
    messages: LLMMessage[], 
    contextWindow: number, 
    options?: CompactionOptions
  ): CompactionResult;

  protected createResult(
    compactedMessages: LLMMessage[],
    removedMessages: LLMMessage[],
    strategyUsed: string,
    originalCount: number = compactedMessages.length + removedMessages.length
  ): CompactionResult {
    return {
      compactedMessages,
      removedMessages,
      stats: {
        originalCount,
        compactedCount: compactedMessages.length,
        removedCount: removedMessages.length,
        compressionRatio: compactedMessages.length / originalCount,
        strategyUsed,
        timestamp: new Date().toISOString()
      }
    };
  }

  protected filterMessages(messages: LLMMessage[], preserveSystem: boolean = true): LLMMessage[] {
    if (!preserveSystem) return messages;
    
    return messages.filter(msg => 
      msg.role !== 'system' || 
      msg.content?.includes('system_prompt')
    );
  }

  protected estimateTokens(message: LLMMessage): number {
    // Simple estimation: 4 tokens per word
    const words = message.content?.split(/\s+/).length || 0;
    return words * 4;
  }

  protected estimateTotalTokens(messages: LLMMessage[]): number {
    return messages.reduce((total, msg) => total + this.estimateTokens(msg), 0);
  }
}

/**
 * No compaction strategy - keeps all messages
 */
export class NoCompaction extends BaseCompactionStrategy {
  compact(messages: LLMMessage[], contextWindow: number, options?: CompactionOptions): CompactionResult {
    return this.createResult(messages, [], 'no_compaction');
  }
}

/**
 * Sliding window strategy - keeps the last N messages
 */
export class SlidingWindow extends BaseCompactionStrategy {
  constructor(
    private windowSize: number = 50,
    private preserveSystem: boolean = true
  ) {
    super();
  }

  compact(messages: LLMMessage[], contextWindow: number, options?: CompactionOptions): CompactionResult {
    const filtered = this.filterMessages(messages, this.preserveSystem);
    
    if (filtered.length <= this.windowSize) {
      return this.createResult(filtered, [], 'sliding_window');
    }

    // Keep the last N messages
    const preserved = filtered.slice(-this.windowSize);
    const removed = filtered.slice(0, filtered.length - this.windowSize);
    
    return this.createResult(preserved, removed, 'sliding_window');
  }
}

/**
 * Summarize strategy - summarizes older messages
 */
export class Summarize extends BaseCompactionStrategy {
  constructor(
    private thresholdMessages: number = 20,
    private preserveSystem: boolean = true
  ) {
    super();
  }

  compact(
    messages: LLMMessage[], 
    contextWindow: number, 
    options?: CompactionOptions
  ): CompactionResult {
    const filtered = this.filterMessages(messages, this.preserveSystem);
    
    if (filtered.length <= this.thresholdMessages) {
      return this.createResult(filtered, [], 'summarize', filtered.length);
    }

    const messagesToSummarize = filtered.slice(0, filtered.length - 5);
    const preserved = filtered.slice(-5);
    
    const summary = this.generateInlineSummary(messagesToSummarize);
    const summarizedMessage: LLMMessage = {
      role: 'assistant',
      content: `SUMMARY OF PREVIOUS CONVERSATION:\n${summary}\n\nCurrent context continues from here.`,
      timestamp: new Date().toISOString()
    };

    const compacted = [summarizedMessage, ...preserved];
    return this.createResult(compacted, messagesToSummarize, 'summarize', filtered.length);
  }

  private generateInlineSummary(messages: LLMMessage[]): string {
    // Simple summary based on statistics
    const turns = Math.floor(messages.length / 2);
    const userMessages = messages.filter(m => m.role === 'user').length;
    const assistantMessages = messages.filter(m => m.role === 'assistant').length;
    
    const topics = this.extractTopics(messages);
    
    return `Conversation with ${turns} turns (${userMessages} user messages, ${assistantMessages} assistant messages) covering: ${topics.join(', ') || 'various technical topics'}.`;
  }

  private extractTopics(messages: LLMMessage[]): string[] {
    // Simple topic extraction from message content
    const keywords = ['code', 'bug', 'fix', 'implement', 'debug', 'test', 'build', 'deploy', 'api', 'database', 'frontend', 'backend'];
    const found: string[] = [];
    
    messages.forEach(msg => {
      if (msg.content) {
        keywords.forEach(keyword => {
          if (msg.content!.toLowerCase().includes(keyword)) {
            found.push(keyword);
          }
        });
      }
    });
    
    // Remove duplicates and limit to 5 topics
    return [...new Set(found)].slice(0, 5);
  }
}

/**
 * Safe split point strategy - never splits tool_use + tool_result pairs
 */
export class SafeSplitPoint extends BaseCompactionStrategy {
  constructor(private inner: CompactionStrategy) {
    super();
  }

  compact(messages: LLMMessage[], contextWindow: number, options?: CompactionOptions): CompactionResult {
    // Find safe split points (don't split tool_use + tool_result)
    const safePoints = this.findSafeSplitPoints(messages);
    
    if (safePoints.length === 0) {
      // No safe points found, use inner strategy
      return this.inner.compact(messages, contextWindow, options);
    }

    // Split at the most recent safe point
    const splitPoint = safePoints[safePoints.length - 1];
    const firstPart = messages.slice(0, splitPoint);
    const secondPart = messages.slice(splitPoint);
    
    // Compact the first part
    const compactedFirst = this.inner.compact(firstPart, contextWindow, options);
    
    return {
      compactedMessages: [...compactedFirst.compactedMessages, ...secondPart],
      removedMessages: compactedFirst.removedMessages,
      stats: {
        ...compactedFirst.stats,
        strategyUsed: `safe_split_point_${compactedFirst.stats.strategyUsed}`
      }
    };
  }

  private findSafeSplitPoints(messages: LLMMessage[]): number[] {
    const points: number[] = [];
    
    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1];
      const current = messages[i];
      
      // Don't split tool_use followed by tool_result
      if (prev.role === 'tool_use' && current.role === 'tool_result') {
        continue;
      }
      
      // Split after complete assistant responses
      if (current.role === 'assistant' && 
          current.content?.includes('```')) {
        points.push(i);
      }
    }
    
    return points;
  }
}

/**
 * Hybrid strategy - combines sliding window and summarize
 */
export class Hybrid extends BaseCompactionStrategy {
  constructor(
    private keepMessages: number = 30,
    private preserveSystem: boolean = true,
    private useSummarizeForOlder: boolean = true
  ) {
    super();
  }

  compact(messages: LLMMessage[], contextWindow: number, options?: CompactionOptions): CompactionResult {
    const filtered = this.filterMessages(messages, this.preserveSystem);
    
    if (filtered.length <= this.keepMessages) {
      return this.createResult(filtered, [], 'hybrid');
    }

    const recent = filtered.slice(-this.keepMessages);
    const older = filtered.slice(0, filtered.length - this.keepMessages);
    
    let compactedOlder: LLMMessage[];
    
    if (this.useSummarizeForOlder && older.length > 10) {
      // Use summarize for the older part
      const summarizeStrategy = new Summarize(15);
      const olderResult = summarizeStrategy.compact(older, contextWindow, options);
      compactedOlder = olderResult.compactedMessages;
    } else {
      // Use simple sliding window for older part
      compactedOlder = older.slice(-Math.floor(older.length * 0.3));
    }

    const compacted = [...compactedOlder, ...recent];
    const removed = older.filter(msg => !compactedOlder.includes(msg));
    
    return this.createResult(compacted, removed, 'hybrid');
  }
}

/**
 * Compaction Manager - manages different strategies and their configuration
 */
export class CompactionManager {
  private strategies: Map<string, CompactionStrategy> = new Map();
  private currentStrategy: string = 'no_compaction';

  constructor() {
    this.registerStrategies();
  }

  private registerStrategies(): void {
    this.strategies.set('no_compaction', new NoCompaction());
    this.strategies.set('sliding_window', new SlidingWindow(50, true));
    this.strategies.set('summarize', new Summarize(20, true));
    this.strategies.set('hybrid', new Hybrid(30, true, true));
    this.strategies.set('safe_split_point', new SafeSplitPoint(
      this.strategies.get('sliding_window')!
    ));
  }

  setStrategy(strategyName: string, options?: any): void {
    if (!this.strategies.has(strategyName)) {
      throw new Error(`Unknown strategy: ${strategyName}`);
    }
    
    // Re-create the strategy with options when provided
    if (options) {
      const strategy = this.createStrategyWithOptions(strategyName, options);
      if (strategy) {
        this.strategies.set(strategyName, strategy);
      }
    }
    
    this.currentStrategy = strategyName;
  }

  private createStrategyWithOptions(name: string, options: any): CompactionStrategy | null {
    switch (name) {
      case 'sliding_window':
        return new SlidingWindow(options.windowSize ?? 50, options.preserveSystem ?? true);
      case 'summarize':
        return new Summarize(options.thresholdMessages ?? 20, options.preserveSystem ?? true);
      case 'hybrid':
        return new Hybrid(options.keepMessages ?? 30, options.preserveSystem ?? true, options.useSummarizeForOlder ?? true);
      case 'safe_split_point':
        return new SafeSplitPoint(this.strategies.get(options.innerStrategy ?? 'sliding_window')!);
      default:
        return null;
    }
  }

  compact(
    messages: LLMMessage[], 
    contextWindow: number, 
    options?: CompactionOptions
  ): CompactionResult {
    const strategy = this.strategies.get(this.currentStrategy)!;
    return strategy.compact(messages, contextWindow, options);
  }

  getAvailableStrategies(): string[] {
    return Array.from(this.strategies.keys());
  }

  getStrategyConfig(strategyName: string): any {
    const strategy = this.strategies.get(strategyName);
    if (!strategy) return null;
    
    // Return strategy configuration
    switch (strategyName) {
      case 'sliding_window':
        return { windowSize: 50, preserveSystem: true };
      case 'summarize':
        return { thresholdMessages: 20, preserveSystem: true };
      case 'hybrid':
        return { keepMessages: 30, preserveSystem: true, useSummarizeForOlder: true };
      case 'safe_split_point':
        return { innerStrategy: 'sliding_window' };
      default:
        return {};
    }
  }

  describeStrategy(name: string): string {
    const config = this.getStrategyConfig(name);
    switch (name) {
      case 'no_compaction':
        return 'No message compression - keeps all messages';
      case 'sliding_window':
        return `Keep last ${config?.windowSize || 50} messages`;
      case 'summarize':
        return `Summarize messages older than ${config?.thresholdMessages || 20}`;
      case 'hybrid':
        return `Keep last ${config?.keepMessages || 30} messages + summarize rest`;
      case 'safe_split_point':
        return 'Smart splitting without breaking tool calls';
      default:
        return 'Unknown strategy';
    }
  }

  getCurrentStrategy(): string {
    return this.currentStrategy;
  }

  // Add this method for plugin compatibility
  setCurrentStrategy(strategy: string): void {
    this.setStrategy(strategy);
  }
}