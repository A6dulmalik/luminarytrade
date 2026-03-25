import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, Between, MoreThan, LessThan, Not, IsNull } from 'typeorm';
import { RequestLogService, CreateRequestLogData } from '../services/request-log.service';
import { RequestLogEntity, RequestLogStatus, PerformanceMetrics } from '../entities/request-log.entity';
import { RequestLogFilterDto, DateRangeDto } from '../dto/request-log-filter.dto';

describe('RequestLogService', () => {
  let service: RequestLogService;
  let repository: Repository<RequestLogEntity>;

  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    find: jest.fn(),
    softDelete: jest.fn(),
  };

  const mockPerformanceMetrics: PerformanceMetrics = {
    dbQueriesCount: 5,
    dbQueriesTimeMs: 100,
    cacheHits: 2,
    cacheMisses: 1,
    externalApiCalls: 0,
    externalApiTimeMs: 0,
    memoryUsageMB: 10,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestLogService,
        {
          provide: getRepositoryToken(RequestLogEntity),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<RequestLogService>(RequestLogService);
    repository = module.get<Repository<RequestLogEntity>>(getRepositoryToken(RequestLogEntity));

    jest.clearAllMocks();
  });

  describe('createRequestLog', () => {
    const mockData: CreateRequestLogData = {
      requestId: 'req-123',
      method: 'GET',
      url: '/api/test',
      statusCode: 200,
      responseTime: 50,
      ipAddress: '127.0.0.1',
      performanceMetrics: mockPerformanceMetrics,
      requestBodySize: 0,
      responseBodySize: 100,
    };

    it('should create a request log successfully', async () => {
      const savedEntity = { id: '1', ...mockData, status: RequestLogStatus.SUCCESS };
      mockRepository.create.mockReturnValue(savedEntity);
      mockRepository.save.mockResolvedValue(savedEntity);

      const result = await service.createRequestLog(mockData);

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: mockData.requestId,
          method: mockData.method,
          url: mockData.url,
        })
      );
      expect(mockRepository.save).toHaveBeenCalledWith(savedEntity);
      expect(result).toEqual(savedEntity);
    });

    it('should mark slow requests correctly', async () => {
      const slowData = { ...mockData, responseTime: 1500 };
      const savedEntity = { id: '1', ...slowData, status: RequestLogStatus.SLOW };
      mockRepository.create.mockReturnValue(savedEntity);
      mockRepository.save.mockResolvedValue(savedEntity);

      const result = await service.createRequestLog(slowData);

      expect(result.status).toBe(RequestLogStatus.SLOW);
    });

    it('should mark error requests correctly', async () => {
      const errorData = { ...mockData, statusCode: 500 };
      const savedEntity = { id: '1', ...errorData, status: RequestLogStatus.ERROR };
      mockRepository.create.mockReturnValue(savedEntity);
      mockRepository.save.mockResolvedValue(savedEntity);

      const result = await service.createRequestLog(errorData);

      expect(result.status).toBe(RequestLogStatus.ERROR);
    });

    it('should truncate large request bodies', async () => {
      const largeBody = 'x'.repeat(20 * 1024); // 20KB
      const dataWithLargeBody = { ...mockData, requestBody: largeBody };
      mockRepository.create.mockReturnValue({ id: '1', ...dataWithLargeBody });
      mockRepository.save.mockResolvedValue({ id: '1', ...dataWithLargeBody });

      await service.createRequestLog(dataWithLargeBody);

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.stringContaining('[truncated'),
        })
      );
    });

    it('should sanitize sensitive headers', async () => {
      const dataWithHeaders = {
        ...mockData,
        headers: {
          authorization: 'Bearer secret-token',
          'content-type': 'application/json',
          cookie: 'session=secret',
        },
      };
      mockRepository.create.mockReturnValue({ id: '1', ...dataWithHeaders });
      mockRepository.save.mockResolvedValue({ id: '1', ...dataWithHeaders });

      await service.createRequestLog(dataWithHeaders);

      const callArg = mockRepository.create.mock.calls[0][0];
      expect(callArg.headers.authorization).toBe('[REDACTED]');
      expect(callArg.headers.cookie).toBe('[REDACTED]');
      expect(callArg.headers['content-type']).toBe('application/json');
    });
  });

  describe('getRequestLog', () => {
    it('should return a request log by requestId', async () => {
      const mockLog = { id: '1', requestId: 'req-123' };
      mockRepository.findOne.mockResolvedValue(mockLog);

      const result = await service.getRequestLog('req-123');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { requestId: 'req-123' },
      });
      expect(result).toEqual(mockLog);
    });

    it('should return null if not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.getRequestLog('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('searchLogs', () => {
    it('should search logs with filters', async () => {
      const filter: RequestLogFilterDto = {
        userId: 'user-123',
        status: RequestLogStatus.SUCCESS,
        limit: 10,
        offset: 0,
      };
      const mockLogs = [{ id: '1', userId: 'user-123' }];
      mockRepository.findAndCount.mockResolvedValue([mockLogs, 1]);

      const result = await service.searchLogs(filter);

      expect(mockRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-123',
            status: RequestLogStatus.SUCCESS,
          }),
          take: 10,
          skip: 0,
        })
      );
      expect(result.logs).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter by response time range', async () => {
      const filter: RequestLogFilterDto = {
        minResponseTime: 100,
        maxResponseTime: 1000,
      };
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.searchLogs(filter);

      expect(mockRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            responseTime: Between(100, 1000),
          }),
        })
      );
    });

    it('should filter by date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const filter: RequestLogFilterDto = { startDate, endDate };
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.searchLogs(filter);

      expect(mockRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: Between(startDate, endDate),
          }),
        })
      );
    });

    it('should filter by hasError', async () => {
      const filter: RequestLogFilterDto = { hasError: true };
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.searchLogs(filter);

      expect(mockRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            errorMessage: Not(IsNull()),
          }),
        })
      );
    });
  });

  describe('getSlowQueries', () => {
    it('should return slow queries exceeding threshold', async () => {
      const mockLogs = [
        { id: '1', responseTime: 1500 },
        { id: '2', responseTime: 2000 },
      ];
      mockRepository.find.mockResolvedValue(mockLogs);

      const result = await service.getSlowQueries(1000, 50);

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { responseTime: MoreThan(1000) },
        order: { responseTime: 'DESC' },
        take: 50,
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('getErrorRequests', () => {
    it('should return error requests within date range', async () => {
      const dateRange: DateRangeDto = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };
      const mockLogs = [{ id: '1', errorMessage: 'Error occurred' }];
      mockRepository.find.mockResolvedValue(mockLogs);

      const result = await service.getErrorRequests(dateRange);

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: {
          createdAt: Between(dateRange.startDate, dateRange.endDate),
          errorMessage: Not(IsNull()),
        },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('getPerformanceSummary', () => {
    it('should calculate performance summary correctly', async () => {
      const dateRange: DateRangeDto = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };
      const mockLogs = [
        { responseTime: 100, status: RequestLogStatus.SUCCESS, performanceMetrics: { cacheHits: 1, cacheMisses: 0 } },
        { responseTime: 200, status: RequestLogStatus.SUCCESS, performanceMetrics: { cacheHits: 1, cacheMisses: 0 } },
        { responseTime: 1500, status: RequestLogStatus.SLOW, performanceMetrics: { cacheHits: 0, cacheMisses: 1 } },
        { responseTime: 300, status: RequestLogStatus.ERROR, performanceMetrics: { cacheHits: 0, cacheMisses: 1 } },
      ];
      mockRepository.find.mockResolvedValue(mockLogs);

      const result = await service.getPerformanceSummary(dateRange);

      expect(result.totalRequests).toBe(4);
      expect(result.avgResponseTime).toBe(525);
      expect(result.errorRate).toBe(25);
      expect(result.slowQueryCount).toBe(1);
      expect(result.cacheHitRate).toBe(50);
    });

    it('should return zero values when no logs exist', async () => {
      const dateRange: DateRangeDto = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };
      mockRepository.find.mockResolvedValue([]);

      const result = await service.getPerformanceSummary(dateRange);

      expect(result.totalRequests).toBe(0);
      expect(result.avgResponseTime).toBe(0);
      expect(result.errorRate).toBe(0);
    });
  });

  describe('getCorrelatedRequests', () => {
    it('should return correlated requests by correlationId', async () => {
      const mockLogs = [
        { id: '1', correlationId: 'corr-123' },
        { id: '2', correlationId: 'corr-123' },
      ];
      mockRepository.find.mockResolvedValue(mockLogs);

      const result = await service.getCorrelatedRequests('corr-123');

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { correlationId: 'corr-123' },
        order: { createdAt: 'ASC' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('cleanupOldLogs', () => {
    it('should soft delete logs older than 30 days', async () => {
      mockRepository.softDelete.mockResolvedValue({ affected: 100 });

      await service.cleanupOldLogs();

      expect(mockRepository.softDelete).toHaveBeenCalledWith({
        createdAt: expect.any(LessThan),
      });
    });
  });
});
