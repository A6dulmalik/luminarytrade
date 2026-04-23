import { Module, Global } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-store';

import { FixedWindowLimiter } from './strategies/fixed-window.limiter';
import { SlidingWindowLimiter } from './strategies/sliding-window.limiter';
import { TokenBucketLimiter } from './strategies/token-bucket.limiter';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { AdaptiveRateLimiterService } from './services/adaptive-rate-limiter.service';
import { IpFilterService } from './services/ip-filter.service';
import { RateLimitMetricsService } from './services/rate-limit-metrics.service';
import { RateLimitTierService } from './services/rate-limit-tier.service';
import { RateLimitingController } from './rate-limiting.controller';
import { SystemLoadMiddleware } from './middleware/system-load.middleware';

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const nodeEnv = configService.get<string>('NODE_ENV', 'development');
        if (nodeEnv === 'test') {
          return {
            ttl: 60000,
          };
        }

        const redisHost = configService.get<string>('REDIS_HOST', 'localhost');
        const redisPort = configService.get<number>('REDIS_PORT', 6379);
        const redisPassword = configService.get<string>('REDIS_PASSWORD');

        return {
          store: await redisStore({
            socket: {
              host: redisHost,
              port: redisPort,
            },
            password: redisPassword,
          }),
          ttl: 60000, // Default TTL 1 minute
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [
    FixedWindowLimiter,
    SlidingWindowLimiter,
    TokenBucketLimiter,
    AdaptiveRateLimiterService,
    IpFilterService,
    RateLimitMetricsService,
    RateLimitTierService,
    RateLimitGuard,
    SystemLoadMiddleware,
  ],
  controllers: [RateLimitingController],
  exports: [
    FixedWindowLimiter,
    SlidingWindowLimiter,
    TokenBucketLimiter,
    AdaptiveRateLimiterService,
    IpFilterService,
    RateLimitMetricsService,
  RateLimitTierService,
    RateLimitGuard,
    SystemLoadMiddleware,
  ],
})
export class RateLimitingModule {}
