import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SagaStateEntity } from './saga-state.entity';
import { SagaOrchestrator } from './saga-orchestrator.service';
import { SagaExecutor } from './saga-executor';
import { CompensationHandler } from './compensation-handler';
import { SagaController } from './saga.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SagaStateEntity]), EventEmitterModule.forRoot()],
  providers: [SagaOrchestrator, SagaExecutor, CompensationHandler],
  exports: [SagaOrchestrator, SagaExecutor, CompensationHandler],
  controllers: [SagaController],
})
export class SagaModule {}
