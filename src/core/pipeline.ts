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
  executeAgent: (role: AgentRole, model: import('./types.js').ModelRef, input: string) => Promise<AgentResult>;
}

export class Pipeline {
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  async run(options: PipelineRunOptions): Promise<PipelineResult> {
    const pipelineId = randomUUID();
    const startTime = Date.now();
    const stuckDetector = new StuckDetector(options.definition.stuckDetection);

    const context: PipelineContext = {
      input: options.input,
      stageResults: new Map(),
      iteration: 0,
      history: [],
    };

    const allStageResults: StageResult[] = [];
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

      for (const stageConfig of options.definition.stages) {
        // Check skip predicate
        if (stageConfig.skipWhen?.(context)) {
          const stageResult: StageResult = {
            role: stageConfig.role,
            status: 'skipped',
            durationMs: 0,
          };
          allStageResults.push(stageResult);

          this.eventBus.emit('pipeline.stage', {
            pipelineId,
            stage: stageConfig.role,
            status: 'skipped',
          });
          continue;
        }

        // Resolve model
        const model = stageConfig.model ?? options.modelRouter.resolve(stageConfig.role);

        this.eventBus.emit('pipeline.stage', {
          pipelineId,
          stage: stageConfig.role,
          status: 'running',
        });

        const stageStart = Date.now();
        try {
          const result = await options.executeAgent(
            stageConfig.role,
            model,
            this.buildPrompt(stageConfig, context),
          );

          context.stageResults.set(stageConfig.role, result);
          totalPromptTokens += result.tokenUsage.prompt;
          totalCompletionTokens += result.tokenUsage.completion;
          finalOutput = result.output;

          allStageResults.push({
            role: stageConfig.role,
            status: 'completed',
            result,
            durationMs: Date.now() - stageStart,
          });

          // Track turns for stuck detection
          if (stageConfig.role === 'worker' || stageConfig.role === 'planner') {
            workerTurns++;
          }
          if (stageConfig.role === 'reviewer') {
            reviewerTurns++;
            // Check if reviewer approved
            approved = this.parseApproval(result.output);
          }

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
            durationMs: Date.now() - stageStart,
          });

          // Report failure to model router
          options.modelRouter.reportFailure(stageConfig.role, model);
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
        this.eventBus.emit('pipeline.stuck', {
          pipelineId,
          detector: stuckSignal,
        });

        // Escalate if suggested
        if (stuckSignal.suggestion === 'ESCALATE_MODEL') {
          // Model router will auto-escalate on next resolve
        }

        // Break if reframing needed
        if (stuckSignal.suggestion === 'REFRAME_TASK' || stuckSignal.suggestion === 'CHANGE_APPROACH') {
          break;
        }
      }
    }

    // Check max iterations
    if (context.iteration >= options.definition.maxIterations && !approved) {
      this.eventBus.emit('pipeline.max_iterations', {
        pipelineId,
        iterations: context.iteration,
      });
    }

    const result: PipelineResult = {
      pipelineId,
      stages: allStageResults,
      iterations: context.iteration,
      totalDurationMs: Date.now() - startTime,
      totalTokenUsage: {
        prompt: totalPromptTokens,
        completion: totalCompletionTokens,
      },
      stuckEvents,
      finalOutput,
    };

    this.eventBus.emit('pipeline.completed', { pipelineId, result });

    return result;
  }

  private buildPrompt(stage: StageConfig, context: PipelineContext): string {
    // Build context-aware prompt for the stage
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
