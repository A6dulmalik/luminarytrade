import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type UserTier = 'free' | 'pro' | 'enterprise';

export interface TierLimits {
  windowMs: number;
  maxRequests: number;
  burstSize?: number;
}

@Injectable()
export class RateLimitTierService {
  constructor(private config: ConfigService) {}

  getTierForUser(userId?: string): UserTier {
    // In a real implementation, look up user's subscription/plan from DB
    // For now, default to 'free' and allow per-user override via env var: RATE_LIMIT_TIER_<USERID>=pro
    if (!userId) return 'free';

    const envKey = `RATE_LIMIT_TIER_${userId.toUpperCase()}`;
    const tier = (this.config.get<string>(envKey) || this.config.get<string>('DEFAULT_RATE_LIMIT_TIER') || 'free') as UserTier;
    if (['free', 'pro', 'enterprise'].includes(tier)) return tier;
    return 'free';
  }

  getLimitsForTier(tier: UserTier): TierLimits {
    // Defaults — can be tuned or provided via env
    const defaults: Record<UserTier, TierLimits> = {
      free: { windowMs: 60_000, maxRequests: 60, burstSize: 60 },
      pro: { windowMs: 60_000, maxRequests: 600, burstSize: 100 },
      enterprise: { windowMs: 60_000, maxRequests: 6000, burstSize: 1000 },
    };

    // Allow env override: RATE_LIMIT_FREE_MAX, RATE_LIMIT_PRO_MAX, RATE_LIMIT_ENTERPRISE_MAX
    const getOverride = (key: string, fallback: number) => {
      const v = this.config.get<string | number>(key);
      if (!v) return fallback;
      const n = Number(v);
      return Number.isNaN(n) ? fallback : n;
    };

    const freeMax = getOverride('RATE_LIMIT_FREE_MAX', defaults.free.maxRequests);
    const proMax = getOverride('RATE_LIMIT_PRO_MAX', defaults.pro.maxRequests);
    const entMax = getOverride('RATE_LIMIT_ENTERPRISE_MAX', defaults.enterprise.maxRequests);

    return {
      free: { ...defaults.free, maxRequests: freeMax },
      pro: { ...defaults.pro, maxRequests: proMax },
      enterprise: { ...defaults.enterprise, maxRequests: entMax },
    }[tier];
  }
}
