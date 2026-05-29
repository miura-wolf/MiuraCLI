import type {
  AgentResult,
  AgentRole,
  PipelineContext,
  PipelineDefinition,
  PipelineIterationRecord,
  PipelineResult,
  StageConfig,
  StageResult,
  StuckSignal,
  PipelineProgressStatus,
} from './types.js';

import { EventBus } from './event-bus.js';
import { AgentBus } from './agent-bus.js';
import { StuckDetector } from './stuck-detector.js';
import { ModelRouter } from './model-router.js';
import { randomUUID } from 'node:crypto';

export interface PipelineRunOptions {
  input: string;
  definition: PipelineDefinition;
  agentBus: AgentBus;
  modelRouter: ModelRouter;
  pipelineId?: string;
  resumeFrom?: {
    iteration: number;
    history: PipelineIterationRecord[];
    stages: StageResult[];
  };
  onCheckpoint?: (checkpoint: {
    pipelineId: string;
    iteration: number;
    stages: StageResult[];
    history: PipelineIterationRecord[];
    status: PipelineProgressStatus;
  }) => Promise<void> | void;
  executeAgent: (role: AgentRole, model: import('./types.js').ModelRef, input: string) => Promise<AgentResult>;
}

export class Pipeline {
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  async run(options: PipelineRunOptions): Promise<PipelineResult> {
    const pipelineId = options.pipelineId ?? randomUUID();
    const startTime = Date.now();
    const stuckDetector = new StuckDetector(options.definition.stuckDetection);
    const context: PipelineContext = {
      input: options.input,
      stageResults: new Map(),
      iteration: options.resumeFrom?.iteration ?? 0,
      history: options.resumeFrom?.history ? [...options.resumeFrom.history] : [],
    };

    const allStageResults: StageResult[] = options.resumeFrom?.stages ? [...options.resumeFrom.stages] : [];
    const stuckEvents: StuckSignal[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    this.eventBus.emit('pipeline.started', {
      pipelineId,
      stages: options.definition.stages.map((s) => s.role),
    });

    let approved = false;
    let finalOutput = '';

    while (context.iteration < options.definition.maxIterations && !approved) {
      context.iteration++;
      let workerTurns = 0;
      let reviewerTurns = 0;

      // DAG Execution Logic
      let pendingStages = [...options.definition.stages];
      const completedInIteration = new Set<AgentRole>();

      while (pendingStages.length > 0) {
        // Find all stages that have their dependencies met
        const executable = pendingStages.filter(stage => 
          !stage.dependsOn || stage.dependsOn.every(dep => completedInIteration.has(dep))
        );

        if (executable.length === 0) {
          throw new Error(`Circular dependency detected in pipeline stages. Pending: ${pendingStages.map(s => s.role).join(', ')}`);
        }

        // Execute available stages in parallel
        const results = await Promise.all(executable.map(async (stage) => {
          const result = await this.executeStage(stage, context, options, pipelineId);
          return result;
        }));

        for (const result of results) {
          completedInIteration.add(result.role);
          allStageResults.push(result);

          if (result.role === 'worker' || result.role === 'planner') {
            workerTurns++;
          }
          if (result.role === 'reviewer') {
            reviewerTurns++;
            approved = this.parseApproval(result.result?.output || '');
            finalOutput = result.result?.output || finalOutput;
          }
          if (result.result?.output) {
            finalOutput = result.result.output;
          }
          totalPromptTokens += result.result?.tokenUsage.prompt || 0;
          totalCompletionTokens += result.result?.tokenUsage.completion || 0;
        }

        // Remove executed stages from pending list
        const executableRoles = executable.map(s => s.role);
        pendingStages = pendingStages.filter(s => !executableRoles.includes(s.role));
      }

      // Record iteration for stuck detection
      const iterationRecord: PipelineIterationRecord = {
        iteration: context.iteration,
        stageResults: new Map(context.stageResults),
        reviewerApproved: approved,
      };
      context.history.push(iterationRecord);

      // Run stuck detection
      const lastWorkerResult = context.stageResults.get('worker');
      const lastError = allStageResults.findLast((s) => s.status === 'failed');
      const stuckSignal = stuckDetector.addEntry({
        iteration: context.iteration,
        error: lastError?.result?.output,
        output: lastWorkerResult?.output,
        reviewerApproved: approved,
        workerTurns,
        reviewerTurns,
      });

      if (stuckSignal) {
        stuckEvents.push(stuckSignal);
        this.eventBus.emit('pipeline.stuck', { pipelineId, detector: stuckSignal });

        if (stuckSignal.suggestion === 'ESCALATE_MODEL') {
          // Model router will auto-escalate on next resolve
        }

        if (stuckSignal.suggestion === 'REFRAME_TASK' || stuckSignal.suggestion === 'CHANGE_APPROACH') {
          await options.onCheckpoint?.({
            pipelineId,
            iteration: context.iteration,
            stages: allStageResults,
            history: context.history,
            status: 'interrupted',
          });
          break;
        }
      }

      await options.onCheckpoint?.({
        pipelineId,
        iteration: context.iteration,
        stages: allStageResults,
        history: context.history,
        status: 'running',
      });
    }

    // Check max iterations
    if (context.iteration >= options.definition.maxIterations && !approved) {
      this.eventBus.emit('pipeline.max_iterations', { pipelineId, iterations: context.iteration });
    }

    const result: PipelineResult = {
      pipelineId,
      stages: allStageResults,
      iterations: context.iteration,
      totalDurationMs: Date.now() - startTime,
      totalTokenUsage: { prompt: totalPromptTokens, completion: totalCompletionTokens },
      stuckEvents,
      finalOutput,
    };

    this.eventBus.emit('pipeline.completed', { pipelineId, result });
    await options.onCheckpoint?.({
      pipelineId,
      iteration: context.iteration,
      stages: allStageResults,
      history: context.history,
      status: approved ? 'completed' : 'failed',
    });
    return result;
  }

  /**
   * Execute a single stage
   */
  private async executeStage(
    stageConfig: StageConfig,
    context: PipelineContext,
    options: PipelineRunOptions,
    pipelineId: string,
  ): Promise<StageResult> {
    // Check skip predicate
    if (stageConfig.skipWhen?.(context)) {
      this.eventBus.emit('pipeline.stage', { pipelineId, stage: stageConfig.role, status: 'skipped' });
      return {
        role: stageConfig.role,
        status: 'skipped',
        durationMs: 0,
      };
    }

    const model = stageConfig.model ?? options.modelRouter.resolve(stageConfig.role);
    const stageStart = Date.now();

    this.eventBus.emit('pipeline.stage', {
      pipelineId,
      stage: stageConfig.role,
      status: 'running',
    });

    try {
      const result = await options.executeAgent(
        stageConfig.role,
        model,
        this.buildPrompt(stageConfig, context),
      );

      context.stageResults.set(stageConfig.role, result);

      this.eventBus.emit('pipeline.stage', {
        pipelineId,
        stage: stageConfig.role,
        status: 'done',
      });

      return {
        role: stageConfig.role,
        status: 'completed',
        result,
        durationMs: Date.now() - stageStart,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.eventBus.emit('pipeline.stage', {
        pipelineId,
        stage: stageConfig.role,
        status: 'failed',
      });

      options.modelRouter.reportFailure(stageConfig.role, model);

      // Record failure in context so downstream stages can see it
      context.stageResults.set(stageConfig.role, {
        agentId: `failed-${stageConfig.role}`,
        output: errorMsg,
        exitCode: 1,
        durationMs: Date.now() - stageStart,
        tokenUsage: { prompt: 0, completion: 0 },
        model: stageConfig.role === 'worker' ? model : options.modelRouter.resolve(stageConfig.role),
      } as AgentResult);

      return {
        role: stageConfig.role,
        status: 'failed',
        error: errorMsg,
        durationMs: Date.now() - stageStart,
      };
    }
  }

  private buildPrompt(stage: StageConfig, context: PipelineContext): string {
    const previousResults: string[] = [];
    for (const [role, result] of context.stageResults) {
      if (role !== stage.role) {
        previousResults.push(`[${role}]: ${result.output}`);
      }
    }

    const contextStr = previousResults.length > 0
      ? `\n\nPrevious stage results:\n${previousResults.join('\n\n')}`
      : '';

    const iterationStr = context.iteration > 1
      ? `\n\nThis is iteration ${context.iteration}. Previous attempts did not pass review.`
      : '';

    return `${context.input}${contextStr}${iterationStr}`;
  }

  private parseApproval(reviewerOutput: string): boolean {
    const lower = reviewerOutput.toLowerCase();
    // Match "approved" or "lgtm" but NOT "not approved", "unapproved", "never approved", etc.
    const approvedPattern = /(?<!\b(?:not|un|never|no|dis))\bapproved\b/;
    const lgtmPattern = /\blgtm\b/;
    return approvedPattern.test(lower) || lgtmPattern.test(lower);
  }
}
