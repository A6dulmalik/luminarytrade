import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RequestLogService, PerformanceSummary } from '../services/request-log.service';
import {
  RequestLogFilterDto,
  DateRangeDto,
  SlowQueryThresholdDto,
  PaginatedRequestLogResponseDto,
  RequestLogResponseDto,
} from '../dto/request-log-filter.dto';
import { RequestLogEntity } from '../entities/request-log.entity';

// Simple admin guard - in production, use proper RBAC
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    // Check for admin role in user object
    // This is a placeholder - implement proper admin check based on your auth system
    const user = request.user;
    return user?.role === 'admin' || user?.isAdmin === true;
  }
}

@Controller('logs/requests')
@UseGuards(AdminGuard)
export class RequestLogController {
  constructor(private readonly requestLogService: RequestLogService) {}

  /**
   * Search request logs with filters
   * GET /logs/requests?userId=xxx&status=error&startDate=2024-01-01
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async searchLogs(
    @Query() filter: RequestLogFilterDto,
  ): Promise<PaginatedRequestLogResponseDto> {
    return this.requestLogService.searchLogs(filter);
  }

  /**
   * Get a specific request log by requestId
   * GET /logs/requests/:requestId
   */
  @Get(':requestId')
  @HttpCode(HttpStatus.OK)
  async getRequestLog(
    @Param('requestId') requestId: string,
  ): Promise<RequestLogEntity | null> {
    return this.requestLogService.getRequestLog(requestId);
  }

  /**
   * Get slow queries exceeding threshold
   * GET /logs/requests/slow-queries?threshold=1000&limit=50
   */
  @Get('slow-queries')
  @HttpCode(HttpStatus.OK)
  async getSlowQueries(
    @Query() params: SlowQueryThresholdDto,
  ): Promise<RequestLogResponseDto[]> {
    return this.requestLogService.getSlowQueries(params.threshold, params.limit);
  }

  /**
   * Get error requests within date range
   * GET /logs/requests/errors?startDate=2024-01-01&endDate=2024-01-31
   */
  @Get('errors')
  @HttpCode(HttpStatus.OK)
  async getErrorRequests(
    @Query() dateRange: DateRangeDto,
  ): Promise<RequestLogResponseDto[]> {
    return this.requestLogService.getErrorRequests(dateRange);
  }

  /**
   * Get performance summary for a date range
   * GET /logs/requests/performance-summary?startDate=2024-01-01&endDate=2024-01-31
   */
  @Get('performance-summary')
  @HttpCode(HttpStatus.OK)
  async getPerformanceSummary(
    @Query() dateRange: DateRangeDto,
  ): Promise<PerformanceSummary> {
    return this.requestLogService.getPerformanceSummary(dateRange);
  }

  /**
   * Get correlated requests by correlationId
   * GET /logs/requests/correlated/:correlationId
   */
  @Get('correlated/:correlationId')
  @HttpCode(HttpStatus.OK)
  async getCorrelatedRequests(
    @Param('correlationId') correlationId: string,
  ): Promise<RequestLogResponseDto[]> {
    return this.requestLogService.getCorrelatedRequests(correlationId);
  }
}
