import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RequestLogService } from '../services/request-log.service';
import { PerformanceMetrics } from '../entities/request-log.entity';

// Extend Express Request to include our custom properties
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      correlationId?: string;
      parentRequestId?: string;
      tracePath?: string[];
      userId?: string;
      sessionId?: string;
      performanceMetrics?: PerformanceMetrics;
      requestStartTime?: number;
    }
  }
}

export interface RequestLoggingConfig {
  enabled?: boolean;
  logRequestBody?: boolean;
  logResponseBody?: boolean;
  maxBodySize?: number;
  excludePaths?: string[];
  includeHeaders?: string[];
  excludeHeaders?: string[];
}

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('RequestLogging');
  private config: RequestLoggingConfig = {
    enabled: true,
    logRequestBody: true,
    logResponseBody: true,
    maxBodySize: 10 * 1024, // 10KB
    excludePaths: ['/health', '/metrics', '/favicon.ico'],
    includeHeaders: [],
    excludeHeaders: ['authorization', 'cookie', 'x-api-key'],
  };

  constructor(private readonly requestLogService: RequestLogService) {}

  configure(config: Partial<RequestLoggingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.config.enabled) {
      return next();
    }

    // Skip excluded paths
    if (this.config.excludePaths?.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Initialize request tracking
    const requestStartTime = Date.now();
    req.requestStartTime = requestStartTime;

    // Generate or propagate correlation IDs
    const requestId = (req.headers['x-request-id'] as string) || uuidv4();
    const correlationId = (req.headers['x-correlation-id'] as string) || requestId;
    const parentRequestId = req.headers['x-parent-request-id'] as string;
    const tracePath = req.headers['x-trace-path'] ? 
      (req.headers['x-trace-path'] as string).split(',') : 
      [];

    req.requestId = requestId;
    req.correlationId = correlationId;
    req.parentRequestId = parentRequestId;
    req.tracePath = [...tracePath, requestId];

    // Initialize performance metrics
    const performanceMetrics: PerformanceMetrics = {
      dbQueriesCount: 0,
      dbQueriesTimeMs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      externalApiCalls: 0,
      externalApiTimeMs: 0,
      memoryUsageMB: 0,
    };
    req.performanceMetrics = performanceMetrics;

    // Capture initial memory usage
    const initialMemory = process.memoryUsage();

    // Set request ID in response headers
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Correlation-Id', correlationId);

    // Capture request body
    let requestBody: string | undefined;
    if (this.config.logRequestBody && req.body) {
      requestBody = this.safeStringify(req.body);
    }

    // Capture response body by intercepting write/end methods
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    let responseBody = '';

    res.write = function(chunk: any, ...args: any[]): boolean {
      responseBody += chunk?.toString() || '';
      return originalWrite(chunk, ...args);
    };

    res.end = (chunk?: any, ...args: any[]): Response => {
      if (chunk) {
        responseBody += chunk.toString();
      }
      return originalEnd(chunk, ...args);
    };

    // Handle response finish
    res.on('finish', async () => {
      try {
        const responseTime = Date.now() - requestStartTime;
        const finalMemory = process.memoryUsage();
        
        // Update memory usage in metrics
        performanceMetrics.memoryUsageMB = Math.round(
          (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024
        );

        // Set performance headers
        res.setHeader('X-Response-Time', `${responseTime}ms`);
        res.setHeader('X-Cache-Status', this.getCacheStatus(performanceMetrics));
        res.setHeader('X-DB-Queries', performanceMetrics.dbQueriesCount.toString());

        // Extract user info from request
        const userId = req.userId || (req as any).user?.id;
        const sessionId = req.sessionId || (req as any).session?.id;

        // Get client IP
        const ipAddress = this.getClientIp(req);

        // Get user agent
        const userAgent = req.headers['user-agent'] || '';

        // Prepare headers
        const headers = this.filterHeaders(req.headers as Record<string, string>);
        const responseHeaders = this.filterHeaders(res.getHeaders() as Record<string, string>);

        // Truncate response body if needed
        const truncatedResponseBody = this.config.logResponseBody ? 
          this.truncateBody(responseBody) : 
          undefined;

        // Create request log
        await this.requestLogService.createRequestLog({
          requestId,
          correlationId,
          parentRequestId,
          tracePath: req.tracePath,
          method: req.method,
          url: req.originalUrl || req.url,
          headers,
          queryParams: req.query as Record<string, any>,
          requestBody: this.config.logRequestBody ? this.truncateBody(requestBody) : undefined,
          requestBodySize: requestBody?.length || 0,
          statusCode: res.statusCode,
          responseHeaders,
          responseBody: truncatedResponseBody,
          responseBodySize: responseBody?.length || 0,
          responseTime,
          userId,
          sessionId,
          ipAddress,
          userAgent,
          performanceMetrics,
          errorMessage: res.statusCode >= 400 ? this.extractErrorMessage(responseBody) : undefined,
          errorDetails: res.statusCode >= 400 ? { statusCode: res.statusCode } : undefined,
        });

        // Log slow queries
        if (responseTime >= 1000) {
          this.logger.warn(
            `Slow request detected: ${req.method} ${req.url} took ${responseTime}ms`
          );
        }
      } catch (error) {
        this.logger.error(`Failed to log request: ${error.message}`, error.stack);
      }
    });

    next();
  }

  /**
   * Safely stringify an object to JSON
   */
  private safeStringify(obj: any): string {
    try {
      return JSON.stringify(obj);
    } catch {
      return '[Unable to stringify]';
    }
  }

  /**
   * Truncate body if it exceeds max size
   */
  private truncateBody(body: string | undefined): string | undefined {
    if (!body) return undefined;
    const maxSize = this.config.maxBodySize || 10 * 1024;
    if (body.length <= maxSize) return body;
    return body.substring(0, maxSize) + `... [truncated, total: ${body.length} chars]`;
  }

  /**
   * Filter headers based on configuration
   */
  private filterHeaders(headers: Record<string, string>): Record<string, string> {
    const filtered: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(headers)) {
      // Skip excluded headers
      if (this.config.excludeHeaders?.some(h => key.toLowerCase().includes(h.toLowerCase()))) {
        continue;
      }
      
      // If includeHeaders is specified, only include those
      if (this.config.includeHeaders && this.config.includeHeaders.length > 0) {
        if (this.config.includeHeaders.some(h => key.toLowerCase() === h.toLowerCase())) {
          filtered[key] = value;
        }
        continue;
      }
      
      filtered[key] = value;
    }

    return filtered;
  }

  /**
   * Get client IP address
   */
  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  /**
   * Get cache status string for headers
   */
  private getCacheStatus(metrics: PerformanceMetrics): string {
    const total = metrics.cacheHits + metrics.cacheMisses;
    if (total === 0) return 'NONE';
    return metrics.cacheHits > 0 ? 'HIT' : 'MISS';
  }

  /**
   * Extract error message from response body
   */
  private extractErrorMessage(body: string): string | undefined {
    if (!body) return undefined;
    try {
      const parsed = JSON.parse(body);
      return parsed.message || parsed.error || body.substring(0, 200);
    } catch {
      return body.substring(0, 200);
    }
  }
}

/**
 * Performance metrics tracker for database and cache operations
 */
@Injectable()
export class PerformanceTracker {
  private readonly logger = new Logger('PerformanceTracker');

  trackDbQuery(req: Request | undefined, duration: number): void {
    if (req?.performanceMetrics) {
      req.performanceMetrics.dbQueriesCount++;
      req.performanceMetrics.dbQueriesTimeMs += duration;
    }
  }

  trackCacheHit(req: Request | undefined): void {
    if (req?.performanceMetrics) {
      req.performanceMetrics.cacheHits++;
    }
  }

  trackCacheMiss(req: Request | undefined): void {
    if (req?.performanceMetrics) {
      req.performanceMetrics.cacheMisses++;
    }
  }

  trackExternalApiCall(req: Request | undefined, duration: number): void {
    if (req?.performanceMetrics) {
      req.performanceMetrics.externalApiCalls++;
      req.performanceMetrics.externalApiTimeMs += duration;
    }
  }
}
