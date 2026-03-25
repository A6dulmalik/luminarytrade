import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response, NextFunction } from 'express';
import { RequestLoggingMiddleware, PerformanceTracker, RequestLoggingConfig } from '../middlewares/request-logging.middleware';
import { RequestLogService } from '../services/request-log.service';
import { RequestLogStatus } from '../entities/request-log.entity';

describe('RequestLoggingMiddleware', () => {
  let middleware: RequestLoggingMiddleware;
  let requestLogService: RequestLogService;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  const mockRequestLogService = {
    createRequestLog: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestLoggingMiddleware,
        {
          provide: RequestLogService,
          useValue: mockRequestLogService,
        },
      ],
    }).compile();

    middleware = module.get<RequestLoggingMiddleware>(RequestLoggingMiddleware);
    requestLogService = module.get<RequestLogService>(RequestLogService);

    // Setup mock request
    mockRequest = {
      method: 'GET',
      url: '/api/test',
      originalUrl: '/api/test',
      headers: {
        'user-agent': 'test-agent',
        'content-type': 'application/json',
      },
      query: { page: '1' },
      body: { test: 'data' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as any,
    };

    // Setup mock response
    const mockWrite = jest.fn();
    const mockEnd = jest.fn();
    mockResponse = {
      statusCode: 200,
      setHeader: jest.fn(),
      getHeaders: jest.fn().mockReturnValue({ 'content-type': 'application/json' }),
      write: mockWrite,
      end: mockEnd,
      on: jest.fn().mockImplementation((event, callback) => {
        if (event === 'finish') {
          // Simulate finish event immediately for testing
          setTimeout(() => callback(), 0);
        }
        return mockResponse as Response;
      }),
    };

    mockNext = jest.fn();

    jest.clearAllMocks();
  });

  describe('use', () => {
    it('should generate requestId and correlationId', () => {
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.requestId).toBeDefined();
      expect(mockRequest.correlationId).toBeDefined();
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Correlation-Id', expect.any(String));
    });

    it('should propagate existing correlationId from headers', () => {
      mockRequest.headers = {
        ...mockRequest.headers,
        'x-correlation-id': 'existing-corr-id',
        'x-request-id': 'existing-req-id',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.requestId).toBe('existing-req-id');
      expect(mockRequest.correlationId).toBe('existing-corr-id');
    });

    it('should call next function', () => {
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should skip excluded paths', () => {
      middleware.configure({ excludePaths: ['/health'] });
      mockRequest.url = '/health';
      mockRequest.originalUrl = '/health';

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRequestLogService.createRequestLog).not.toHaveBeenCalled();
    });

    it('should skip when disabled', () => {
      middleware.configure({ enabled: false });

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRequestLogService.createRequestLog).not.toHaveBeenCalled();
    });

    it('should initialize performance metrics', () => {
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.performanceMetrics).toBeDefined();
      expect(mockRequest.performanceMetrics?.dbQueriesCount).toBe(0);
      expect(mockRequest.performanceMetrics?.cacheHits).toBe(0);
      expect(mockRequest.performanceMetrics?.cacheMisses).toBe(0);
    });

    it('should capture request body when enabled', (done) => {
      middleware.configure({ logRequestBody: true });
      
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      // Wait for async finish event
      setTimeout(() => {
        expect(mockRequestLogService.createRequestLog).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.any(String),
          })
        );
        done();
      }, 50);
    });

    it('should not capture request body when disabled', (done) => {
      middleware.configure({ logRequestBody: false });
      
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      setTimeout(() => {
        expect(mockRequestLogService.createRequestLog).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: undefined,
          })
        );
        done();
      }, 50);
    });

    it('should capture response body', (done) => {
      middleware.configure({ logResponseBody: true });
      
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      // Simulate response write
      mockResponse.write!('response data');

      setTimeout(() => {
        expect(mockRequestLogService.createRequestLog).toHaveBeenCalledWith(
          expect.objectContaining({
            responseBody: 'response data',
          })
        );
        done();
      }, 50);
    });

    it('should set performance headers on response', (done) => {
      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      setTimeout(() => {
        expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Response-Time', expect.stringContaining('ms'));
        expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache-Status', expect.any(String));
        expect(mockResponse.setHeader).toHaveBeenCalledWith('X-DB-Queries', expect.any(String));
        done();
      }, 50);
    });

    it('should extract client IP correctly', (done) => {
      mockRequest.headers = {
        ...mockRequest.headers,
        'x-forwarded-for': '192.168.1.1, 10.0.0.1',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      setTimeout(() => {
        expect(mockRequestLogService.createRequestLog).toHaveBeenCalledWith(
          expect.objectContaining({
            ipAddress: '192.168.1.1',
          })
        );
        done();
      }, 50);
    });

    it('should sanitize sensitive headers', (done) => {
      mockRequest.headers = {
        ...mockRequest.headers,
        'authorization': 'Bearer secret-token',
        'cookie': 'session=secret',
        'content-type': 'application/json',
      };

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      setTimeout(() => {
        const callArg = mockRequestLogService.createRequestLog.mock.calls[0][0];
        expect(callArg.headers.authorization).toBe('[REDACTED]');
        expect(callArg.headers.cookie).toBe('[REDACTED]');
        expect(callArg.headers['content-type']).toBe('application/json');
        done();
      }, 50);
    });

    it('should handle errors gracefully', (done) => {
      mockRequestLogService.createRequestLog.mockRejectedValue(new Error('DB error'));

      middleware.use(mockRequest as Request, mockResponse as Response, mockNext);

      setTimeout(() => {
        // Should not throw and next should be called
        expect(mockNext).toHaveBeenCalled();
        done();
      }, 50);
    });
  });

  describe('PerformanceTracker', () => {
    let tracker: PerformanceTracker;

    beforeEach(() => {
      tracker = new PerformanceTracker();
    });

    it('should track database queries', () => {
      const mockReq = { performanceMetrics: { dbQueriesCount: 0, dbQueriesTimeMs: 0 } } as any;
      
      tracker.trackDbQuery(mockReq, 100);
      
      expect(mockReq.performanceMetrics.dbQueriesCount).toBe(1);
      expect(mockReq.performanceMetrics.dbQueriesTimeMs).toBe(100);
    });

    it('should track cache hits', () => {
      const mockReq = { performanceMetrics: { cacheHits: 0, cacheMisses: 0 } } as any;
      
      tracker.trackCacheHit(mockReq);
      
      expect(mockReq.performanceMetrics.cacheHits).toBe(1);
      expect(mockReq.performanceMetrics.cacheMisses).toBe(0);
    });

    it('should track cache misses', () => {
      const mockReq = { performanceMetrics: { cacheHits: 0, cacheMisses: 0 } } as any;
      
      tracker.trackCacheMiss(mockReq);
      
      expect(mockReq.performanceMetrics.cacheHits).toBe(0);
      expect(mockReq.performanceMetrics.cacheMisses).toBe(1);
    });

    it('should track external API calls', () => {
      const mockReq = { performanceMetrics: { externalApiCalls: 0, externalApiTimeMs: 0 } } as any;
      
      tracker.trackExternalApiCall(mockReq, 200);
      
      expect(mockReq.performanceMetrics.externalApiCalls).toBe(1);
      expect(mockReq.performanceMetrics.externalApiTimeMs).toBe(200);
    });

    it('should handle undefined request gracefully', () => {
      // Should not throw
      expect(() => tracker.trackDbQuery(undefined, 100)).not.toThrow();
      expect(() => tracker.trackCacheHit(undefined)).not.toThrow();
      expect(() => tracker.trackCacheMiss(undefined)).not.toThrow();
      expect(() => tracker.trackExternalApiCall(undefined, 100)).not.toThrow();
    });
  });
});