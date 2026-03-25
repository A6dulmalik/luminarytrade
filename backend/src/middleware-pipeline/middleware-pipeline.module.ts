import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { MiddlewarePipeline } from './pipeline';
import { LoggingMiddleware } from './middlewares/logging.middleware';
import { AuthenticationMiddleware } from './middlewares/authentication.middleware';
import { ValidationMiddleware } from './middlewares/validation.middleware';
import { ErrorHandlingMiddleware } from './middlewares/error-handling.middleware';
import { RateLimitMiddleware } from './middlewares/rate-limit.middleware';
import { CorsMiddleware } from './middlewares/cors.middleware';
import { RequestLoggingMiddleware, PerformanceTracker } from './middlewares/request-logging.middleware';
import { RateLimitingModule } from '../rate-limiting/rate-limiting.module';
import { AuthModule } from '../auth/auth.module';
import { ResponseTransformInterceptor } from './interceptors/response-transform.interceptor';
import { RequestLogService } from './services/request-log.service';
import { RequestLogController } from './controllers/request-log.controller';
import { RequestLogEntity } from './entities/request-log.entity';

@Global()
@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    RateLimitingModule,
    AuthModule,
    TypeOrmModule.forFeature([RequestLogEntity]),
    ScheduleModule.forRoot(),
  ],
  controllers: [RequestLogController],
  providers: [
    MiddlewarePipeline,
    LoggingMiddleware,
    AuthenticationMiddleware,
    ValidationMiddleware,
    ErrorHandlingMiddleware,
    RateLimitMiddleware,
    CorsMiddleware,
    RequestLoggingMiddleware,
    RequestLogService,
    PerformanceTracker,
    ResponseTransformInterceptor,
  ],
  exports: [
    MiddlewarePipeline,
    LoggingMiddleware,
    AuthenticationMiddleware,
    ValidationMiddleware,
    ErrorHandlingMiddleware,
    RateLimitMiddleware,
    CorsMiddleware,
    RequestLoggingMiddleware,
    RequestLogService,
    PerformanceTracker,
    ResponseTransformInterceptor,
  ],
})
export class MiddlewarePipelineModule {}
