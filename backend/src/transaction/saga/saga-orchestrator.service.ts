import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SagaStateEntity, SagaStatus, SagaPattern, SagaDefinition, SagaEvent } from './saga-state.entity';
import { SagaExecutor, ExecutionResult } from './saga-executor';
import { CompensationHandler, CompensationResult } from './compensation-handler';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

export interface SagaMetrics {
  sagaId: string;
  name: string;
  status: SagaStatus;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  completedSteps: number;
  totalSteps: number;
  compensatedSteps: number;
  lastError?: string;
  retryCount: number;
  pattern: SagaPattern;
}

export interface SagaRecoveryCheckpoint {
  sagaId: string;
  currentStepIndex: number;
  status: SagaStatus;
  context: Record<string, any>;
  compensatedSteps: number[];
  timestamp: Date;
}

@Injectable()
export class SagaOrchestrator implements OnModuleDestroy {
  private readonly logger = new Logger(SagaOrchestrator.name);
  private readonly sagaTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly recoveryCheckpoints: Map<string, SagaRecoveryCheckpoint> = new Map();
  private readonly idempotencyCache: Map<string, string> = new Map();

  constructor(
    @InjectRepository(SagaStateEntity)
    private readonly sagaRepository: Repository<SagaStateEntity>,
    private readonly sagaExecutor: SagaExecutor,
    private readonly compensationHandler: CompensationHandler,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.initializeRecovery();
  }

  /**
   * Register a saga definition and start orchestration
   */
  async registerAndStartSaga(
    definition: SagaDefinition,
    context: Record<string, any> = {},
    correlationId?: string,
  ): Promise<string> {
    const sagaId = uuidv4();

    this.logger.log(`Registering saga ${sagaId} (${definition.name})`);

    const sagaState = new SagaStateEntity();
    sagaState.sagaId = sagaId;
    sagaState.name = definition.name;
    sagaState.status = SagaStatus.PENDING;
    sagaState.pattern = definition.pattern;
    sagaState.sagaDefinition = definition;
    sagaState.context = context;
    sagaState.totalSteps = definition.steps.length;
    sagaState.timeoutAt = Date.now() + definition.timeout;
    sagaState.correlationId = correlationId || uuidv4();
    sagaState.metadata = definition.metadata;

    const event: SagaEvent = {
      id: uuidv4(),
      type: 'SAGA_STARTED',
      stepIndex: -1,
      stepName: definition.name,
      timestamp: new Date(),
      status: 'PENDING',
    };
    sagaState.addEvent(event);

    await this.sagaRepository.save(sagaState);

    // Set saga timeout
    const timeout = setTimeout(() => {
      this.handleSagaTimeout(sagaId);
    }, definition.timeout);
    this.sagaTimeouts.set(sagaId, timeout);

    // Start orchestration based on pattern
    if (definition.pattern === SagaPattern.ORCHESTRATION) {
      setImmediate(() => this.orchestrateSaga(sagaId));
    } else {
      setImmediate(() => this.initializeChoreography(sagaId));
    }

    return sagaId;
  }

  /**
   * Orchestration pattern: Central coordinator controls flow
   */
  private async orchestrateSaga(sagaId: string): Promise<void> {
    try {
      let sagaState = await this.sagaRepository.findOne({
        where: { sagaId },
      });

      if (!sagaState) {
        this.logger.error(`Saga ${sagaId} not found`);
        return;
      }

      sagaState.status = SagaStatus.IN_PROGRESS;
      await this.sagaRepository.save(sagaState);

      const stepResults = new Map<number, any>();

      for (let stepIndex = 0; stepIndex < sagaState.sagaDefinition.steps.length; stepIndex++) {
        // Check timeout
        if (sagaState.hasTimedOut()) {
          throw new Error(`Saga timeout exceeded`);
        }

        sagaState.currentStepIndex = stepIndex;

        const idempotencyKey = this.generateIdempotencyKey(sagaId, stepIndex);
        const executionResult = await this.sagaExecutor.executeStep(
          sagaState,
          stepIndex,
          idempotencyKey,
        );

        stepResults.set(stepIndex, executionResult.result);

        if (!executionResult.success) {
          this.logger.error(
            `Step ${stepIndex} failed, starting compensation for saga ${sagaId}`,
          );

          sagaState.status = SagaStatus.COMPENSATING;
          await this.sagaRepository.save(sagaState);

          // Start compensation
          await this.compensateAllSteps(sagaId, stepResults);
          return;
        }

        await this.sagaRepository.save(sagaState);

        // Emit step completed event for choreography listeners
        this.eventEmitter.emit(
          `${sagaState.sagaDefinition.steps[stepIndex].name}_COMPLETED`,
          {
            sagaId,
            stepIndex,
            result: executionResult.result,
            context: sagaState.context,
          },
        );
      }

      // All steps completed successfully
      sagaState.status = SagaStatus.COMPLETED;
      const event: SagaEvent = {
        id: uuidv4(),
        type: 'SAGA_COMPLETED',
        stepIndex: sagaState.currentStepIndex,
        stepName: 'Saga',
        timestamp: new Date(),
        status: 'SUCCESS',
      };
      sagaState.addEvent(event);

      await this.sagaRepository.save(sagaState);
      this.clearSagaTimeout(sagaId);

      this.logger.log(`Saga ${sagaId} completed successfully`);
      this.eventEmitter.emit(`saga_${sagaId}_completed`, {
        sagaId,
        context: sagaState.context,
      });
    } catch (error) {
      this.logger.error(`Orchestration error for saga ${sagaId}: ${error}`);
      const sagaState = await this.sagaRepository.findOne({ where: { sagaId } });
      if (sagaState) {
        this.compensationHandler.moveToDeadLetterQueue(
          sagaState,
          error instanceof Error ? error.message : String(error),
        );
        await this.sagaRepository.save(sagaState);
      }
    }
  }

  /**
   * Choreography pattern: Services listen to events
   */
  private async initializeChoreography(sagaId: string): Promise<void> {
    const sagaState = await this.sagaRepository.findOne({
      where: { sagaId },
    });

    if (!sagaState) return;

    sagaState.status = SagaStatus.IN_PROGRESS;
    const firstStep = sagaState.sagaDefinition.steps[0];

    // Emit first step event
    this.eventEmitter.emit(`${firstStep.name}_START`, {
      sagaId,
      context: sagaState.context,
    });

    await this.sagaRepository.save(sagaState);
  }

  /**
   * Handle step completion in choreography pattern
   */
  async handleStepCompletion(
    sagaId: string,
    stepIndex: number,
    result: any,
  ): Promise<void> {
    let sagaState = await this.sagaRepository.findOne({
      where: { sagaId },
    });

    if (!sagaState) {
      this.logger.error(`Saga ${sagaId} not found`);
      return;
    }

    sagaState.currentStepIndex = stepIndex;
    sagaState.context = { ...sagaState.context, ...result };

    const event: SagaEvent = {
      id: uuidv4(),
      type: 'STEP_EXECUTED',
      stepIndex,
      stepName: sagaState.sagaDefinition.steps[stepIndex].name,
      timestamp: new Date(),
      status: 'SUCCESS',
      result,
    };
    sagaState.addEvent(event);

    // Check if all steps completed
    if (stepIndex === sagaState.sagaDefinition.steps.length - 1) {
      sagaState.status = SagaStatus.COMPLETED;
      const completionEvent: SagaEvent = {
        id: uuidv4(),
        type: 'SAGA_COMPLETED',
        stepIndex,
        stepName: 'Saga',
        timestamp: new Date(),
        status: 'SUCCESS',
      };
      sagaState.addEvent(completionEvent);

      this.clearSagaTimeout(sagaId);
      this.eventEmitter.emit(`saga_${sagaId}_completed`, { sagaId });
    } else {
      // Trigger next step
      const nextStep = sagaState.sagaDefinition.steps[stepIndex + 1];
      this.eventEmitter.emit(`${nextStep.name}_START`, {
        sagaId,
        context: sagaState.context,
      });
    }

    await this.sagaRepository.save(sagaState);
  }

  /**
   * Handle step failure in choreography pattern
   */
  async handleStepFailure(
    sagaId: string,
    stepIndex: number,
    error: Error,
  ): Promise<void> {
    let sagaState = await this.sagaRepository.findOne({
      where: { sagaId },
    });

    if (!sagaState) {
      this.logger.error(`Saga ${sagaId} not found`);
      return;
    }

    const failureEvent: SagaEvent = {
      id: uuidv4(),
      type: 'STEP_EXECUTED',
      stepIndex,
      stepName: sagaState.sagaDefinition.steps[stepIndex].name,
      timestamp: new Date(),
      status: 'FAILED',
      error: error.message,
    };
    sagaState.addEvent(failureEvent);

    sagaState.status = SagaStatus.COMPENSATING;
    await this.sagaRepository.save(sagaState);

    this.logger.error(`Step ${stepIndex} failed for saga ${sagaId}, initiating compensation`);

    // Build step results map from completed steps
    const stepResults = new Map<number, any>();
    for (let i = 0; i <= stepIndex; i++) {
      const stepEvent = sagaState.eventHistory.find((e) => e.stepIndex === i);
      if (stepEvent?.result) {
        stepResults.set(i, stepEvent.result);
      }
    }

    await this.compensateAllSteps(sagaId, stepResults);
  }

  /**
   * Compensate all previously executed steps
   */
  private async compensateAllSteps(
    sagaId: string,
    stepResults: Map<number, any>,
  ): Promise<void> {
    let sagaState = await this.sagaRepository.findOne({
      where: { sagaId },
    });

    if (!sagaState) return;

    sagaState.status = SagaStatus.COMPENSATING;

    const results = await this.compensationHandler.compensateAllSteps(
      sagaState,
      stepResults,
    );

    const allSuccessful = results.every((r) => r.success);

    if (!allSuccessful) {
      this.logger.error(
        `Some compensation steps failed for saga ${sagaId}, moving to DLQ`,
      );
      this.compensationHandler.moveToDeadLetterQueue(
        sagaState,
        'Compensation failed',
      );
    } else {
      sagaState.status = SagaStatus.COMPENSATED;

      const event: SagaEvent = {
        id: uuidv4(),
        type: 'SAGA_COMPENSATED',
        stepIndex: sagaState.currentStepIndex,
        stepName: 'Saga',
        timestamp: new Date(),
        status: 'COMPENSATED',
      };
      sagaState.addEvent(event);
    }

    this.clearSagaTimeout(sagaId);
    await this.sagaRepository.save(sagaState);

    this.eventEmitter.emit(`saga_${sagaId}_compensated`, {
      sagaId,
      allSuccessful,
    });
  }

  /**
   * Create recovery checkpoint for a saga
   */
  private createRecoveryCheckpoint(sagaState: SagaStateEntity): SagaRecoveryCheckpoint {
    return {
      sagaId: sagaState.sagaId,
      currentStepIndex: sagaState.currentStepIndex,
      status: sagaState.status,
      context: { ...sagaState.context },
      compensatedSteps: [...(sagaState.compensatedSteps || [])],
      timestamp: new Date(),
    };
  }

  /**
   * Initialize recovery for crashed sagasstatus
   */
  private async initializeRecovery(): Promise<void> {
    this.logger.log('Initializing saga recovery...');

    // Recover in-progress sagas
    const inProgressSagas = await this.sagaRepository.find({
      where: [
        { status: SagaStatus.IN_PROGRESS },
        { status: SagaStatus.PENDING },
        { status: SagaStatus.COMPENSATING },
      ],
    });

    for (const saga of inProgressSagas) {
      this.logger.warn(`Recovering saga ${saga.sagaId} from checkpoint`);

      if (saga.status === SagaStatus.IN_PROGRESS) {
        // Resume from last completed step
        if (saga.pattern === SagaPattern.ORCHESTRATION) {
          setImmediate(() => this.orchestrateSaga(saga.sagaId));
        }
      } else if (saga.status === SagaStatus.COMPENSATING) {
        // Resume compensation
        const stepResults = new Map<number, any>();
        saga.eventHistory.forEach((e) => {
          if (e.status === 'SUCCESS' && e.result) {
            stepResults.set(e.stepIndex, e.result);
          }
        });
        this.compensateAllSteps(saga.sagaId, stepResults);
      }
    }
  }

  /**
   * Get saga metrics
   */
  async getSagaMetrics(sagaId: string): Promise<SagaMetrics | null> {
    const sagaState = await this.sagaRepository.findOne({
      where: { sagaId },
    });

    if (!sagaState) return null;

    const completedSteps = sagaState.eventHistory.filter(
      (e) => e.type === 'STEP_EXECUTED' && e.status === 'SUCCESS',
    ).length;

    const endTime = [SagaStatus.COMPLETED, SagaStatus.COMPENSATED, SagaStatus.FAILED].includes(
      sagaState.status,
    )
      ? sagaState.updatedAt
      : undefined;

    const durationMs = endTime ? endTime.getTime() - sagaState.createdAt.getTime() : undefined;

    return {
      sagaId: sagaState.sagaId,
      name: sagaState.name,
      status: sagaState.status,
      startTime: sagaState.createdAt,
      endTime,
      durationMs,
      completedSteps,
      totalSteps: sagaState.totalSteps,
      compensatedSteps: sagaState.getCompensatedStepCount(),
      lastError: sagaState.failureReason,
      retryCount: sagaState.retryCount,
      pattern: sagaState.pattern,
    };
  }

  /**
   * Get full saga state and history
   */
  async getSagaState(sagaId: string): Promise<SagaStateEntity | null> {
    return this.sagaRepository.findOne({
      where: { sagaId },
    });
  }

  /**
   * Manual intervention: replay a saga step
   */
  async replayStep(sagaId: string, stepIndex: number): Promise<ExecutionResult> {
    let sagaState = await this.sagaRepository.findOne({
      where: { sagaId },
    });

    if (!sagaState) {
      throw new Error(`Saga ${sagaId} not found`);
    }

    this.logger.warn(`Replaying step ${stepIndex} for saga ${sagaId}`);

    const idempotencyKey = this.generateIdempotencyKey(sagaId, stepIndex);
    const result = await this.sagaExecutor.executeStep(sagaState, stepIndex, idempotencyKey);

    if (result.success) {
      sagaState.currentStepIndex = Math.max(sagaState.currentStepIndex, stepIndex);

      // Continue orchestration from this point
      if (sagaState.pattern === SagaPattern.ORCHESTRATION) {
        setImmediate(() => this.orchestrateSaga(sagaId));
      }
    }

    await this.sagaRepository.save(sagaState);
    return result;
  }

  /**
   * Manual intervention: skip a compensation step
   */
  async skipCompensation(sagaId: string, stepIndex: number): Promise<void> {
    const sagaState = await this.sagaRepository.findOne({
      where: { sagaId },
    });

    if (!sagaState) {
      throw new Error(`Saga ${sagaId} not found`);
    }

    await this.compensationHandler.skipCompensationStep(sagaState, stepIndex);
    await this.sagaRepository.save(sagaState);
  }

  /**
   * Manual intervention: manually replay compensation
   */
  async replayCompensation(
    sagaId: string,
    stepIndex: number,
  ): Promise<CompensationResult> {
    const sagaState = await this.sagaRepository.findOne({
      where: { sagaId },
    });

    if (!sagaState) {
      throw new Error(`Saga ${sagaId} not found`);
    }

    const stepEvent = sagaState.eventHistory.find(
      (e) => e.stepIndex === stepIndex && e.type === 'STEP_EXECUTED',
    );
    const stepResult = stepEvent?.result;

    const result = await this.compensationHandler.replayCompensationStep(
      sagaState,
      stepIndex,
      stepResult,
    );
    await this.sagaRepository.save(sagaState);
    return result;
  }

  /**
   * Get DLQ (Dead Letter Queue) sagas
   */
  async getDeadLetterQueue(): Promise<SagaStateEntity[]> {
    return this.sagaRepository.find({
      where: { status: SagaStatus.FAILED },
      order: { updatedAt: 'DESC' },
      take: 100,
    });
  }

  /**
   * Handle saga timeout
   */
  private async handleSagaTimeout(sagaId: string): Promise<void> {
    this.logger.error(`Saga ${sagaId} timed out`);

    const sagaState = await this.sagaRepository.findOne({
      where: { sagaId },
    });

    if (sagaState) {
      this.compensationHandler.moveToDeadLetterQueue(sagaState, 'Timeout exceeded');
      await this.sagaRepository.save(sagaState);
    }

    this.clearSagaTimeout(sagaId);
  }

  /**
   * Clear saga timeout
   */
  private clearSagaTimeout(sagaId: string): void {
    const timeout = this.sagaTimeouts.get(sagaId);
    if (timeout) {
      clearTimeout(timeout);
      this.sagaTimeouts.delete(sagaId);
    }
  }

  /**
   * Generate idempotency key
   */
  private generateIdempotencyKey(sagaId: string, stepIndex: number): string {
    return crypto
      .createHash('sha256')
      .update(`${sagaId}-${stepIndex}`)
      .digest('hex');
  }

  /**
   * Cleanup on module destruction
   */
  onModuleDestroy(): void {
    this.sagaTimeouts.forEach((timeout) => {
      clearTimeout(timeout);
    });
    this.sagaTimeouts.clear();
    this.recoveryCheckpoints.clear();
    this.idempotencyCache.clear();

    this.logger.log('SagaOrchestrator cleaned up');
  }
}
