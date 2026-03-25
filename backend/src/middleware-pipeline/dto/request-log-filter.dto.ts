import { IsOptional, IsString, IsEnum, IsDate, IsInt, Min, Max, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { RequestLogStatus } from '../entities/request-log.entity';

export class RequestLogFilterDto {
  @IsOptional()
  @IsString()
  requestId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsEnum(RequestLogStatus)
  status?: RequestLogStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  statusCode?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minResponseTime?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  maxResponseTime?: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  startDate?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  endDate?: Date;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasError?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}

export class DateRangeDto {
  @IsDate()
  @Type(() => Date)
  startDate: Date;

  @IsDate()
  @Type(() => Date)
  endDate: Date;
}

export class SlowQueryThresholdDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  threshold: number = 1000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}

export class RequestLogResponseDto {
  id: string;
  requestId: string;
  correlationId?: string;
  parentRequestId?: string;
  method: string;
  url: string;
  statusCode: number;
  status: RequestLogStatus;
  responseTime: number;
  userId?: string;
  sessionId?: string;
  ipAddress: string;
  createdAt: Date;
  hasError: boolean;
}

export class PaginatedRequestLogResponseDto {
  logs: RequestLogResponseDto[];
  total: number;
  limit: number;
  offset: number;
}
