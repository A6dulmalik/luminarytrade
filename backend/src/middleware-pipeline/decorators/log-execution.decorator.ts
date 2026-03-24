import { Logger } from '@nestjs/common';

export interface LogExecutionOptions {
  /** Log level: 'log', 'debug', 'verbose', 'warn', 'error' */
  level?: 'log' | 'debug' | 'verbose' | 'warn' | 'error';
  /** Custom message prefix */
  prefix?: string;
  /** Whether to log arguments */
  logArgs?: boolean;
  /** Whether to log return value */
  logReturn?: boolean;
  /** Whether to log execution time */
  logTime?: boolean;
  /** Threshold in ms above which to warn about slow execution */
  slowThreshold?: number;
  /** Function to sanitize arguments before logging */
  sanitizeArgs?: (args: any[]) => any[];
  /** Function to sanitize return value before logging */
  sanitizeReturn?: (result: any) => any;
  /** Whether to log errors */
  logErrors?: boolean;
}

const defaultOptions: LogExecutionOptions = {
  level: 'debug',
  logArgs: false,
  logReturn: false,
  logTime: true,
  slowThreshold: 1000,
  logErrors: true,
};

/**
 * Decorator to log method execution with timing and optional argument/return logging
 * 
 * @example
 * ```typescript
 * @LogExecution({ level: 'log', logTime: true })
 * async processData(data: any) {
 *   // method implementation
 * }
 * 
 * @LogExecution({ 
 *   prefix: 'Database',
 *   slowThreshold: 500,
 *   sanitizeArgs: (args) => args.map(a => typeof a === 'object' ? { ...a, password: '***' } : a)
 * })
 * async saveUser(user: User) {
 *   // method implementation
 * }
 * ```
 */
export function LogExecution(options: LogExecutionOptions = {}) {
  const config = { ...defaultOptions, ...options };

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;
    const logger = new Logger(className);

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      const methodName = propertyKey;
      const prefix = config.prefix ? `[${config.prefix}] ` : '';

      // Log method entry
      if (config.logArgs && config.sanitizeArgs) {
        const sanitizedArgs = config.sanitizeArgs(args);
        logger[config.level](`${prefix}${methodName} called with args: ${JSON.stringify(sanitizedArgs)}`);
      } else if (config.logArgs) {
        logger[config.level](`${prefix}${methodName} called with ${args.length} arguments`);
      } else {
        logger[config.level](`${prefix}${methodName} started`);
      }

      try {
        const result = await originalMethod.apply(this, args);
        const executionTime = Date.now() - startTime;

        // Check if execution was slow
        const isSlow = config.slowThreshold && executionTime >= config.slowThreshold;
        const timeMessage = config.logTime ? ` (${executionTime}ms)` : '';

        if (isSlow) {
          logger.warn(
            `${prefix}${methodName} completed slowly${timeMessage} - exceeded threshold of ${config.slowThreshold}ms`
          );
        } else if (config.logReturn && config.sanitizeReturn) {
          const sanitizedResult = config.sanitizeReturn(result);
          logger[config.level](
            `${prefix}${methodName} completed${timeMessage} with result: ${JSON.stringify(sanitizedResult)}`
          );
        } else if (config.logReturn) {
          logger[config.level](`${prefix}${methodName} completed${timeMessage} with result`);
        } else {
          logger[config.level](`${prefix}${methodName} completed${timeMessage}`);
        }

        return result;
      } catch (error) {
        const executionTime = Date.now() - startTime;
        const timeMessage = config.logTime ? ` after ${executionTime}ms` : '';

        if (config.logErrors) {
          logger.error(
            `${prefix}${methodName} failed${timeMessage}: ${error.message}`,
            error.stack
          );
        }

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Decorator to track performance metrics for database operations
 * Automatically updates request performance metrics if available
 * 
 * @example
 * ```typescript
 * @TrackDbQuery('user_lookup')
 * async findUserById(id: string) {
 *   return this.userRepository.findOne({ where: { id } });
 * }
 * ```
 */
export function TrackDbQuery(operationName?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const name = operationName || propertyKey;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      
      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;
        
        // Update metrics if request context is available
        const req = (global as any).currentRequest;
        if (req?.performanceMetrics) {
          req.performanceMetrics.dbQueriesCount++;
          req.performanceMetrics.dbQueriesTimeMs += duration;
        }

        // Log slow queries
        if (duration >= 100) {
          const logger = new Logger(target.constructor.name);
          logger.warn(`Slow DB query [${name}]: ${duration}ms`);
        }

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        const logger = new Logger(target.constructor.name);
        logger.error(`DB query [${name}] failed after ${duration}ms: ${error.message}`);
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Decorator to track external API calls
 * 
 * @example
 * ```typescript
 * @TrackExternalApi('payment_gateway')
 * async processPayment(paymentData: any) {
 *   return this.httpService.post('/payments', paymentData);
 * }
 * ```
 */
export function TrackExternalApi(apiName: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const logger = new Logger(target.constructor.name);

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      
      logger.debug(`External API call [${apiName}] started`);

      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;
        
        // Update metrics if request context is available
        const req = (global as any).currentRequest;
        if (req?.performanceMetrics) {
          req.performanceMetrics.externalApiCalls++;
          req.performanceMetrics.externalApiTimeMs += duration;
        }

        logger.debug(`External API call [${apiName}] completed in ${duration}ms`);

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(
          `External API call [${apiName}] failed after ${duration}ms: ${error.message}`
        );
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Decorator to skip request logging for specific methods
 * 
 * @example
 * ```typescript
 * @SkipRequestLog()
 * @Get('health')
 * healthCheck() {
 *   return { status: 'ok' };
 * }
 * ```
 */
export function SkipRequestLog() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    // Mark the method to skip logging
    descriptor.value.skipRequestLog = true;
    return descriptor;
  };
}

/**
 * Decorator to mark a method as a cacheable operation
 * Automatically tracks cache hits/misses
 * 
 * @example
 * ```typescript
 * @Cacheable('user_cache', 3600)
 * async getUserById(id: string) {
 *   return this.userRepository.findOne({ where: { id } });
 * }
 * ```
 */
export function Cacheable(cacheName: string, ttlSeconds?: number) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const logger = new Logger(target.constructor.name);

    descriptor.value = async function (...args: any[]) {
      const cacheKey = `${cacheName}:${JSON.stringify(args)}`;
      const startTime = Date.now();

      try {
        // Check cache (implementation depends on your cache service)
        const cached = await checkCache(cacheKey);
        
        if (cached !== undefined) {
          // Cache hit
          const req = (global as any).currentRequest;
          if (req?.performanceMetrics) {
            req.performanceMetrics.cacheHits++;
          }
          logger.debug(`Cache hit [${cacheName}]: ${Date.now() - startTime}ms`);
          return cached;
        }

        // Cache miss - execute method
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;

        // Update metrics
        const req = (global as any).currentRequest;
        if (req?.performanceMetrics) {
          req.performanceMetrics.cacheMisses++;
        }

        // Store in cache
        await storeInCache(cacheKey, result, ttlSeconds);

        logger.debug(`Cache miss [${cacheName}]: ${duration}ms`);
        return result;
      } catch (error) {
        logger.error(`Cache operation [${cacheName}] failed: ${error.message}`);
        // Fallback to original method
        return originalMethod.apply(this, args);
      }
    };

    return descriptor;
  };
}

// Placeholder functions - these should be implemented based on your cache service
async function checkCache(key: string): Promise<any> {
  // Implementation depends on your cache service
  return undefined;
}

async function storeInCache(key: string, value: any, ttl?: number): Promise<void> {
  // Implementation depends on your cache service
}