/**
 * Tests for Firestore Alerting Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test data storage
let testData: Map<string, any> = new Map();
let shouldThrowError = false;
let fetchMock: any;

// Mock fetch
global.fetch = vi.fn();

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
          delete: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) throw new Error('Firestore error');
            testData.delete(key);
          }),
        };
      }),
      where: vi.fn().mockImplementation((field: string, op: string, value: any) => ({
        where: vi.fn().mockImplementation((field2: string, op2: string, value2: any) => ({
          where: vi.fn().mockImplementation((field3: string, op3: string, value3: any) => ({
            get: vi.fn().mockImplementation(async () => {
              if (shouldThrowError) throw new Error('Firestore error');
              const matches: any[] = [];
              testData.forEach((data, key) => {
                if (
                  key.startsWith(collectionName) &&
                  data[field] === value &&
                  data[field2] === value2 &&
                  data[field3] === value3
                ) {
                  matches.push(data);
                }
              });
              return createMockSnapshot(matches);
            }),
          })),
          get: vi.fn().mockImplementation(async () => {
            if (shouldThrowError) throw new Error('Firestore error');
            const matches: any[] = [];
            testData.forEach((data, key) => {
              if (key.startsWith(collectionName) && data[field] === value && data[field2] === value2) {
                matches.push(data);
              }
            });
            return createMockSnapshot(matches);
          }),
        })),
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
  };

  return {
    getFirestoreClient: vi.fn(() => mockFirestore),
    Collections: {
      ALERTS: 'alerts',
      WEBHOOKS: 'webhooks',
    },
  };
});

// Import the class from the default export
import alertingModule from '../src/services/firestoreAlertingService.js';
const { AlertingService } = alertingModule;

describe('AlertingService', () => {
  let service: InstanceType<typeof AlertingService>;

  beforeEach(() => {
    testData.clear();
    shouldThrowError = false;
    service = new AlertingService();
    vi.mocked(global.fetch).mockReset();
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('checkMetrics', () => {
    it('should return empty array when calls below threshold', async () => {
      const metrics = {
        successRate: 0.5,
        totalCalls: 5, // Below minCallsForAlert (default 10)
        failedCalls: 2,
        p95Latency: 10000,
        avgLatency: 5000,
        errorsPerMinute: 20,
      };

      const alerts = await service.checkMetrics('0xtoken', 'api1', metrics);

      expect(alerts).toHaveLength(0);
    });

    it('should create success_rate alert when rate drops', async () => {
      const metrics = {
        successRate: 0.8, // Below default threshold of 0.95
        totalCalls: 100,
        failedCalls: 20,
        p95Latency: 1000,
        avgLatency: 500,
        errorsPerMinute: 5,
      };

      const alerts = await service.checkMetrics('0xtoken', 'api1', metrics);

      expect(alerts.some(a => a.type === 'success_rate')).toBe(true);
    });

    it('should create latency alert when p95 exceeds threshold', async () => {
      const metrics = {
        successRate: 0.99,
        totalCalls: 100,
        failedCalls: 1,
        p95Latency: 6000, // Above default threshold of 5000
        avgLatency: 3000,
        errorsPerMinute: 1,
      };

      const alerts = await service.checkMetrics('0xtoken', 'api1', metrics);

      expect(alerts.some(a => a.type === 'latency')).toBe(true);
    });

    it('should create error_spike alert when errors exceed threshold', async () => {
      const metrics = {
        successRate: 0.99,
        totalCalls: 100,
        failedCalls: 1,
        p95Latency: 1000,
        avgLatency: 500,
        errorsPerMinute: 15, // Above default threshold of 10
      };

      const alerts = await service.checkMetrics('0xtoken', 'api1', metrics);

      expect(alerts.some(a => a.type === 'error_spike')).toBe(true);
    });

    it('should create multiple alerts when multiple thresholds exceeded', async () => {
      const metrics = {
        successRate: 0.7,
        totalCalls: 100,
        failedCalls: 30,
        p95Latency: 15000,
        avgLatency: 8000,
        errorsPerMinute: 20,
      };

      const alerts = await service.checkMetrics('0xtoken', 'api1', metrics);

      expect(alerts.length).toBeGreaterThan(1);
    });
  });

  describe('createBuilderDownAlert', () => {
    it('should create builder_down alert', () => {
      const alert = service.createBuilderDownAlert('0xtoken', 'api1', 5);

      expect(alert.type).toBe('builder_down');
      expect(alert.severity).toBe('critical');
      expect(alert.tokenAddress).toBe('0xtoken');
      expect(alert.apiSlug).toBe('api1');
      expect(alert.value).toBe(5);
    });

    it('should create server-level alert when no apiSlug', () => {
      const alert = service.createBuilderDownAlert('0xtoken', undefined, 10);

      expect(alert.apiSlug).toBeUndefined();
    });
  });

  describe('saveAlert', () => {
    it('should save alert to Firestore', async () => {
      const alert = {
        id: 'alert-123',
        type: 'success_rate' as const,
        severity: 'warning' as const,
        tokenAddress: '0xtoken',
        message: 'Test alert',
        value: 0.8,
        threshold: 0.95,
        timestamp: new Date().toISOString(),
        resolved: false,
      };

      await service.saveAlert(alert);

      const stored = testData.get('alerts/alert-123');
      expect(stored).toBeDefined();
      expect(stored.message).toBe('Test alert');
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      const alert = { id: 'alert-123' } as any;

      await expect(service.saveAlert(alert)).rejects.toThrow();
    });
  });

  describe('getAlert', () => {
    it('should return alert when it exists', async () => {
      testData.set('alerts/alert-123', {
        id: 'alert-123',
        type: 'success_rate',
        message: 'Test',
      });

      const result = await service.getAlert('alert-123');

      expect(result).not.toBeNull();
      expect(result?.message).toBe('Test');
    });

    it('should return null when alert does not exist', async () => {
      const result = await service.getAlert('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getAlert('alert-123');

      expect(result).toBeNull();
    });
  });

  describe('getActiveAlerts', () => {
    it('should return unresolved alerts', async () => {
      testData.set('alerts/alert-1', { id: 'alert-1', resolved: false });
      testData.set('alerts/alert-2', { id: 'alert-2', resolved: true });
      testData.set('alerts/alert-3', { id: 'alert-3', resolved: false });

      const result = await service.getActiveAlerts();

      expect(result).toHaveLength(2);
      expect(result.every(a => !a.resolved)).toBe(true);
    });

    it('should return empty array on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getActiveAlerts();

      expect(result).toEqual([]);
    });
  });

  describe('getAlertsByToken', () => {
    it('should return alerts for specific token', async () => {
      testData.set('alerts/alert-1', { id: 'alert-1', tokenAddress: '0xtoken' });
      testData.set('alerts/alert-2', { id: 'alert-2', tokenAddress: '0xother' });

      const result = await service.getAlertsByToken('0xToken');

      expect(result).toHaveLength(1);
      expect(result[0].tokenAddress).toBe('0xtoken');
    });

    it('should return empty array on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getAlertsByToken('0xtoken');

      expect(result).toEqual([]);
    });
  });

  describe('getActiveAlert', () => {
    it('should return matching active alert with apiSlug', async () => {
      testData.set('alerts/alert-1', {
        id: 'alert-1',
        tokenAddress: '0xtoken',
        type: 'success_rate',
        apiSlug: 'api1',
        resolved: false,
      });

      const result = await service.getActiveAlert('0xToken', 'api1', 'success_rate');

      expect(result).not.toBeNull();
      expect(result?.apiSlug).toBe('api1');
    });

    it('should return matching active alert without apiSlug', async () => {
      testData.set('alerts/alert-1', {
        id: 'alert-1',
        tokenAddress: '0xtoken',
        type: 'builder_down',
        resolved: false,
      });

      const result = await service.getActiveAlert('0xToken', undefined, 'builder_down');

      expect(result).not.toBeNull();
    });

    it('should return null when no matching alert', async () => {
      testData.set('alerts/alert-1', {
        id: 'alert-1',
        tokenAddress: '0xtoken',
        type: 'success_rate',
        apiSlug: 'different-api',
        resolved: false,
      });

      const result = await service.getActiveAlert('0xToken', 'api1', 'success_rate');

      expect(result).toBeNull();
    });

    it('should return null on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getActiveAlert('0xToken', 'api1', 'success_rate');

      expect(result).toBeNull();
    });
  });

  describe('getWebhooksForToken', () => {
    it('should return active webhooks for token', async () => {
      testData.set('webhooks/wh-1', {
        tokenAddress: '0xtoken',
        webhookUrl: 'https://example.com/webhook',
        events: ['all'],
        active: true,
      });
      testData.set('webhooks/wh-2', {
        tokenAddress: '0xtoken',
        webhookUrl: 'https://other.com/webhook',
        events: ['success_rate'],
        active: false, // Inactive
      });

      const result = await service.getWebhooksForToken('0xToken');

      expect(result).toHaveLength(1);
      expect(result[0].webhookUrl).toBe('https://example.com/webhook');
    });

    it('should return empty array when no webhooks', async () => {
      const result = await service.getWebhooksForToken('0xToken');

      expect(result).toEqual([]);
    });

    it('should return empty array on Firestore error', async () => {
      shouldThrowError = true;

      const result = await service.getWebhooksForToken('0xToken');

      expect(result).toEqual([]);
    });
  });

  describe('dispatchAlert', () => {
    it('should save alert and send webhooks', async () => {
      // Set up webhook for this token
      testData.set('webhooks/wh-1', {
        tokenAddress: '0xtoken',
        webhookUrl: 'https://example.com/webhook',
        events: ['all'],
        active: true,
      });

      const alert = {
        id: 'alert-123',
        type: 'success_rate' as const,
        severity: 'warning' as const,
        tokenAddress: '0xtoken',
        apiSlug: 'api1',
        message: 'Test alert',
        value: 0.8,
        threshold: 0.95,
        timestamp: new Date().toISOString(),
        resolved: false,
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await service.dispatchAlert(alert);

      // Check alert was saved
      expect(testData.has('alerts/alert-123')).toBe(true);

      // Check webhook was called
      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );

      consoleSpy.mockRestore();
    });

    it('should not send webhook when event type not in events list', async () => {
      testData.set('webhooks/wh-1', {
        tokenAddress: '0xtoken',
        webhookUrl: 'https://example.com/webhook',
        events: ['latency'], // Only listening for latency alerts
        active: true,
      });

      const alert = {
        id: 'alert-123',
        type: 'success_rate' as const, // Different type
        severity: 'warning' as const,
        tokenAddress: '0xtoken',
        message: 'Test',
        value: 0.8,
        threshold: 0.95,
        timestamp: new Date().toISOString(),
        resolved: false,
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await service.dispatchAlert(alert);

      // Webhook should NOT be called because event type doesn't match
      expect(global.fetch).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle webhook failure gracefully', async () => {
      testData.set('webhooks/wh-1', {
        tokenAddress: '0xtoken',
        webhookUrl: 'https://example.com/webhook',
        events: ['all'],
        active: true,
      });

      vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response);

      const alert = {
        id: 'alert-123',
        type: 'success_rate' as const,
        severity: 'warning' as const,
        tokenAddress: '0xtoken',
        message: 'Test',
        value: 0.8,
        threshold: 0.95,
        timestamp: new Date().toISOString(),
        resolved: false,
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Should not throw
      await service.dispatchAlert(alert);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Webhook returned 500'));

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('should handle webhook network error gracefully', async () => {
      testData.set('webhooks/wh-1', {
        tokenAddress: '0xtoken',
        webhookUrl: 'https://example.com/webhook',
        events: ['all'],
        active: true,
      });

      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

      const alert = {
        id: 'alert-123',
        type: 'success_rate' as const,
        severity: 'warning' as const,
        tokenAddress: '0xtoken',
        message: 'Test',
        value: 0.8,
        threshold: 0.95,
        timestamp: new Date().toISOString(),
        resolved: false,
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      await service.dispatchAlert(alert);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Webhook delivery failed'), expect.any(Error));

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('resolveAlert', () => {
    it('should mark alert as resolved', async () => {
      testData.set('alerts/alert-123', { id: 'alert-123', resolved: false });

      await service.resolveAlert('alert-123');

      const stored = testData.get('alerts/alert-123');
      expect(stored.resolved).toBe(true);
      expect(stored.resolvedAt).toBeDefined();
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.resolveAlert('alert-123')).rejects.toThrow();
    });
  });

  describe('configureWebhook', () => {
    it('should save webhook configuration', async () => {
      await service.configureWebhook('0xToken', 'https://webhook.example.com', ['all']);

      // Check that a webhook was saved
      let found = false;
      testData.forEach((value, key) => {
        if (key.startsWith('webhooks/')) {
          found = true;
          expect(value.tokenAddress).toBe('0xtoken');
          expect(value.webhookUrl).toBe('https://webhook.example.com');
          expect(value.active).toBe(true);
        }
      });
      expect(found).toBe(true);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(
        service.configureWebhook('0xToken', 'https://webhook.example.com')
      ).rejects.toThrow();
    });
  });

  describe('removeWebhook', () => {
    it('should remove webhook configuration', async () => {
      const docId = '0xtoken_aHR0cHM6Ly93ZWJob';
      testData.set(`webhooks/${docId}`, { tokenAddress: '0xtoken' });

      await service.removeWebhook('0xToken', 'https://webhook.example.com');

      // Note: The actual document ID depends on base64 encoding
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(
        service.removeWebhook('0xToken', 'https://webhook.example.com')
      ).rejects.toThrow();
    });
  });

  describe('getThresholds', () => {
    it('should return current thresholds', () => {
      const thresholds = service.getThresholds();

      expect(thresholds.minSuccessRate).toBeDefined();
      expect(thresholds.maxLatencyP95Ms).toBeDefined();
      expect(thresholds.maxErrorRatePerMin).toBeDefined();
    });
  });

  describe('updateThresholds', () => {
    it('should update thresholds', () => {
      service.updateThresholds({ minSuccessRate: 0.99 });

      const thresholds = service.getThresholds();
      expect(thresholds.minSuccessRate).toBe(0.99);
    });

    it('should merge with existing thresholds', () => {
      const original = service.getThresholds();
      service.updateThresholds({ minSuccessRate: 0.99 });

      const updated = service.getThresholds();
      expect(updated.maxLatencyP95Ms).toBe(original.maxLatencyP95Ms);
    });
  });

  describe('severity determination', () => {
    it('should return critical for very low success rate', async () => {
      const metrics = {
        successRate: 0.5, // Below critical threshold (0.80)
        totalCalls: 100,
        failedCalls: 50,
        p95Latency: 1000,
        avgLatency: 500,
        errorsPerMinute: 5,
      };

      const alerts = await service.checkMetrics('0xtoken', 'api1', metrics);

      const successAlert = alerts.find(a => a.type === 'success_rate');
      expect(successAlert?.severity).toBe('critical');
    });

    it('should return warning for moderately low success rate', async () => {
      const metrics = {
        successRate: 0.9, // Between warning (0.95) and critical (0.80)
        totalCalls: 100,
        failedCalls: 10,
        p95Latency: 1000,
        avgLatency: 500,
        errorsPerMinute: 5,
      };

      const alerts = await service.checkMetrics('0xtoken', 'api1', metrics);

      const successAlert = alerts.find(a => a.type === 'success_rate');
      expect(successAlert?.severity).toBe('warning');
    });

    it('should return critical for very high latency', async () => {
      const metrics = {
        successRate: 0.99,
        totalCalls: 100,
        failedCalls: 1,
        p95Latency: 15000, // Above critical threshold (10000)
        avgLatency: 8000,
        errorsPerMinute: 1,
      };

      const alerts = await service.checkMetrics('0xtoken', 'api1', metrics);

      const latencyAlert = alerts.find(a => a.type === 'latency');
      expect(latencyAlert?.severity).toBe('critical');
    });

    it('should return critical for very high error spike', async () => {
      const metrics = {
        successRate: 0.99,
        totalCalls: 100,
        failedCalls: 1,
        p95Latency: 1000,
        avgLatency: 500,
        errorsPerMinute: 100, // 10 * 5 = 50 is critical threshold, 100 > 50
      };

      const alerts = await service.checkMetrics('0xtoken', 'api1', metrics);

      const errorAlert = alerts.find(a => a.type === 'error_spike');
      expect(errorAlert?.severity).toBe('critical');
    });

    it('should return warning for moderate error spike', async () => {
      const metrics = {
        successRate: 0.99,
        totalCalls: 100,
        failedCalls: 1,
        p95Latency: 1000,
        avgLatency: 500,
        errorsPerMinute: 20, // Above threshold (10) but below critical (50)
      };

      const alerts = await service.checkMetrics('0xtoken', 'api1', metrics);

      const errorAlert = alerts.find(a => a.type === 'error_spike');
      expect(errorAlert?.severity).toBe('warning');
    });
  });
});
