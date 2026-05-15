import type { PipelineMetrics } from './types.js';

export interface StructuredLogEvent {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  event: string;
  pipelineId?: string;
  stage?: string;
  model?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export class StructuredLogger {
  log(event: StructuredLogEvent): void {
    const payload = { ...event, timestamp: event.timestamp || Date.now() };
    console.log(JSON.stringify(payload));
  }
}

export class MetricsCollector {
  private metrics = new Map<string, PipelineMetrics>();

  startPipeline(pipelineId: string): void {
    this.metrics.set(pipelineId, {
      pipelineId,
      success: false,
      iterations: 0,
      stageCount: 0,
      retries: 0,
      escalations: 0,
      latencyMs: 0,
    });
  }

  recordStage(pipelineId: string): void {
    const metric = this.metrics.get(pipelineId);
    if (!metric) return;
    metric.stageCount++;
  }

  recordRetry(pipelineId: string): void {
    const metric = this.metrics.get(pipelineId);
    if (!metric) return;
    metric.retries++;
  }

  recordEscalation(pipelineId: string): void {
    const metric = this.metrics.get(pipelineId);
    if (!metric) return;
    metric.escalations++;
  }

  finishPipeline(pipelineId: string, success: boolean, iterations: number, latencyMs: number): PipelineMetrics | null {
    const metric = this.metrics.get(pipelineId);
    if (!metric) return null;
    metric.success = success;
    metric.iterations = iterations;
    metric.latencyMs = latencyMs;
    return metric;
  }

  getMetric(pipelineId: string): PipelineMetrics | null {
    return this.metrics.get(pipelineId) ?? null;
  }
}
