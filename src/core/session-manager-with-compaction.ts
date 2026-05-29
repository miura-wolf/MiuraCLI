import {
  LLMMessage,
  CompactionResult,
  SessionConfig,
  CompactionMetrics
} from './types.js';
import { CompactionManager } from '../plugins/compaction/compaction-manager.js';
import { SessionManager as BaseSessionManager, SessionMessage } from '../cli/session-manager.js';

/**
 * Enhanced Session Manager with compaction capabilities
 */
export class SessionManagerWithCompaction {
  private baseSession: BaseSessionManager;
  private compactionManager: CompactionManager;
  private metricsCollector: CompactionMetricsCollector;
  private currentReport: CompactionResult | null = null;
  
  private contextWindow: number;
  private currentContextTokens: number = 0;
  private lastCompactionStats: any = null;

  constructor(config: SessionConfig) {
    this.baseSession = new BaseSessionManager();
    this.compactionManager = new CompactionManager();
    this.metricsCollector = new CompactionMetricsCollector();
    this.contextWindow = config.contextWindow;
    
    // Set initial strategy
    this.compactionManager.setStrategy(config.compaction.strategy, config.compaction.options);
    
    console.log(`[SessionManager] Initialized with ${config.compaction.strategy} strategy, context window: ${config.contextWindow} tokens`);
  }

  get id(): string {
    return this.baseSession.id;
  }

  get messages(): SessionMessage[] {
    return this.baseSession.messages;
  }

  get messageCount(): number {
    return this.baseSession.messageCount;
  }

  /**
   * Add a message with automatic compaction if needed
   */
  async addMessage(message: SessionMessage): Promise<void> {
    // Convert to LLMMessage for compaction
    const llmMessage: LLMMessage = {
      role: message.role,
      content: message.content,
      timestamp: message.timestamp.toString(),
      metadata: {}
    };

    // Estimate tokens for this message
    const messageTokens = this.estimateTokens(llmMessage);
    this.currentContextTokens += messageTokens;
    
    // Check if we need to compact
    if (this.needsCompaction()) {
      await this.compact();
    }
    
    // Add the message
    this.baseSession.add(message);
    
    // Record context window usage
    this.metricsCollector.recordContextWindowUsage(this.currentContextTokens, this.contextWindow);
  }

  /**
   * Check if compaction is needed
   */
  private needsCompaction(): boolean {
    // Compact when we reach 90% of context window
    return this.currentContextTokens > this.contextWindow * 0.9;
  }

  /**
   * Perform compaction
   */
  private async compact(): Promise<void> {
    const startTime = Date.now();
    
    // Convert messages to LLMMessage format
    const llmMessages: LLMMessage[] = this.baseSession.messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp.toString(),
      metadata: {}
    }));

    // Perform compaction
    const result = this.compactionManager.compact(llmMessages, this.contextWindow);
    this.currentReport = result;
    
    // Convert back to SessionMessage (map unknown roles to 'assistant')
    const compactedMessages: SessionMessage[] = result.compactedMessages.map(msg => ({
      role: (msg.role === 'user' || msg.role === 'system' || msg.role === 'assistant') ? msg.role : 'assistant',
      content: msg.content ?? '',
      timestamp: msg.timestamp ? parseInt(msg.timestamp) : Date.now(),
    }));

    // Update session with compacted messages
    this.baseSession.clearMessages();
    compactedMessages.forEach(msg => this.baseSession.add(msg));
    
    // Update token count
    this.currentContextTokens = this.estimateTokensFromMessages(result.compactedMessages);
    
    // Record metrics
    const timeMs = Date.now() - startTime;
    this.metricsCollector.recordCompaction(result, timeMs, this.compactionManager.getCurrentStrategy());
    this.lastCompactionStats = result.stats;
    
    // Log compaction event
    console.log(`[SessionManager] Session compacted: ${result.stats.originalCount} → ${result.stats.compactedCount} messages (${result.stats.compressionRatio} ratio, ${timeMs}ms)`);
  }

  /**
   * Token estimation helpers
   */
  private estimateTokens(message: LLMMessage): number {
    const words = message.content?.split(/\s+/).length || 0;
    return words * 4; // 4 tokens per word (rough estimate)
  }

  private estimateTokensFromMessages(messages: LLMMessage[]): number {
    return messages.reduce((total, msg) => total + this.estimateTokens(msg), 0);
  }

  /**
   * Get recent messages for context injection
   */
  getRecentMessages(n: number = 10): SessionMessage[] {
    return this.baseSession.getRecentMessages(n);
  }

  /**
   * Get compaction statistics
   */
  getCompactionStats(): CompactionMetrics {
    return this.metricsCollector.getMetrics();
  }

  /**
   * Get last compaction report
   */
  getLastCompactionReport(): CompactionResult | null {
    return this.currentReport;
  }

  /**
   * Set compaction strategy
   */
  setStrategy(strategy: string, options?: any): void {
    this.compactionManager.setStrategy(strategy, options);
    console.log(`[SessionManager] Strategy changed to: ${strategy}`);
  }

  /**
   * Get available strategies
   */
  getAvailableStrategies(): string[] {
    return this.compactionManager.getAvailableStrategies();
  }

  /**
   * Get current strategy
   */
  getCurrentStrategy(): string {
    return this.compactionManager.getCurrentStrategy();
  }

  /**
   * Get current context window usage
   */
  getContextUsage(): number {
    return (this.currentContextTokens / this.contextWindow) * 100;
  }

  /**
   * Get compaction recommendations
   */
  getRecommendations(): string[] {
    const recommendations: string[] = [];
    
    if (this.getContextUsage() > 90) {
      recommendations.push('Context window is nearly full. Consider using a more aggressive compaction strategy.');
    }
    
    if (this.getContextUsage() > 75) {
      recommendations.push('Context window is high. Consider enabling compaction if not already active.');
    }
    
    const stats = this.getCompactionStats();
    if (stats.totalCompactions > 0 && stats.avgTimeMs > 1000) {
      recommendations.push('Compaction is taking significant time. Consider using faster strategies like sliding_window.');
    }
    
    if (stats.compressionRatio < 0.5) {
      recommendations.push('Compaction ratio is very low. Consider adjusting strategy parameters.');
    }
    
    return recommendations;
  }

  /**
   * Persist session
   */
  persist(): void {
    this.baseSession.persist();
  }

  /**
   * Close session
   */
  close(): void {
    this.baseSession.close();
  }

  /**
   * Clear messages but keep session metadata
   */
  clearMessages(): void {
    this.baseSession.clearMessages();
    this.currentContextTokens = 0;
  }

  /**
   * Get session summary with compaction info
   */
  getSummary(): string {
    const stats = this.getCompactionStats();
    const usage = this.getContextUsage();
    const recommendations = this.getRecommendations();
    
    let summary = `Session Summary:\n`;
    summary += `  ID: ${this.id}\n`;
    summary += `  Messages: ${this.messageCount}\n`;
    summary += `  Context Usage: ${usage.toFixed(1)}%\n`;
    summary += `  Total Compactions: ${stats.totalCompactions}\n`;
    
    if (stats.totalCompactions > 0) {
      summary += `  Avg Compression Ratio: ${stats.compressionRatio.toFixed(2)}\n`;
      summary += `  Avg Time: ${stats.avgTimeMs.toFixed(0)}ms\n`;
    }
    
    if (recommendations.length > 0) {
      summary += `\nRecommendations:\n`;
      recommendations.forEach(rec => {
        summary += `  • ${rec}\n`;
      });
    }
    
    return summary;
  }
}

/**
 * Enhanced metrics collector
 */
class CompactionMetricsCollector {
  private metrics: CompactionMetrics = {
    totalCompactions: 0,
    messagesBefore: 0,
    messagesAfter: 0,
    compressionRatio: 0,
    avgTimeMs: 0,
    strategyUsage: {},
    contextWindowUsage: 0,
    lastCompactionTime: ''
  };

  recordCompaction(result: any, timeMs: number, strategy: string): void {
    this.metrics.totalCompactions++;
    this.metrics.messagesBefore += result.stats.originalCount;
    this.metrics.messagesAfter = result.stats.compactedCount;
    this.metrics.compressionRatio = result.stats.compressionRatio;
    
    // Accumulate time
    this.metrics.avgTimeMs = (this.metrics.avgTimeMs * (this.metrics.totalCompactions - 1) + timeMs) / this.metrics.totalCompactions;
    
    // Record strategy usage
    this.metrics.strategyUsage[strategy] = (this.metrics.strategyUsage[strategy] || 0) + 1;
    this.metrics.lastCompactionTime = new Date().toISOString();
  }

  recordContextWindowUsage(current: number, max: number): void {
    this.metrics.contextWindowUsage = (current / max) * 100;
  }

  getMetrics(): CompactionMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = {
      totalCompactions: 0,
      messagesBefore: 0,
      messagesAfter: 0,
      compressionRatio: 0,
      avgTimeMs: 0,
      strategyUsage: {},
      contextWindowUsage: 0,
      lastCompactionTime: ''
    };
  }
}