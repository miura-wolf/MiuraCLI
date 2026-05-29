import { CompactionResult, CompactionMetrics } from '../../core/types.js';

/**
 * Enhanced metrics collector with advanced tracking
 */
export class CompactionObserver {
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

  private performanceHistory: PerformanceEntry[] = [];
  private strategyPerformance: Map<string, StrategyPerfData> = new Map();
  
  recordCompaction(result: CompactionResult, timeMs: number, strategy: string): void {
    this.metrics.totalCompactions++;
    this.metrics.messagesBefore += result.stats.originalCount;
    this.metrics.messagesAfter = result.stats.compactedCount;
    this.metrics.compressionRatio = result.stats.compressionRatio;
    
    // Update average time
    this.metrics.avgTimeMs = (this.metrics.avgTimeMs * (this.metrics.totalCompactions - 1) + timeMs) / this.metrics.totalCompactions;
    
    // Record strategy usage
    this.metrics.strategyUsage[strategy] = (this.metrics.strategyUsage[strategy] || 0) + 1;
    this.metrics.lastCompactionTime = new Date().toISOString();
    
    // Track strategy-specific performance
    this.updateStrategyPerformance(strategy, timeMs, result.stats);
    
    // Add to performance history
    this.performanceHistory.push({
      timestamp: Date.now(),
      strategy,
      timeMs,
      originalCount: result.stats.originalCount,
      compactedCount: result.stats.compactedCount,
      compressionRatio: result.stats.compressionRatio
    });
    
    // Keep only last 1000 entries to prevent memory bloat
    if (this.performanceHistory.length > 1000) {
      this.performanceHistory = this.performanceHistory.slice(-1000);
    }
  }

  recordContextWindowUsage(current: number, max: number): void {
    this.metrics.contextWindowUsage = (current / max) * 100;
  }

  getMetrics(): CompactionMetrics {
    return { ...this.metrics };
  }

  getPerformanceReport(): CompactionPerformanceReport {
    const strategyPerf = Array.from(this.strategyPerformance.entries()).map(([strategy, data]) => ({
      strategy,
      totalCompactions: data.totalCompactions,
      avgTimeMs: data.totalTimeMs / data.totalCompactions,
      minTimeMs: data.minTimeMs,
      maxTimeMs: data.maxTimeMs,
      totalTokensSaved: data.totalTokensSaved
    }));

    return {
      totalCompactions: this.metrics.totalCompactions,
      avgTimeMs: this.metrics.avgTimeMs,
      compressionRatio: this.metrics.compressionRatio,
      contextWindowUsage: this.metrics.contextWindowUsage,
      strategyPerformance: strategyPerf,
      recentPerformance: this.performanceHistory.slice(-10).reverse(),
      recommendations: this.generateRecommendations()
    };
  }

  private updateStrategyPerformance(strategy: string, timeMs: number, stats: any): void {
    let perfData = this.strategyPerformance.get(strategy);
    if (!perfData) {
      perfData = {
        totalCompactions: 0,
        totalTimeMs: 0,
        minTimeMs: Infinity,
        maxTimeMs: 0,
        totalTokensSaved: 0
      };
      this.strategyPerformance.set(strategy, perfData);
    }

    perfData.totalCompactions++;
    perfData.totalTimeMs += timeMs;
    perfData.minTimeMs = Math.min(perfData.minTimeMs, timeMs);
    perfData.maxTimeMs = Math.max(perfData.maxTimeMs, timeMs);
    perfData.totalTokensSaved += stats.originalCount - stats.compactedCount;
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    
    // Context usage recommendations
    if (this.metrics.contextWindowUsage > 90) {
      recommendations.push('🚨 Critical: Context window is nearly full. Enable aggressive compaction immediately.');
    } else if (this.metrics.contextWindowUsage > 75) {
      recommendations.push('⚠️ High: Context window usage is high. Consider enabling compaction.');
    } else if (this.metrics.contextWindowUsage > 50) {
      recommendations.push('ℹ️ Medium: Context window usage is moderate. Monitor for growth.');
    }

    // Performance recommendations
    if (this.metrics.avgTimeMs > 2000) {
      recommendations.push('🐌 Slow: Compaction is taking significant time. Consider faster strategies.');
    } else if (this.metrics.avgTimeMs > 1000) {
      recommendations.push('⏱️ Moderate: Compaction time is acceptable but could be optimized.');
    }

    // Compression ratio recommendations
    if (this.metrics.compressionRatio < 0.3) {
      recommendations.push('📉 Aggressive: Very high compression ratio. Consider less aggressive strategies.');
    } else if (this.metrics.compressionRatio > 0.8) {
      recommendations.push('📈 Conservative: Low compression ratio. Consider more aggressive strategies.');
    }

    // Strategy-specific recommendations
    for (const [strategy, usage] of Object.entries(this.metrics.strategyUsage)) {
      if (usage > 10) {
        const perf = this.strategyPerformance.get(strategy);
        if (perf && (perf.totalTimeMs / perf.totalCompactions) > 1500) {
          recommendations.push(`🔄 ${strategy}: Frequently used but slow. Consider optimization.`);
        }
      }
    }

    return recommendations;
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
    this.performanceHistory = [];
    this.strategyPerformance.clear();
  }
}

interface StrategyPerfData {
  totalCompactions: number;
  totalTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  totalTokensSaved: number;
}

interface PerformanceEntry {
  timestamp: number;
  strategy: string;
  timeMs: number;
  originalCount: number;
  compactedCount: number;
  compressionRatio: number;
}

export interface CompactionPerformanceReport {
  totalCompactions: number;
  avgTimeMs: number;
  compressionRatio: number;
  contextWindowUsage: number;
  strategyPerformance: Array<{
    strategy: string;
    totalCompactions: number;
    avgTimeMs: number;
    minTimeMs: number;
    maxTimeMs: number;
    totalTokensSaved: number;
  }>;
  recentPerformance: PerformanceEntry[];
  recommendations: string[];
}

/**
 * Logger for compaction events
 */
export class CompactionLogger {
  private logs: CompactionLogEntry[] = [];
  private maxLogs = 1000;

  log(event: CompactionLogEvent): void {
    const entry: CompactionLogEntry = {
      timestamp: Date.now(),
      level: event.level,
      message: event.message,
      details: event.details || {},
      strategy: event.strategy,
      durationMs: event.durationMs
    };

    this.logs.push(entry);
    
    // Keep only recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  getLogs(level?: CompactionLogLevel): CompactionLogEntry[] {
    if (!level) {
      return [...this.logs].reverse(); // Most recent first
    }
    return this.logs.filter(log => log.level === level).reverse();
  }

  getSummary(): string {
    const counts = this.logs.reduce((acc, log) => {
      acc[log.level] = (acc[log.level] || 0) + 1;
      return acc;
    }, {} as Record<CompactionLogLevel, number>);

    return `Compaction Log Summary:\n` +
      `  Total logs: ${this.logs.length}\n` +
      `  Info: ${counts.info || 0}\n` +
      `  Warning: ${counts.warning || 0}\n` +
      `  Error: ${counts.error || 0}\n` +
      `  Debug: ${counts.debug || 0}`;
  }

  clear(): void {
    this.logs = [];
  }
}

type CompactionLogLevel = 'info' | 'warning' | 'error' | 'debug';

interface CompactionLogEvent {
  level: CompactionLogLevel;
  message: string;
  details?: Record<string, unknown>;
  strategy?: string;
  durationMs?: number;
}

interface CompactionLogEntry {
  timestamp: number;
  level: CompactionLogLevel;
  message: string;
  details: Record<string, unknown>;
  strategy?: string;
  durationMs?: number;
}