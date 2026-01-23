/**
 * Tests for Firestore Metrics Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test data storage
let testData: Map<string, any> = new Map();
let shouldThrowError = false;
let transactionCallback: any = null;

// Mock Firestore
vi.mock('../src/db/firestoreClient.js', () => {
  const createMockSnapshot = (docs: any[]) => ({
    empty: docs.length === 0,
    docs: docs.map((data) => ({
      id: data?.id,
      data: () => data,
    })),
  });

  const mockFirestore = {
    collection: vi.fn().mockImplementation((collectionName: string) => ({
      doc: vi.fn().mockImplementation((docId: string) => {
        const key = `${collectionName}/${docId}`;
        return {
          _testKey: key,
          get: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) throw new Error('Firestore error');
            const data = testData.get(key);
            return { exists: data !== undefined, data: () => data };
          }),
          set: vi.fn().mockImplementation(async (data: any) => {
            if (shouldThrowError) throw new Error('Firestore error');
            testData.set(key, data);
          }),
          update: vi.fn().mockImplementation(async (updates: any) => {
            if (shouldThrowError) throw new Error('Firestore error');
            const existing = testData.get(key) || {};
            testData.set(key, { ...existing, ...updates });
          }),
        };
      }),
      where: vi.fn().mockImplementation((field: string, op: string, value: any) => ({
        get: vi.fn().mockImplementation(async () => {
          if (shouldThrowError) throw new Error('Firestore error');
          const matches: any[] = [];
          testData.forEach((data, key) => {
            if (key.startsWith(collectionName) && data[field] === value) {
              matches.push(data);
            }
          });
          return createMockSnapshot(matches);
        }),
      })),
    })),
    runTransaction: vi.fn().mockImplementation(async (callback: any) => {
      if (shouldThrowError) throw new Error('Firestore error');
      const mockTransaction = {
        get: vi.fn().mockImplementation(async (docRef: any) => {
          const key = docRef._testKey;
          const data = testData.get(key);
          return { exists: data !== undefined, data: () => data };
        }),
        set: vi.fn().mockImplementation((docRef: any, data: any) => {
          const key = docRef._testKey;
          testData.set(key, data);
        }),
        update: vi.fn().mockImplementation((docRef: any, updates: any) => {
          const key = docRef._testKey;
          const existing = testData.get(key) || {};
          testData.set(key, { ...existing, ...updates });
        }),
      };
      return callback(mockTransaction);
    }),
  };

  return {
    getFirestoreClient: vi.fn(() => mockFirestore),
    Collections: {
      API_METRICS: 'api-metrics',
    },
    FieldValue: { increment: vi.fn((n) => n) },
  };
});

import { MetricsService, type ApiMetricsEntry, type CallRecord } from '../src/services/firestoreMetricsService.js';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    testData.clear();
    shouldThrowError = false;
    service = new MetricsService('us-west-1', 'api-metrics');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('recordApiCall', () => {
    it('should create new metrics entry for first call', async () => {
      await service.recordApiCall('0xToken', 'get-quote', '1000000', true, 150);

      const stored = testData.get('api-metrics/0xtoken#get-quote');
      expect(stored).toBeDefined();
      expect(stored.callCount).toBe('1');
      expect(stored.totalRevenue).toBe('1000000');
      expect(stored.successCount).toBe('1');
      expect(stored.failureCount).toBe('0');
    });

    it('should update existing metrics entry', async () => {
      // Set up existing metrics
      testData.set('api-metrics/0xtoken#get-quote', {
        id: '0xtoken#get-quote',
        tokenAddress: '0xtoken',
        apiSlug: 'get-quote',
        callCount: '10',
        totalRevenue: '10000000',
        successCount: '9',
        failureCount: '1',
        totalLatency: '1500',
        averageLatency: '150.00',
        recentCalls: [],
      });

      await service.recordApiCall('0xToken', 'get-quote', '1000000', true, 200);

      const stored = testData.get('api-metrics/0xtoken#get-quote');
      expect(stored.callCount).toBe('11');
      expect(stored.totalRevenue).toBe('11000000');
      expect(stored.successCount).toBe('10');
    });

    it('should record failed calls correctly', async () => {
      await service.recordApiCall('0xToken', 'get-quote', '0', false, 100);

      const stored = testData.get('api-metrics/0xtoken#get-quote');
      expect(stored.successCount).toBe('0');
      expect(stored.failureCount).toBe('1');
    });

    it('should not throw on Firestore error', async () => {
      shouldThrowError = true;

      // Should not throw - metrics are non-critical
      await expect(
        service.recordApiCall('0xToken', 'get-quote', '1000000', true, 150)
      ).resolves.toBeUndefined();
    });
  });

  describe('getApiMetrics', () => {
    it('should return metrics when they exist', async () => {
      const metrics: ApiMetricsEntry = {
        id: '0xtoken#get-quote',
        tokenAddress: '0xtoken',
        apiSlug: 'get-quote',
        callCount: '100',
        totalRevenue: '100000000',
        successCount: '95',
        failureCount: '5',
        totalLatency: '15000',
        averageLatency: '150.00',
        lastCallAt: '2024-01-01T00:00:00.000Z',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      testData.set('api-metrics/0xtoken#get-quote', metrics);

      const result = await service.getApiMetrics('0xToken', 'get-quote');

      expect(result).not.toBeNull();
      expect(result?.callCount).toBe('100');
    });

    it('should return null when metrics do not exist', async () => {
      const result = await service.getApiMetrics('0xToken', 'nonexistent');

      expect(result).toBeNull();
    });

    it('should return null on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getApiMetrics('0xToken', 'get-quote');

      expect(result).toBeNull();
    });
  });

  describe('calculateRecentMetrics', () => {
    it('should calculate metrics from recent calls', () => {
      const recentCalls: CallRecord[] = [
        { timestamp: '2024-01-01T00:00:00.000Z', success: true, latencyMs: 100, revenue: '1000000' },
        { timestamp: '2024-01-01T00:00:01.000Z', success: true, latencyMs: 150, revenue: '1000000' },
        { timestamp: '2024-01-01T00:00:02.000Z', success: false, latencyMs: 200, revenue: '0' },
        { timestamp: '2024-01-01T00:00:03.000Z', success: true, latencyMs: 120, revenue: '1000000' },
      ];

      const result = service.calculateRecentMetrics(recentCalls);

      expect(result.callCount).toBe(4);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(1);
      expect(result.totalRevenue).toBe('3000000');
      expect(result.successRate).toBe(75);
      expect(result.averageLatency).toBe(142.5);
    });

    it('should return zeros for empty array', () => {
      const result = service.calculateRecentMetrics([]);

      expect(result.callCount).toBe(0);
      expect(result.totalRevenue).toBe('0');
      expect(result.successRate).toBe(0);
    });

    it('should return zeros for undefined', () => {
      const result = service.calculateRecentMetrics(undefined as any);

      expect(result.callCount).toBe(0);
    });

    it('should calculate p95 latency correctly', () => {
      const recentCalls: CallRecord[] = [];
      // Add 100 calls with incrementing latencies
      for (let i = 1; i <= 100; i++) {
        recentCalls.push({
          timestamp: new Date().toISOString(),
          success: true,
          latencyMs: i * 10,
          revenue: '1000000',
        });
      }

      const result = service.calculateRecentMetrics(recentCalls);

      // P95 should be around the 95th value (950ms)
      expect(result.p95Latency).toBeGreaterThanOrEqual(940);
      expect(result.p95Latency).toBeLessThanOrEqual(960);
    });
  });

  describe('calculateSuccessRate', () => {
    it('should calculate from recent calls when available', () => {
      const metrics: ApiMetricsEntry = {
        recentCalls: [
          { timestamp: '', success: true, latencyMs: 100, revenue: '0' },
          { timestamp: '', success: true, latencyMs: 100, revenue: '0' },
          { timestamp: '', success: false, latencyMs: 100, revenue: '0' },
        ],
      } as any;

      const result = service.calculateSuccessRate(metrics);

      expect(result).toBeCloseTo(66.67, 0);
    });

    it('should calculate from totals when no recent calls', () => {
      const metrics: ApiMetricsEntry = {
        successCount: '90',
        failureCount: '10',
      } as any;

      const result = service.calculateSuccessRate(metrics);

      expect(result).toBe(90);
    });

    it('should return 0 for null metrics', () => {
      const result = service.calculateSuccessRate(null);

      expect(result).toBe(0);
    });

    it('should return 0 when no calls', () => {
      const metrics: ApiMetricsEntry = {
        successCount: '0',
        failureCount: '0',
      } as any;

      const result = service.calculateSuccessRate(metrics);

      expect(result).toBe(0);
    });
  });

  describe('getServerMetrics', () => {
    it('should aggregate metrics for all APIs', async () => {
      testData.set('api-metrics/0xtoken#api1', {
        id: '0xtoken#api1',
        tokenAddress: '0xtoken',
        apiSlug: 'api1',
        callCount: '100',
        totalRevenue: '100000000',
        successCount: '95',
        failureCount: '5',
        totalLatency: '15000',
        averageLatency: '150.00',
        recentCalls: [
          { timestamp: '', success: true, latencyMs: 150, revenue: '1000000' },
        ],
      });
      testData.set('api-metrics/0xtoken#api2', {
        id: '0xtoken#api2',
        tokenAddress: '0xtoken',
        apiSlug: 'api2',
        callCount: '50',
        totalRevenue: '25000000',
        successCount: '48',
        failureCount: '2',
        totalLatency: '5000',
        averageLatency: '100.00',
        recentCalls: [
          { timestamp: '', success: true, latencyMs: 100, revenue: '500000' },
        ],
      });

      const result = await service.getServerMetrics('0xToken');

      expect(result).not.toBeNull();
      expect(result?.apiCount).toBe(2);
      expect(result?.perApiMetrics).toHaveLength(2);
    });

    it('should return empty metrics when no APIs', async () => {
      const result = await service.getServerMetrics('0xToken');

      expect(result).not.toBeNull();
      expect(result?.totalCalls).toBe('0');
      expect(result?.totalRevenue).toBe('0');
      expect(result?.apiCount).toBe(0);
    });

    it('should return null on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getServerMetrics('0xToken');

      expect(result).toBeNull();
    });

    it('should calculate per-API metrics correctly', async () => {
      testData.set('api-metrics/0xtoken#api1', {
        id: '0xtoken#api1',
        tokenAddress: '0xtoken',
        apiSlug: 'api1',
        callCount: '100',
        totalRevenue: '100000000',
        successCount: '100',
        failureCount: '0',
        totalLatency: '10000',
        averageLatency: '100.00',
      });

      const result = await service.getServerMetrics('0xToken');

      const api1Metrics = result?.perApiMetrics.find(m => m.apiSlug === 'api1');
      expect(api1Metrics).toBeDefined();
      expect(api1Metrics?.successRate).toBe(100);
    });

    it('should handle API with no recent calls (uses historical data)', async () => {
      testData.set('api-metrics/0xtoken#api1', {
        id: '0xtoken#api1',
        tokenAddress: '0xtoken',
        apiSlug: 'api1',
        callCount: '50',
        totalRevenue: '50000000',
        successCount: '45',
        failureCount: '5',
        totalLatency: '5000',
        averageLatency: '100.00',
        // No recentCalls - should use historical totals
      });

      const result = await service.getServerMetrics('0xToken');

      expect(result).not.toBeNull();
      expect(result?.apiCount).toBe(1);
      const api1Metrics = result?.perApiMetrics.find(m => m.apiSlug === 'api1');
      expect(api1Metrics?.successRate).toBe(90); // 45/50 = 90%
    });

    it('should handle API with zero calls (edge case)', async () => {
      testData.set('api-metrics/0xtoken#api1', {
        id: '0xtoken#api1',
        tokenAddress: '0xtoken',
        apiSlug: 'api1',
        callCount: '0',
        totalRevenue: '0',
        successCount: '0',
        failureCount: '0',
        totalLatency: '0',
        averageLatency: '0',
      });

      const result = await service.getServerMetrics('0xToken');

      expect(result).not.toBeNull();
      const api1Metrics = result?.perApiMetrics.find(m => m.apiSlug === 'api1');
      expect(api1Metrics?.successRate).toBe(0);
    });

    it('should handle mixed APIs with and without recent calls', async () => {
      testData.set('api-metrics/0xtoken#api1', {
        id: '0xtoken#api1',
        tokenAddress: '0xtoken',
        apiSlug: 'api1',
        callCount: '100',
        totalRevenue: '100000000',
        successCount: '95',
        failureCount: '5',
        totalLatency: '15000',
        averageLatency: '150.00',
        recentCalls: [
          { timestamp: '', success: true, latencyMs: 150, revenue: '1000000' },
          { timestamp: '', success: false, latencyMs: 200, revenue: '0' },
        ],
      });
      testData.set('api-metrics/0xtoken#api2', {
        id: '0xtoken#api2',
        tokenAddress: '0xtoken',
        apiSlug: 'api2',
        callCount: '50',
        totalRevenue: '25000000',
        successCount: '50',
        failureCount: '0',
        totalLatency: '5000',
        averageLatency: '100.00',
        // No recentCalls
      });

      const result = await service.getServerMetrics('0xToken');

      expect(result).not.toBeNull();
      expect(result?.apiCount).toBe(2);
    });
  });

  describe('calculatePercentile (via calculateRecentMetrics)', () => {
    it('should handle single value array', () => {
      const recentCalls: CallRecord[] = [
        { timestamp: '', success: true, latencyMs: 100, revenue: '1000000' },
      ];

      const result = service.calculateRecentMetrics(recentCalls);

      expect(result.p95Latency).toBe(100);
    });

    it('should handle all same latencies', () => {
      const recentCalls: CallRecord[] = Array(10).fill(null).map(() => ({
        timestamp: '',
        success: true,
        latencyMs: 100,
        revenue: '1000000',
      }));

      const result = service.calculateRecentMetrics(recentCalls);

      expect(result.p95Latency).toBe(100);
    });
  });
});
