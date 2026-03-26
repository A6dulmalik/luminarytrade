import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum SagaStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  COMPENSATING = 'COMPENSATING',
  COMPENSATED = 'COMPENSATED',
  FAILED = 'FAILED',
}

export enum SagaPattern {
  CHOREOGRAPHY = 'CHOREOGRAPHY',
  ORCHESTRATION = 'ORCHESTRATION',
}

export interface SagaEvent {
  id: string;
  type: string;
  stepIndex: number;
  stepName: string;
  timestamp: Date;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'COMPENSATING' | 'COMPENSATED';
  result?: any;
  error?: string;
  compensationResult?: any;
  compensationError?: string;
}

export interface SagaStepDefinition {
  name: string;
  action: (context: any) => Promise<any>;
  compensation: (context: any, result: any) => Promise<void>;
  timeout: number;
  retry?: {
    maxRetries: number;
    backoffMs: number;
    exponentialBackoff?: boolean;
  };
}

export interface SagaDefinition {
  id: string;
  name: string;
  version: string;
  pattern: SagaPattern;
  steps: SagaStepDefinition[];
  timeout: number;
  metadata?: Record<string, any>;
}

@Entity('saga_states')
@Index(['sagaId'], { unique: true })
@Index(['status'])
@Index(['createdAt'])
export class SagaStateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  sagaId: string;

  @Column('varchar', { length: 255 })
  name: string;

  @Column({
    type: 'enum',
    enum: SagaStatus,
    default: SagaStatus.PENDING,
  })
  status: SagaStatus;

  @Column({
    type: 'enum',
    enum: SagaPattern,
    default: SagaPattern.ORCHESTRATION,
  })
  pattern: SagaPattern;

  @Column('int')
  currentStepIndex: number = -1;

  @Column('int')
  totalSteps: number = 0;

  @Column('json')
  sagaDefinition: SagaDefinition;

  @Column('json')
  context: Record<string, any> = {};

  @Column('json', { default: () => "'[]'" })
  eventHistory: SagaEvent[] = [];

  @Column('json', { nullable: true })
  compensatedSteps: number[] = [];

  @Column('int', { default: 0 })
  retryCount: number = 0;

  @Column('int', { nullable: true })
  timeoutAt?: number;

  @Column('varchar', { nullable: true })
  failureReason?: string;

  @Column('varchar', { nullable: true })
  deadLetterQueueId?: string;

  @Column('json', { nullable: true })
  metadata?: Record<string, any>;

  @Column('uuid', { nullable: true })
  correlationId?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Helper methods
  isCompleted(): boolean {
    return this.status === SagaStatus.COMPLETED;
  }

  isFailed(): boolean {
    return this.status === SagaStatus.FAILED;
  }

  isCompensated(): boolean {
    return this.status === SagaStatus.COMPENSATED;
  }

  isCompensating(): boolean {
    return this.status === SagaStatus.COMPENSATING;
  }

  addEvent(event: SagaEvent): void {
    this.eventHistory.push(event);
  }

  getLastEvent(): SagaEvent | undefined {
    return this.eventHistory[this.eventHistory.length - 1];
  }

  markStepAsCompensated(stepIndex: number): void {
    if (!this.compensatedSteps) {
      this.compensatedSteps = [];
    }
    if (!this.compensatedSteps.includes(stepIndex)) {
      this.compensatedSteps.push(stepIndex);
    }
  }

  getCompensatedStepCount(): number {
    return this.compensatedSteps?.length || 0;
  }

  hasTimedOut(now: Date = new Date()): boolean {
    if (!this.timeoutAt) return false;
    return now.getTime() > this.timeoutAt;
  }

  /**
   * Creates a snapshot for recovery
   */
  createSnapshot(): {
    sagaId: string;
    currentStepIndex: number;
    context: Record<string, any>;
    compensatedSteps: number[];
    status: SagaStatus;
    timestamp: Date;
  } {
    return {
      sagaId: this.sagaId,
      currentStepIndex: this.currentStepIndex,
      context: { ...this.context },
      compensatedSteps: [...(this.compensatedSteps || [])],
      status: this.status,
      timestamp: new Date(),
    };
  }

  /**
   * Restores from a snapshot for recovery
   */
  restoreFromSnapshot(snapshot: ReturnType<SagaStateEntity['createSnapshot']>): void {
    this.currentStepIndex = snapshot.currentStepIndex;
    this.context = { ...snapshot.context };
    this.compensatedSteps = [...snapshot.compensatedSteps];
    this.status = snapshot.status;
  }
}
