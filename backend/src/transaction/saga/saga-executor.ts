import { Injectable, Logger } from '@nestjs/common';
import { SagaStateEntity, SagaStatus, SagaEvent } from './saga-state.entity';
import { v4 as uuidv4 } from 'uuid';

export interface ExecutionResult {
  stepIndex: number;
  stepName: string;
  success: boolean;
  result?: any;
  error?: string;
  executionTimeMs: number;
  timestamp: Date;
  retryCount: number;
}

@Injectable()
export class SagaExecutor {
  private readonly logger = new Logger(SagaExecutor.name);
  private readonly executionTimeouts: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Execute a single saga step with timeout and retry logic
   */
  async executeStep(
    sagaState: SagaStateEntity,
    stepIndex: number,
    idempotencyKey: string,
  ): Promise<ExecutionResult> {
    const step = sagaState.sagaDefinition.steps[stepIndex];
    if (!step) {
      throw new Error(`Step ${stepIndex} not found in saga ${sagaState.sagaId}`);
    }

    const startTime = Date.now();
    let retryCount = 0;
    let lastError: Error | undefined;

    // Check if this step was already executed (idempotency)
    const existingEvent = sagaState.eventHistory.find(
      (e) => e.stepIndex === stepIndex && e.type === 'STEP_EXECUTED',
    );

    if (existingEvent && existingEvent.status === 'SUCCESS') {
      this.logger.debug(
        `Step ${stepIndex} already completed for saga ${sagaState.sagaId}, returning cached result`,
      );
      return {
        stepIndex,
        stepName: step.name,
        success: true,
        result: existingEvent.result,
        executionTimeMs: Date.now() - startTime,
        timestamp: new Date(),
        retryCount: 0,
      };
    }

    const maxRetries = step.retry?.maxRetries || 0;

    while (retryCount <= maxRetries) {
      try {
        this.logger.log(
          `Executing step ${stepIndex} (${step.name}) for saga ${sagaState.sagaId}`,
        );

        const result = await this.executeWithTimeout(
          step.action(sagaState.context),
          step.timeout,
          `${sagaState.sagaId}-${stepIndex}`,
        );

        const executionTimeMs = Date.now() - startTime;
        this.logger.log(
          `Step ${stepIndex} completed successfully in ${executionTimeMs}ms`,
        );

        // Record success event
        const event: SagaEvent = {
          id: uuidv4(),
          type: 'STEP_EXECUTED',
          stepIndex,
          stepName: step.name,
          timestamp: new Date(),
          status: 'SUCCESS',
          result,
        };
        sagaState.addEvent(event);

        return {
          stepIndex,
          stepName: step.name,
          success: true,
          result,
          executionTimeMs,
          timestamp: new Date(),
          retryCount,
        };
      } catch (error) {
        lastError = error as Error;
        retryCount++;

        this.logger.warn(
          `Step ${stepIndex} failed (attempt ${retryCount}/${maxRetries + 1}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );

        if (retryCount <= maxRetries) {
          const backoffMs = step.retry?.backoffMs || 1000;
          const delay = step.retry?.exponentialBackoff
            ? backoffMs * Math.pow(2, retryCount - 1)
            : backoffMs;

          this.logger.debug(
            `Retrying step ${stepIndex} in ${delay}ms (attempt ${retryCount + 1})`,
          );
          await this.sleep(delay);
        }
      }
    }

    const executionTimeMs = Date.now() - startTime;
    const errorMessage = lastError?.message || String(lastError);

    // Record failure event
    const event: SagaEvent = {
      id: uuidv4(),
      type: 'STEP_EXECUTED',
      stepIndex,
      stepName: step.name,
      timestamp: new Date(),
      status: 'FAILED',
      error: errorMessage,
    };
    sagaState.addEvent(event);

    this.logger.error(
      `Step ${stepIndex} failed after ${retryCount} retries: ${errorMessage}`,
    );

    return {
      stepIndex,
      stepName: step.name,
      success: false,
      error: errorMessage,
      executionTimeMs,
      timestamp: new Date(),
      retryCount,
    };
  }

  /**
   * Execute a promise with timeout
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutId: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.executionTimeouts.delete(timeoutId);
        reject(new Error(`Execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.executionTimeouts.set(timeoutId, timeout);

      promise
        .then((result) => {
          clearTimeout(timeout);
          this.executionTimeouts.delete(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          this.executionTimeouts.delete(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Check if a message has been processed before (idempotency)
   */
  isIdempotent(
    sagaState: SagaStateEntity,
    stepIndex: number,
    messageHash: string,
  ): boolean {
    const event = sagaState.eventHistory.find(
      (e) => e.stepIndex === stepIndex && e.type === 'STEP_EXECUTED' && e.status === 'SUCCESS',
    );
    return !!event;
  }

  /**
   * Cleanup timeouts on service shutdown
   */
  onModuleDestroy(): void {
    this.executionTimeouts.forEach((timeout) => {
      clearTimeout(timeout);
    });
    this.executionTimeouts.clear();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
