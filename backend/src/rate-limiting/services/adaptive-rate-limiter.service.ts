import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  IRateLimiter,
  RateLimitResult,
  RateLimiterOptions,
  SystemLoadMetrics,
  AdaptiveRateLimitConfig,
  ReputationScore,
} from '../interfaces/rate-limiter.interface';
import { TokenBucketLimiter } from '../strategies/token-bucket.limiter';
import { adaptiveConfig } from '../config/rate-limit.config';

@Injectable()
export class AdaptiveRateLimiterService implements IRateLimiter {
  private readonly loadHistory: SystemLoadMetrics[] = [];
  private readonly maxHistorySize = 100;
  private currentMultiplier = 1.0;

  constructor(
    @Inject(CACHE_MANAGER) private cache: Cache,
    private tokenBucketLimiter: TokenBucketLimiter,
  ) {}

  async check(
    key: string,
    options: Partial<RateLimiterOptions> = {},
  ): Promise<RateLimitResult> {
    const adjustedOptions = await this.getAdjustedOptions(options);
    return this.tokenBucketLimiter.check(key, adjustedOptions);
  }

  async reset(key: string, options: Partial<RateLimiterOptions> = {}): Promise<void> {
    return this.tokenBucketLimiter.reset(key, options);
  }

  async recordSystemLoad(metrics: SystemLoadMetrics): Promise<void> {
    this.loadHistory.push(metrics);

    if (this.loadHistory.length > this.maxHistorySize) {
      this.loadHistory.shift();
    }

    await this.adjustLimitsBasedOnLoad();
  }

  private async adjustLimitsBasedOnLoad(): Promise<void> {
    if (this.loadHistory.length < 10) return;

    const recentMetrics = this.loadHistory.slice(-10);
    const avgCpuUsage = recentMetrics.reduce((sum, m) => sum + m.cpuUsage, 0) / recentMetrics.length;
    const avgMemoryUsage = recentMetrics.reduce((sum, m) => sum + m.memoryUsage, 0) / recentMetrics.length;
    const avgRequestRate = recentMetrics.reduce((sum, m) => sum + m.requestRate, 0) / recentMetrics.length;

    const { loadThresholds } = adaptiveConfig;

    if (avgCpuUsage > loadThresholds.high || avgMemoryUsage > loadThresholds.high) {
      this.currentMultiplier = 0.5; // Reduce limits by 50%
    } else if (avgCpuUsage > loadThresholds.medium || avgMemoryUsage > loadThresholds.medium) {
      this.currentMultiplier = 0.75; // Reduce limits by 25%
    } else if (avgCpuUsage < loadThresholds.low && avgMemoryUsage < loadThresholds.low) {
      this.currentMultiplier = 1.25; // Increase limits by 25%
    } else {
      this.currentMultiplier = 1.0; // Normal limits
    }

    await this.cache.set('ratelimit:adaptive:multiplier', this.currentMultiplier, 60000);
  }

  private async getAdjustedOptions(
    options: Partial<RateLimiterOptions> & { burstSize?: number },
  ): Promise<Partial<RateLimiterOptions> & { burstSize?: number }> {
    const storedMultiplier = await this.cache.get<number>('ratelimit:adaptive:multiplier');
    const multiplier = storedMultiplier ?? this.currentMultiplier;

    const baseMaxRequests = options.maxRequests || adaptiveConfig.maxRequests;
    const minRequests = adaptiveConfig.minRequests;
    const maxRequestsAdaptive = adaptiveConfig.maxRequestsAdaptive;

    const adjustedMaxRequests = Math.max(
      minRequests,
      Math.min(maxRequestsAdaptive, Math.floor(baseMaxRequests * multiplier)),
    );

    return {
      ...options,
      maxRequests: adjustedMaxRequests,
      windowMs: options.windowMs || adaptiveConfig.windowMs,
      keyPrefix: options.keyPrefix || adaptiveConfig.keyPrefix,
      burstSize: (options as any).burstSize,
    };
  }

  async updateReputation(
    userId: string,
    isViolation: boolean,
    isGoodRequest: boolean,
  ): Promise<ReputationScore> {
    const key = `reputation:${userId}`;
    const current = await this.cache.get<ReputationScore>(key);

    const now = new Date();
    let reputation: ReputationScore;

    if (!current) {
      reputation = {
        userId,
        score: 100,
        goodRequests: isGoodRequest ? 1 : 0,
        violations: isViolation ? 1 : 0,
        lastUpdated: now,
      };
    } else {
      const goodRequests = current.goodRequests + (isGoodRequest ? 1 : 0);
      const violations = current.violations + (isViolation ? 1 : 0);
      const totalRequests = goodRequests + violations;

      // Calculate reputation score (0-100)
      const violationRate = violations / Math.max(totalRequests, 1);
      const score = Math.max(0, Math.min(100, 100 - (violationRate * 100)));

      reputation = {
        userId,
        score,
        goodRequests,
        violations,
        lastUpdated: now,
      };
    }

    await this.cache.set(key, reputation, 24 * 60 * 60 * 1000); // 24 hours
    return reputation;
  }

  async getReputation(userId: string): Promise<ReputationScore | null> {
    return this.cache.get<ReputationScore>(`reputation:${userId}`);
  }

  async getCurrentMultiplier(): Promise<number> {
    const stored = await this.cache.get<number>('ratelimit:adaptive:multiplier');
    return stored ?? this.currentMultiplier;
  }
}
