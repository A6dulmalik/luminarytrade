import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  BadRequestException,
  NotFoundException,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiResponse, ApiParam } from '@nestjs/swagger';
import { SagaOrchestrator, SagaMetrics } from './saga-orchestrator.service';
import { SagaStateEntity, SagaDefinition, SagaPattern } from './saga-state.entity';
import { ExecutionResult } from './saga-executor';
import { CompensationResult } from './compensation-handler';

@ApiTags('sagas')
@Controller('sagas')
export class SagaController {
  constructor(private readonly sagaOrchestrator: SagaOrchestrator) {}

  /**
   * Start a new saga
   */
  @Post('start')
  @HttpCode(201)
  @ApiResponse({
    status: 201,
    description: 'Saga started successfully',
    schema: { properties: { sagaId: { type: 'string' } } },
  })
  async startSaga(
    @Body()
    body: {
      definition: SagaDefinition;
      context?: Record<string, any>;
      correlationId?: string;
    },
  ): Promise<{ sagaId: string }> {
    if (!body.definition) {
      throw new BadRequestException('Saga definition is required');
    }

    if (!body.definition.pattern) {
      throw new BadRequestException('Saga pattern (CHOREOGRAPHY or ORCHESTRATION) is required');
    }

    if (!Array.isArray(body.definition.steps) || body.definition.steps.length === 0) {
      throw new BadRequestException('At least one step is required');
    }

    const sagaId = await this.sagaOrchestrator.registerAndStartSaga(
      body.definition,
      body.context,
      body.correlationId,
    );

    return { sagaId };
  }

  /**
   * Get saga state and full history
   */
  @Get(':sagaId')
  @ApiParam({ name: 'sagaId', description: 'Saga ID' })
  @ApiResponse({
    status: 200,
    description: 'Saga state with full history',
    type: SagaStateEntity,
  })
  async getSagaState(
    @Param('sagaId') sagaId: string,
  ): Promise<SagaStateEntity> {
    const sagaState = await this.sagaOrchestrator.getSagaState(sagaId);

    if (!sagaState) {
      throw new NotFoundException(`Saga ${sagaId} not found`);
    }

    return sagaState;
  }

  /**
   * Get saga metrics
   */
  @Get(':sagaId/metrics')
  @ApiParam({ name: 'sagaId', description: 'Saga ID' })
  @ApiResponse({
    status: 200,
    description: 'Saga metrics including completion rate and duration',
    type: Object,
  })
  async getSagaMetrics(
    @Param('sagaId') sagaId: string,
  ): Promise<SagaMetrics> {
    const metrics = await this.sagaOrchestrator.getSagaMetrics(sagaId);

    if (!metrics) {
      throw new NotFoundException(`Saga ${sagaId} not found`);
    }

    return metrics;
  }

  /**
   * Get dead letter queue (failed sagas requiring manual intervention)
   */
  @Get('admin/dead-letter-queue')
  @ApiResponse({
    status: 200,
    description: 'List of failed sagas in dead letter queue',
    isArray: true,
    type: SagaStateEntity,
  })
  async getDeadLetterQueue(): Promise<SagaStateEntity[]> {
    return this.sagaOrchestrator.getDeadLetterQueue();
  }

  /**
   * Manual intervention: replay a failed step
   */
  @Post(':sagaId/replay-step/:stepIndex')
  @HttpCode(200)
  @ApiParam({ name: 'sagaId', description: 'Saga ID' })
  @ApiParam({ name: 'stepIndex', description: 'Step index to replay' })
  @ApiResponse({
    status: 200,
    description: 'Step replay result',
    type: Object,
  })
  async replayStep(
    @Param('sagaId') sagaId: string,
    @Param('stepIndex') stepIndex: string,
  ): Promise<ExecutionResult> {
    const stepIdx = parseInt(stepIndex, 10);

    if (isNaN(stepIdx)) {
      throw new BadRequestException('Invalid step index');
    }

    try {
      return await this.sagaOrchestrator.replayStep(sagaId, stepIdx);
    } catch (error) {
      throw new NotFoundException(
        error instanceof Error ? error.message : 'Failed to replay step',
      );
    }
  }

  /**
   * Manual intervention: skip compensation for a step
   */
  @Post(':sagaId/skip-compensation/:stepIndex')
  @HttpCode(200)
  @ApiParam({ name: 'sagaId', description: 'Saga ID' })
  @ApiParam({ name: 'stepIndex', description: 'Step index to skip compensation' })
  @ApiResponse({
    status: 200,
    description: 'Compensation skipped',
  })
  async skipCompensation(
    @Param('sagaId') sagaId: string,
    @Param('stepIndex') stepIndex: string,
  ): Promise<void> {
    const stepIdx = parseInt(stepIndex, 10);

    if (isNaN(stepIdx)) {
      throw new BadRequestException('Invalid step index');
    }

    try {
      await this.sagaOrchestrator.skipCompensation(sagaId, stepIdx);
    } catch (error) {
      throw new NotFoundException(
        error instanceof Error ? error.message : 'Failed to skip compensation',
      );
    }
  }

  /**
   * Manual intervention: replay compensation for a step
   */
  @Post(':sagaId/replay-compensation/:stepIndex')
  @HttpCode(200)
  @ApiParam({ name: 'sagaId', description: 'Saga ID' })
  @ApiParam({ name: 'stepIndex', description: 'Step index for compensation' })
  @ApiResponse({
    status: 200,
    description: 'Compensation replay result',
    type: Object,
  })
  async replayCompensation(
    @Param('sagaId') sagaId: string,
    @Param('stepIndex') stepIndex: string,
  ): Promise<CompensationResult> {
    const stepIdx = parseInt(stepIndex, 10);

    if (isNaN(stepIdx)) {
      throw new BadRequestException('Invalid step index');
    }

    try {
      return await this.sagaOrchestrator.replayCompensation(sagaId, stepIdx);
    } catch (error) {
      throw new NotFoundException(
        error instanceof Error ? error.message : 'Failed to replay compensation',
      );
    }
  }
}
