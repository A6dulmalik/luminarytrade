import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  DeleteDateColumn,
} from 'typeorm';

export enum RequestLogStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  SLOW = 'slow',
  TIMEOUT = 'timeout',
}

export interface PerformanceMetrics {
  dbQueriesCount: number;
  dbQueriesTimeMs: number;
  cacheHits: number;
  cacheMisses: number;
  externalApiCalls: number;
  externalApiTimeMs: number;
  memoryUsageMB: number;
  cpuUsagePercent?: number;
}

export interface RequestLogMetadata {
  userId?: string;
  sessionId?: string;
  requestId: string;
  ipAddress: string;
  userAgent: string;
  correlationId?: string;
  parentRequestId?: string;
  tracePath?: string[];
}

@Entity('request_logs')
@Index(['requestId'], { unique: true })
@Index(['userId'])
@Index(['status'])
@Index(['method', 'url'])
@Index(['createdAt'])
@Index(['responseTime'])
@Index(['correlationId'])
@Index(['parentRequestId'])
@Index(['createdAt', 'status'])
export class RequestLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  requestId: string;

  @Column({ nullable: true })
  correlationId: string;

  @Column({ nullable: true })
  parentRequestId: string;

  @Column({ type: 'simple-array', nullable: true })
  tracePath: string[];

  @Column()
  method: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'simple-json', nullable: true })
  headers: Record<string, string>;

  @Column({ type: 'simple-json', nullable: true })
  queryParams: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  requestBody: string;

  @Column({ type: 'int' })
  requestBodySize: number;

  @Column({ type: 'int' })
  statusCode: number;

  @Column({
    type: 'enum',
    enum: RequestLogStatus,
    default: RequestLogStatus.SUCCESS,
  })
  status: RequestLogStatus;

  @Column({ type: 'simple-json', nullable: true })
  responseHeaders: Record<string, string>;

  @Column({ type: 'text', nullable: true })
  responseBody: string;

  @Column({ type: 'int' })
  responseBodySize: number;

  @Column({ type: 'int' })
  responseTime: number;

  @Column({ nullable: true })
  userId: string;

  @Column({ nullable: true })
  sessionId: string;

  @Column()
  ipAddress: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string;

  @Column({ type: 'simple-json' })
  performanceMetrics: PerformanceMetrics;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @Column({ type: 'simple-json', nullable: true })
  errorStack: string;

  @Column({ type: 'simple-json', nullable: true })
  errorDetails: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
