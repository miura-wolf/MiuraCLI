import type {
  StuckDetectionConfig,
  StuckSignal,
  StuckSuggestion,
  StuckType,
} from './types.js';

export const DEFAULT_STUCK_CONFIG: StuckDetectionConfig = {
  enabled: true,
  historySize: 20,
  errorLoopThreshold: 2,
  revisionLoopThreshold: 4,
  outputRepeatThreshold: 3,
  monologueThreshold: 6,
};

export interface StuckHistoryEntry {
  iteration: number;
  error?: string;
  output?: string;
  reviewerApproved: boolean;
  workerTurns: number;
  reviewerTurns: number;
}

export class StuckDetector {
  private config: StuckDetectionConfig;
  private history: StuckHistoryEntry[] = [];

  constructor(config?: Partial<StuckDetectionConfig>) {
    this.config = { ...DEFAULT_STUCK_CONFIG, ...config };
  }

  addEntry(entry: StuckHistoryEntry): StuckSignal | null {
    this.history.push(entry);
    if (this.history.length > this.config.historySize) {
      this.history.shift();
    }

    if (!this.config.enabled) return null;

    // Check in priority order
    return (
      this.checkErrorLoop() ??
      this.checkRevisionLoop() ??
      this.checkOutputRepeat() ??
      this.checkMonologue()
    );
  }

  reset(): void {
    this.history = [];
  }

  getHistory(): readonly StuckHistoryEntry[] {
    return this.history;
  }

  private checkErrorLoop(): StuckSignal | null {
    const recent = this.history.slice(-this.config.errorLoopThreshold);
    if (recent.length < this.config.errorLoopThreshold) return null;

    const lastError = recent[recent.length - 1].error;
    if (!lastError) return null;

    const allSame = recent.every(
      (e) => e.error === lastError && e.error !== undefined,
    );
    if (!allSame) return null;

    return {
      type: 'error_loop' as StuckType,
      count: this.config.errorLoopThreshold,
      threshold: this.config.errorLoopThreshold,
      suggestion: 'ESCALATE_MODEL' as StuckSuggestion,
      details: `Same error repeated ${this.config.errorLoopThreshold}+ times: "${lastError.slice(0, 100)}"`,
    };
  }

  private checkRevisionLoop(): StuckSignal | null {
    const recent = this.history.slice(-this.config.revisionLoopThreshold);
    if (recent.length < this.config.revisionLoopThreshold) return null;

    const allRejected = recent.every((e) => !e.reviewerApproved);
    if (!allRejected) return null;

    return {
      type: 'revision_loop' as StuckType,
      count: recent.length,
      threshold: this.config.revisionLoopThreshold,
      suggestion: 'REFRAME_TASK' as StuckSuggestion,
      details: `Reviewer rejected ${recent.length} consecutive iterations without approval`,
    };
  }

  private checkOutputRepeat(): StuckSignal | null {
    const recent = this.history.slice(-this.config.outputRepeatThreshold);
    if (recent.length < this.config.outputRepeatThreshold) return null;

    const lastOutput = recent[recent.length - 1].output;
    if (!lastOutput) return null;

    const allSame = recent.every((e) => e.output === lastOutput);
    if (!allSame) return null;

    return {
      type: 'output_repeat' as StuckType,
      count: this.config.outputRepeatThreshold,
      threshold: this.config.outputRepeatThreshold,
      suggestion: 'CHANGE_APPROACH' as StuckSuggestion,
      details: `Identical output produced ${this.config.outputRepeatThreshold}+ times`,
    };
  }

  private checkMonologue(): StuckSignal | null {
    const recent = this.history.slice(-this.config.monologueThreshold);
    if (recent.length < this.config.monologueThreshold) return null;

    const totalWorkerTurns = recent.reduce((sum, e) => sum + e.workerTurns, 0);
    const totalReviewerTurns = recent.reduce(
      (sum, e) => sum + e.reviewerTurns,
      0,
    );

    if (totalReviewerTurns > 0) return null;

    if (totalWorkerTurns < this.config.monologueThreshold) return null;

    return {
      type: 'monologue' as StuckType,
      count: totalWorkerTurns,
      threshold: this.config.monologueThreshold,
      suggestion: 'FORCE_REVIEW' as StuckSuggestion,
      details: `Worker operated for ${totalWorkerTurns} turns without reviewer intervention`,
    };
  }
}
