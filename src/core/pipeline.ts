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

      // Process stages with parallel execution support
      for (let i = 0; i < options.definition.stages.length; i++) {
        const stageConfig = options.definition.stages[i];

        // Check if this stage was already executed as part of a parallel group
        if (stageConfig.parallelWith) {
          // Check if this stage is the leader of a parallel group
          const parallelGroup = this.buildParallelGroup(i, options.definition.stages);
          
          if (parallelGroup.leader === i) {
            // Execute parallel group
            const parallelResults = await this.executeParallelGroup(
              parallelGroup.stages,
              context,
              options,
              pipelineId,
            );
            
            // Add all results to allStageResults
            for (const result of parallelResults) {
              if (result.role === 'worker' || result.role === 'planner') {
                workerTurns++;
              }
              if (result.role === 'reviewer') {
                reviewerTurns++;
                approved = this.parseApproval(result.result?.output || '');
                finalOutput = result.result?.output || finalOutput;
              }
              // Update finalOutput with the last stage output
              if (result.result?.output) {
                finalOutput = result.result.output;
              }
              allStageResults.push(result);
              totalPromptTokens += result.result?.tokenUsage.prompt || 0;
              totalCompletionTokens += result.result?.tokenUsage.completion || 0;
            }
          }
          // Skip if this stage is part of a group already processed
          const leaderIndex = parallelGroup.leader;
          if (leaderIndex !== i && parallelGroup.stages.some(s => s.index === i)) {
            continue;
          }
        } else {
          // Sequential execution (original behavior)
          await this.executeStage(stageConfig, context, options, allStageResults, pipelineId);
          
          if (stageConfig.role === 'worker' || stageConfig.role === 'planner') {
            workerTurns++;
          }
          if (stageConfig.role === 'reviewer') {
            reviewerTurns++;
            const lastOutput = allStageResults[allStageResults.length - 1]?.result?.output || '';
            approved = this.parseApproval(lastOutput);
            finalOutput = lastOutput;
          }
        }
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
   * Build a parallel group starting from the given index
   */
  private buildParallelGroup(startIndex: number, stages: StageConfig[]): { leader: number; stages: Array<{ index: number; stage: StageConfig }> } {
    const leader = startIndex;
    const group: Array<{ index: number; stage: StageConfig }> = [];
    const leaderStage = stages[startIndex];
    
    if (!leaderStage.parallelWith) {
      return { leader, stages: [{ index: leader, stage: leaderStage }] };
    }

    // Add leader
    group.push({ index: leader, stage: leaderStage });

    // Add parallel stages
    for (const role of leaderStage.parallelWith) {
      const parallelIndex = stages.findIndex(s => s.role === role);
      if (parallelIndex !== -1 && parallelIndex > startIndex) {
        group.push({ index: parallelIndex, stage: stages[parallelIndex] });
      }
    }

    return { leader, stages: group };
  }

  /**
   * Execute a group of stages in parallel
   */
  private async executeParallelGroup(
    parallelStages: Array<{ index: number; stage: StageConfig }>,
    context: PipelineContext,
    options: PipelineRunOptions,
    pipelineId: string,
  ): Promise<StageResult[]> {
    const promises = parallelStages.map(async ({ stage }) => {
      const stageStart = Date.now();
      
      this.eventBus.emit('pipeline.stage', {
        pipelineId,
        stage: stage.role,
        status: 'running',
      });

      try {
        const model = stage.model ?? options.modelRouter.resolve(stage.role);
        const result = await options.executeAgent(
          stage.role,
          model,
          this.buildPrompt(stage, context),
        );

        context.stageResults.set(stage.role, result);

        this.eventBus.emit('pipeline.stage', {
          pipelineId,
          stage: stage.role,
          status: 'done',
        });

        return {
          role: stage.role,
          status: 'completed' as const,
          result,
          durationMs: Date.now() - stageStart,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        this.eventBus.emit('pipeline.stage', {
          pipelineId,
          stage: stage.role,
          status: 'failed',
        });

        options.modelRouter.reportFailure(stage.role, stage.model ?? options.modelRouter.resolve(stage.role));

        return {
          role: stage.role,
          status: 'failed' as const,
          error: errorMsg,
          durationMs: Date.now() - stageStart,
        };
      }
    });

    const parallelResults = await Promise.all(promises);
    return parallelResults;
  }

  /**
   * Execute a single stage (sequential execution)
   */
  private async executeStage(
    stageConfig: StageConfig,
    context: PipelineContext,
    options: PipelineRunOptions,
    allStageResults: StageResult[],
    pipelineId: string,
  ): Promise<void> {
    // Check skip predicate
    if (stageConfig.skipWhen?.(context)) {
      const stageResult: StageResult = {
        role: stageConfig.role,
        status: 'skipped',
        durationMs: 0,
      };
      allStageResults.push(stageResult);
      this.eventBus.emit('pipeline.stage', { pipelineId, stage: stageConfig.role, status: 'skipped' });
      return;
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

      allStageResults.push({
        role: stageConfig.role,
        status: 'completed',
        result,
        durationMs: Date.now() - stageStart,
      });

      this.eventBus.emit('pipeline.stage', {
        pipelineId,
        stage: stageConfig.role,
        status: 'done',
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      allStageResults.push({
        role: stageConfig.role,
        status: 'failed',
        error: errorMsg,
        durationMs: Date.now() - stageStart,
      });

      options.modelRouter.reportFailure(stageConfig.role, model);
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
    return lower.includes('approved') || lower.includes('approved ✅') || lower.includes('lgtm');
  }
}
