import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, Between, LessThan, MoreThan, IsNull, Not } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RequestLogEntity, RequestLogStatus, PerformanceMetrics } from '../entities/request-log.entity';
import {
  RequestLogFilterDto,
  DateRangeDto,
  SlowQueryThresholdDto,
  RequestLogResponseDto,
  PaginatedRequestLogResponseDto,
} from '../dto/request-log-filter.dto';

export interface CreateRequestLogData {
  requestId: string;
  correlationId?: string;
  parentRequestId?: string;
  tracePath?: string[];
  method: string;
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, any>;
  requestBody?: string;
  requestBodySize: number;
  statusCode: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseBodySize: number;
  responseTime: number;
  userId?: string;
  sessionId?: string;
  ipAddress: string;
  userAgent?: string;
  performanceMetrics: PerformanceMetrics;
  errorMessage?: string;
  errorStack?: string;
  errorDetails?: Record<string, any>;
}

export interface PerformanceSummary {
  totalRequests: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  errorRate: number;
  slowQueryCount: number;
  cacheHitRate: number;
}

@Injectable()
export class RequestLogService implements OnModuleInit {
  private readonly logger = new Logger(RequestLogService.name);
  private readonly SLOW_QUERY_THRESHOLD = 1000; // 1 second
  private readonly MAX_BODY_SIZE = 10 * 1024; // 10KB

  constructor(
    @InjectRepository(RequestLogEntity)
    private readonly requestLogRepository: Repository<RequestLogEntity>,
  ) {}

  onModuleInit() {
    this.logger.log('RequestLogService initialized with 30-day retention policy');
  }

  /**
   * Create a new request log entry
   */
  async createRequestLog(data: CreateRequestLogData): Promise<RequestLogEntity> {
    const startTime = Date.now();
    
    try {
      // Determine status based on response time and status code
      let status = RequestLogStatus.SUCCESS;
      if (data.statusCode >= 500) {
        status = RequestLogStatus.ERROR;
      } else if (data.statusCode >= 400) {
        status = RequestLogStatus.ERROR;
      } else if (data.responseTime >= this.SLOW_QUERY_THRESHOLD) {
        status = RequestLogStatus.SLOW;
      }

      // Truncate bodies if they exceed max size
      const requestBody = this.truncateBody(data.requestBody);
      const responseBody = this.truncateBody(data.responseBody);

      // Sanitize sensitive data from headers
      const sanitizedHeaders = this.sanitizeHeaders(data.headers || {});
      const sanitizedResponseHeaders = this.sanitizeHeaders(data.responseHeaders || {});

      const requestLog = this.requestLogRepository.create({
        ...data,
        requestBody,
        responseBody,
        headers: sanitizedHeaders,
        responseHeaders: sanitizedResponseHeaders,
        status,
      });

      const saved = await this.requestLogRepository.save(requestLog);
      
      const duration = Date.now() - startTime;
      if (duration > 2) {
        this.logger.warn(`Request log creation took ${duration}ms (threshold: 2ms)`);
      }

      return saved;
    } catch (error) {
      this.logger.error(`Failed to create request log: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get a single request log by requestId
   */
  async getRequestLog(requestId: string): Promise<RequestLogEntity | null> {
    return this.requestLogRepository.findOne({
      where: { requestId },
    });
  }

  /**
   * Search request logs with filters
   */
  async searchLogs(filter: RequestLogFilterDto): Promise<PaginatedRequestLogResponseDto> {
    const where: FindOptionsWhere<RequestLogEntity> = {};

    if (filter.requestId) {
      where.requestId = filter.requestId;
    }

    if (filter.userId) {
      where.userId = filter.userId;
    }

    if (filter.correlationId) {
      where.correlationId = filter.correlationId;
    }

    if (filter.method) {
      where.method = filter.method.toUpperCase();
    }

    if (filter.url) {
      where.url = filter.url;
    }

    if (filter.status) {
      where.status = filter.status;
    }

    if (filter.statusCode) {
      where.statusCode = filter.statusCode;
    }

    if (filter.ipAddress) {
      where.ipAddress = filter.ipAddress;
    }

    if (filter.sessionId) {
      where.sessionId = filter.sessionId;
    }

    if (filter.hasError !== undefined) {
      if (filter.hasError) {
        where.errorMessage = Not(IsNull());
      } else {
        where.errorMessage = IsNull();
      }
    }

    // Handle response time range
    if (filter.minResponseTime !== undefined || filter.maxResponseTime !== undefined) {
      if (filter.minResponseTime !== undefined && filter.maxResponseTime !== undefined) {
        where.responseTime = Between(filter.minResponseTime, filter.maxResponseTime);
      } else if (filter.minResponseTime !== undefined) {
        where.responseTime = MoreThan(filter.minResponseTime);
      } else if (filter.maxResponseTime !== undefined) {
        where.responseTime = LessThan(filter.maxResponseTime);
      }
    }

    // Handle date range
    if (filter.startDate || filter.endDate) {
      where.createdAt = Between(
        filter.startDate || new Date(0),
        filter.endDate || new Date(),
      );
    }

    const [logs, total] = await this.requestLogRepository.findAndCount({
      where,
      order: { [filter.sortBy || 'createdAt']: filter.sortOrder || 'DESC' },
      take: filter.limit || 50,
      skip: filter.offset || 0,
    });

    return {
      logs: logs.map(this.toResponseDto),
      total,
      limit: filter.limit || 50,
      offset: filter.offset || 0,
    };
  }

  /**
   * Get slow queries exceeding threshold
   */
  async getSlowQueries(threshold: number, limit: number = 50): Promise<RequestLogResponseDto[]> {
    const logs = await this.requestLogRepository.find({
      where: {
        responseTime: MoreThan(threshold),
      },
      order: { responseTime: 'DESC' },
      take: limit,
    });

    return logs.map(this.toResponseDto);
  }

  /**
   * Get error requests within date range
   */
  async getErrorRequests(dateRange: DateRangeDto): Promise<RequestLogResponseDto[]> {
    const logs = await this.requestLogRepository.find({
      where: {
        createdAt: Between(dateRange.startDate, dateRange.endDate),
        errorMessage: Not(IsNull()),
      },
      order: { createdAt: 'DESC' },
    });

    return logs.map(this.toResponseDto);
  }

  /**
   * Get performance summary for a date range
   */
  async getPerformanceSummary(dateRange: DateRangeDto): Promise<PerformanceSummary> {
    const logs = await this.requestLogRepository.find({
      where: {
        createdAt: Between(dateRange.startDate, dateRange.endDate),
      },
    });

    if (logs.length === 0) {
      return {
        totalRequests: 0,
        avgResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        errorRate: 0,
        slowQueryCount: 0,
        cacheHitRate: 0,
      };
    }

    const responseTimes = logs.map(l => l.responseTime).sort((a, b) => a - b);
    const errorCount = logs.filter(l => l.status === RequestLogStatus.ERROR).length;
    const slowCount = logs.filter(l => l.responseTime >= this.SLOW_QUERY_THRESHOLD).length;
    
    const totalCacheHits = logs.reduce((sum, l) => sum + (l.performanceMetrics?.cacheHits || 0), 0);
    const totalCacheMisses = logs.reduce((sum, l) => sum + (l.performanceMetrics?.cacheMisses || 0), 0);
    const totalCacheOps = totalCacheHits + totalCacheMisses;

    return {
      totalRequests: logs.length,
      avgResponseTime: responseTimes.reduce((a, b) => a + b, 0) / logs.length,
      p95ResponseTime: this.calculatePercentile(responseTimes, 0.95),
      p99ResponseTime: this.calculatePercentile(responseTimes, 0.99),
      errorRate: (errorCount / logs.length) * 100,
      slowQueryCount: slowCount,
      cacheHitRate: totalCacheOps > 0 ? (totalCacheHits / totalCacheOps) * 100 : 0,
    };
  }

  /**
   * Get correlated requests by correlationId
   */
  async getCorrelatedRequests(correlationId: string): Promise<RequestLogResponseDto[]> {
    const logs = await this.requestLogRepository.find({
      where: { correlationId },
      order: { createdAt: 'ASC' },
    });

    return logs.map(this.toResponseDto);
  }

  /**
   * Clean up old logs (runs daily at 2 AM)
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupOldLogs(): Promise<void> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await this.requestLogRepository.softDelete({
      createdAt: LessThan(thirtyDaysAgo),
    });

    this.logger.log(`Cleaned up ${result.affected || 0} old request logs`);
  }

  /**
   * Truncate body if it exceeds max size
   */
  private truncateBody(body: string | undefined): string | undefined {
    if (!body) return undefined;
    if (body.length <= this.MAX_BODY_SIZE) return body;
    return body.substring(0, this.MAX_BODY_SIZE) + `... [truncated, total: ${body.length} chars]`;
  }

  /**
   * Sanitize sensitive headers
   */
  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
    const sanitized = { ...headers };

    for (const key of Object.keys(sanitized)) {
      if (sensitiveHeaders.some(sh => key.toLowerCase().includes(sh))) {
        sanitized[key] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  /**
   * Convert entity to response DTO
   */
  private toResponseDto(entity: RequestLogEntity): RequestLogResponseDto {
    return {
      id: entity.id,
      requestId: entity.requestId,
      correlationId: entity.correlationId,
      parentRequestId: entity.parentRequestId,
      method: entity.method,
      url: entity.url,
      statusCode: entity.statusCode,
      status: entity.status,
      responseTime: entity.responseTime,
      userId: entity.userId,
      sessionId: entity.sessionId,
      ipAddress: entity.ipAddress,
      createdAt: entity.createdAt,
      hasError: !!entity.errorMessage,
    };
  }

  /**
   * Calculate percentile from sorted array
   */
  private calculatePercentile(sortedArray: number[], percentile: number): number {
    const index = Math.ceil(sortedArray.length * percentile) - 1;
    return sortedArray[Math.max(0, index)];
  }
}