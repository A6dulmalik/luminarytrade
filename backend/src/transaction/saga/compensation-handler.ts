import { Injectable, Logger } from '@nestjs/common';
import { SagaStateEntity, SagaStatus, SagaEvent } from './saga-state.entity';
import { v4 as uuidv4 } from 'uuid';

export interface CompensationResult {
  stepIndex: number;
  stepName: string;
  success: boolean;
  result?: any;
  error?: string;
  compensationTimeMs: number;
  timestamp: Date;
}

@Injectable()
export class CompensationHandler {
  private readonly logger = new Logger(CompensationHandler.name);

  /**
   * Compensate a single step (rollback)
   */
  async compensateStep(
    sagaState: SagaStateEntity,
    stepIndex: number,
    stepResult: any,
  ): Promise<CompensationResult> {
    const step = sagaState.sagaDefinition.steps[stepIndex];
    if (!step) {
      throw new Error(`Step ${stepIndex} not found in saga`);
    }

    if (!step.compensation) {
      this.logger.warn(`No compensation function defined for step ${stepIndex}`);
      sagaState.markStepAsCompensated(stepIndex);
      return {
        stepIndex,
        stepName: step.name,
        success: true,
        compensationTimeMs: 0,
        timestamp: new Date(),
      };
    }

    const startTime = Date.now();

    try {
      this.logger.log(
        `Compensating step ${stepIndex} (${step.name}) for saga ${sagaState.sagaId}`,
      );

      await step.compensation(sagaState.context, stepResult);

      const compensationTimeMs = Date.now() - startTime;
      this.logger.log(
        `Step ${stepIndex} compensated successfully in ${compensationTimeMs}ms`,
      );

      // Record compensation event
      const event: SagaEvent = {
        id: uuidv4(),
        type: 'STEP_COMPENSATED',
        stepIndex,
        stepName: step.name,
        timestamp: new Date(),
        status: 'COMPENSATED',
      };
      sagaState.addEvent(event);

      sagaState.markStepAsCompensated(stepIndex);

      return {
        stepIndex,
        stepName: step.name,
        success: true,
        compensationTimeMs,
        timestamp: new Date(),
      };
    } catch (error) {
      const compensationTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Failed to compensate step ${stepIndex}: ${errorMessage}`,
        error,
      );

      // Record failed compensation event
      const event: SagaEvent = {
        id: uuidv4(),
        type: 'STEP_COMPENSATION_FAILED',
        stepIndex,
        stepName: step.name,
        timestamp: new Date(),
        status: 'COMPENSATING',
        compensationError: errorMessage,
      };
      sagaState.addEvent(event);

      return {
        stepIndex,
        stepName: step.name,
        success: false,
        error: errorMessage,
        compensationTimeMs,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Compensate all completed steps in reverse order (LIFO)
   */
  async compensateAllSteps(
    sagaState: SagaStateEntity,
    stepResults: Map<number, any>,
  ): Promise<CompensationResult[]> {
    this.logger.log(
      `Starting compensation for saga ${sagaState.sagaId} from step ${sagaState.currentStepIndex}`,
    );

    const results: CompensationResult[] = [];

    // Compensate in reverse order
    for (let i = sagaState.currentStepIndex; i >= 0; i--) {
      // Skip already compensated steps
      if (sagaState.compensatedSteps?.includes(i)) {
        this.logger.debug(`Step ${i} already compensated, skipping`);
        continue;
      }

      const stepResult = stepResults.get(i);
      const compensationResult = await this.compensateStep(sagaState, i, stepResult);
      results.push(compensationResult);

      if (!compensationResult.success) {
        this.logger.warn(
          `Compensation of step ${i} failed, moving to dead letter queue`,
        );
        // Continue compensation of remaining steps even if one fails
      }
    }

    this.logger.log(`Compensation completed with ${results.length} steps`);
    return results;
  }

  /**
   * Check if all steps can be safely compensated
   */
  canCompensate(sagaState: SagaStateEntity): boolean {
    const successfulSteps = sagaState.eventHistory.filter(
      (e) => e.type === 'STEP_EXECUTED' && e.status === 'SUCCESS',
    );

    const stepsWithCompensation = successfulSteps.every((step) => {
      const stepDef = sagaState.sagaDefinition.steps[step.stepIndex];
      return stepDef?.compensation !== undefined;
    });

    return stepsWithCompensation;
  }

  /**
   * Get list of steps that need compensation
   */
  getStepsRequiringCompensation(sagaState: SagaStateEntity): number[] {
    const successfulSteps = sagaState.eventHistory
      .filter((e) => e.type === 'STEP_EXECUTED' && e.status === 'SUCCESS')
      .map((e) => e.stepIndex);

    // Filter out already compensated steps
    return successfulSteps.filter((stepIndex) => {
      return !sagaState.compensatedSteps?.includes(stepIndex);
    });
  }

  /**
   * Move saga to dead letter queue
   */
  moveToDeadLetterQueue(
    sagaState: SagaStateEntity,
    reason: string,
    stepIndex?: number,
  ): void {
    sagaState.status = SagaStatus.FAILED;
    sagaState.failureReason = reason;
    sagaState.deadLetterQueueId = uuidv4();

    this.logger.error(
      `Saga ${sagaState.sagaId} moved to dead letter queue: ${reason} (step: ${stepIndex})`,
    );

    const event: SagaEvent = {
      id: uuidv4(),
      type: 'MOVED_TO_DLQ',
      stepIndex: stepIndex || -1,
      stepName: `Dead Letter (${reason})`,
      timestamp: new Date(),
      status: 'FAILED',
      error: reason,
    };
    sagaState.addEvent(event);
  }

  /**
   * Manually skip a compensation step (for admin intervention)
   */
  async skipCompensationStep(
    sagaState: SagaStateEntity,
    stepIndex: number,
  ): Promise<void> {
    this.logger.warn(
      `Manually skipping compensation for step ${stepIndex} in saga ${sagaState.sagaId}`,
    );

    sagaState.markStepAsCompensated(stepIndex);

    const event: SagaEvent = {
      id: uuidv4(),
      type: 'COMPENSATION_SKIPPED',
      stepIndex,
      stepName: sagaState.sagaDefinition.steps[stepIndex]?.name || 'Unknown',
      timestamp: new Date(),
      status: 'COMPENSATED',
    };
    sagaState.addEvent(event);
  }

  /**
   * Manually replay compensation for a step (for admin intervention)
   */
  async replayCompensationStep(
    sagaState: SagaStateEntity,
    stepIndex: number,
    stepResult: any,
  ): Promise<CompensationResult> {
    this.logger.warn(
      `Manually replaying compensation for step ${stepIndex} in saga ${sagaState.sagaId}`,
    );

    sagaState.compensatedSteps = (sagaState.compensatedSteps || []).filter((i) => i !== stepIndex);
    return this.compensateStep(sagaState, stepIndex, stepResult);
  }

  /**
   * Rollback a saga and send compensation events (for choreography pattern)
   */
  async publishCompensationEvents(
    sagaState: SagaStateEntity,
    eventEmitter: any,
  ): Promise<void> {
    for (let i = sagaState.currentStepIndex; i >= 0; i--) {
      if (sagaState.compensatedSteps?.includes(i)) {
        continue;
      }

      const step = sagaState.sagaDefinition.steps[i];
      if (!step) continue;

      const event = {
        type: `${step.name}_COMPENSATE`,
        sagaId: sagaState.sagaId,
        stepIndex: i,
        context: sagaState.context,
        timestamp: new Date(),
      };

      this.logger.debug(
        `Publishing compensation event for step ${i}: ${event.type}`,
      );
      eventEmitter.emit(event.type, event);
    }
  }
}
