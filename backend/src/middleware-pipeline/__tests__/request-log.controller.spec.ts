import { Test, TestingModule } from '@nestjs/testing';
import { RequestLogController } from '../controllers/request-log.controller';
import { RequestLogService, PerformanceSummary } from '../services/request-log.service';
import { RequestLogEntity, RequestLogStatus } from '../entities/request-log.entity';
import { RequestLogFilterDto, DateRangeDto, SlowQueryThresholdDto } from '../dto/request-log-filter.dto';

describe('RequestLogController', () => {
  let controller: RequestLogController;
  let service: RequestLogService;

  const mockRequestLogService = {
    getRequestLog: jest.fn(),
    searchLogs: jest.fn(),
    getSlowQueries: jest.fn(),
    getErrorRequests: jest.fn(),
    getPerformanceSummary: jest.fn(),
    getCorrelatedRequests: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RequestLogController],
      providers: [
        {
          provide: RequestLogService,
          useValue: mockRequestLogService,
        },
      ],
    }).compile();

    controller = module.get<RequestLogController>(RequestLogController);
    service = module.get<RequestLogService>(RequestLogService);

    jest.clearAllMocks();
  });

  describe('searchLogs', () => {
    it('should return paginated logs', async () => {
      const filter: RequestLogFilterDto = {
        userId: 'user-123',
        limit: 10,
        offset: 0,
      };
      const mockResult = {
        logs: [{ id: '1', userId: 'user-123' }],
        total: 1,
        limit: 10,
        offset: 0,
      };
      mockRequestLogService.searchLogs.mockResolvedValue(mockResult);

      const result = await controller.searchLogs(filter);

      expect(service.searchLogs).toHaveBeenCalledWith(filter);
      expect(result).toEqual(mockResult);
    });

    it('should apply default pagination values', async () => {
      const filter: RequestLogFilterDto = {};
      const mockResult = {
        logs: [],
        total: 0,
        limit: 50,
        offset: 0,
      };
      mockRequestLogService.searchLogs.mockResolvedValue(mockResult);

      await controller.searchLogs(filter);

      expect(service.searchLogs).toHaveBeenCalledWith(filter);
    });
  });

  describe('getRequestLog', () => {
    it('should return a single request log', async () => {
      const mockLog: Partial<RequestLogEntity> = {
        id: '1',
        requestId: 'req-123',
        method: 'GET',
        url: '/api/test',
      };
      mockRequestLogService.getRequestLog.mockResolvedValue(mockLog);

      const result = await controller.getRequestLog('req-123');

      expect(service.getRequestLog).toHaveBeenCalledWith('req-123');
      expect(result).toEqual(mockLog);
    });

    it('should return null if not found', async () => {
      mockRequestLogService.getRequestLog.mockResolvedValue(null);

      const result = await controller.getRequestLog('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getSlowQueries', () => {
    it('should return slow queries with default threshold', async () => {
      const params: SlowQueryThresholdDto = { threshold: 1000 };
      const mockLogs = [
        { id: '1', responseTime: 1500 },
        { id: '2', responseTime: 2000 },
      ];
      mockRequestLogService.getSlowQueries.mockResolvedValue(mockLogs);

      const result = await controller.getSlowQueries(params);

      expect(service.getSlowQueries).toHaveBeenCalledWith(1000, 50);
      expect(result).toEqual(mockLogs);
    });

    it('should return slow queries with custom limit', async () => {
      const params: SlowQueryThresholdDto = { threshold: 500, limit: 10 };
      mockRequestLogService.getSlowQueries.mockResolvedValue([]);

      await controller.getSlowQueries(params);

      expect(service.getSlowQueries).toHaveBeenCalledWith(500, 10);
    });
  });

  describe('getErrorRequests', () => {
    it('should return error requests within date range', async () => {
      const dateRange: DateRangeDto = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };
      const mockLogs = [
        { id: '1', status: RequestLogStatus.ERROR },
        { id: '2', status: RequestLogStatus.ERROR },
      ];
      mockRequestLogService.getErrorRequests.mockResolvedValue(mockLogs);

      const result = await controller.getErrorRequests(dateRange);

      expect(service.getErrorRequests).toHaveBeenCalledWith(dateRange);
      expect(result).toEqual(mockLogs);
    });
  });

  describe('getPerformanceSummary', () => {
    it('should return performance summary', async () => {
      const dateRange: DateRangeDto = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };
      const mockSummary: PerformanceSummary = {
        totalRequests: 100,
        avgResponseTime: 150,
        p95ResponseTime: 500,
        p99ResponseTime: 800,
        errorRate: 2.5,
        slowQueryCount: 5,
        cacheHitRate: 75,
      };
      mockRequestLogService.getPerformanceSummary.mockResolvedValue(mockSummary);

      const result = await controller.getPerformanceSummary(dateRange);

      expect(service.getPerformanceSummary).toHaveBeenCalledWith(dateRange);
      expect(result).toEqual(mockSummary);
    });
  });

  describe('getCorrelatedRequests', () => {
    it('should return correlated requests', async () => {
      const correlationId = 'corr-123';
      const mockLogs = [
        { id: '1', correlationId },
        { id: '2', correlationId },
      ];
      mockRequestLogService.getCorrelatedRequests.mockResolvedValue(mockLogs);

      const result = await controller.getCorrelatedRequests(correlationId);

      expect(service.getCorrelatedRequests).toHaveBeenCalledWith(correlationId);
      expect(result).toEqual(mockLogs);
    });
  });
});
