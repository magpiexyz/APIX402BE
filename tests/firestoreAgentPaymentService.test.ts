/**
 * Tests for Firestore Agent Payment Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test data storage
let testData: Map<string, any> = new Map();
let shouldThrowError = false;

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

// Mock Firestore
vi.mock('../src/db/firestoreClient.js', () => {
  const createMockSnapshot = (docs: any[]) => ({
    empty: docs.length === 0,
    docs: docs.map((data, index) => ({
      id: data?.id || `doc-${index}`,
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
  };

  return {
    getFirestoreClient: vi.fn(() => mockFirestore),
    Collections: {
      AGENT_PAYMENTS: 'agent-payments',
    },
  };
});

import { AgentPaymentService, type PaymentRecord } from '../src/services/firestoreAgentPaymentService.js';

describe('AgentPaymentService', () => {
  let service: AgentPaymentService;

  beforeEach(() => {
    testData.clear();
    shouldThrowError = false;
    service = new AgentPaymentService('us-west-1', 'agent-payments', '0xCompanyWallet');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use provided company wallet address', () => {
      const svc = new AgentPaymentService('us-west-1', 'agent-payments', '0xMyWallet');
      expect(svc.getCompanyWallet()).toBe('0xMyWallet');
    });

    it('should use empty string if no wallet provided', () => {
      const originalEnv = process.env.THIRDWEB_SERVER_WALLET_ADDRESS;
      delete process.env.THIRDWEB_SERVER_WALLET_ADDRESS;

      const svc = new AgentPaymentService('us-west-1', 'agent-payments');
      expect(svc.getCompanyWallet()).toBe('');

      process.env.THIRDWEB_SERVER_WALLET_ADDRESS = originalEnv;
    });
  });

  describe('recordPayment', () => {
    it('should record a payment successfully', async () => {
      const result = await service.recordPayment(
        'agent-123',
        'session-456',
        'magpie',
        'get-quote',
        '1000000', // 1 USDC (6 decimals)
        '0xUSDC',
        '0xTxHash'
      );

      expect(result.id).toBe('test-uuid-1234');
      expect(result.agentId).toBe('agent-123');
      expect(result.sessionId).toBe('session-456');
      expect(result.serverSlug).toBe('magpie');
      expect(result.apiSlug).toBe('get-quote');
      expect(result.fee).toBe('1000000');
      expect(result.paymentToken).toBe('0xUSDC');
      expect(result.txHash).toBe('0xTxHash');
      expect(result.paidBy).toBe('company');
      expect(result.timestamp).toBeDefined();
    });

    it('should record payment without txHash', async () => {
      const result = await service.recordPayment(
        'agent-123',
        'session-456',
        'magpie',
        'get-quote',
        '1000000',
        '0xUSDC'
      );

      expect(result.txHash).toBeUndefined();
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(
        service.recordPayment('agent-123', 'session-456', 'magpie', 'get-quote', '1000000', '0xUSDC')
      ).rejects.toThrow();
    });
  });

  describe('getAgentSpending', () => {
    it('should return spending summary for agent', async () => {
      // Add test payments
      testData.set('agent-payments/pay1', {
        id: 'pay1',
        agentId: 'agent-123',
        serverSlug: 'magpie',
        apiSlug: 'get-quote',
        fee: '1000000',
      });
      testData.set('agent-payments/pay2', {
        id: 'pay2',
        agentId: 'agent-123',
        serverSlug: 'magpie',
        apiSlug: 'get-quote',
        fee: '2000000',
      });
      testData.set('agent-payments/pay3', {
        id: 'pay3',
        agentId: 'agent-123',
        serverSlug: 'other',
        apiSlug: 'api',
        fee: '500000',
      });

      const result = await service.getAgentSpending('agent-123');

      expect(result.totalSpent).toBe('3500000');
      expect(result.paymentCount).toBe(3);
      expect(result.apiCalls).toHaveLength(2);
    });

    it('should return zeros for agent with no payments', async () => {
      const result = await service.getAgentSpending('nonexistent-agent');

      expect(result.totalSpent).toBe('0');
      expect(result.paymentCount).toBe(0);
      expect(result.apiCalls).toEqual([]);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.getAgentSpending('agent-123')).rejects.toThrow();
    });
  });

  describe('getSessionSpending', () => {
    it('should return spending for a session', async () => {
      testData.set('agent-payments/pay1', {
        id: 'pay1',
        sessionId: 'session-456',
        fee: '1000000',
      });
      testData.set('agent-payments/pay2', {
        id: 'pay2',
        sessionId: 'session-456',
        fee: '500000',
      });

      const result = await service.getSessionSpending('session-456');

      expect(result.totalSpent).toBe('1500000');
      expect(result.paymentCount).toBe(2);
    });

    it('should return zeros for session with no payments', async () => {
      const result = await service.getSessionSpending('nonexistent-session');

      expect(result.totalSpent).toBe('0');
      expect(result.paymentCount).toBe(0);
    });

    it('should throw on Firestore error', async () => {
      shouldThrowError = true;

      await expect(service.getSessionSpending('session-456')).rejects.toThrow();
    });
  });

  describe('canExecutePayment', () => {
    it('should return true when company wallet is configured', () => {
      expect(service.canExecutePayment()).toBe(true);
    });

    it('should return false when company wallet is not configured', () => {
      const originalEnv = process.env.THIRDWEB_SERVER_WALLET_ADDRESS;
      delete process.env.THIRDWEB_SERVER_WALLET_ADDRESS;

      const svc = new AgentPaymentService('us-west-1', 'agent-payments', '');
      expect(svc.canExecutePayment()).toBe(false);

      process.env.THIRDWEB_SERVER_WALLET_ADDRESS = originalEnv;
    });
  });

  describe('checkSpendingLimit', () => {
    it('should allow when under limit', async () => {
      testData.set('agent-payments/pay1', {
        id: 'pay1',
        agentId: 'agent-123',
        fee: '100000000000000000', // 0.1 ETH
      });

      const result = await service.checkSpendingLimit(
        'agent-123',
        '100000000000000000', // 0.1 ETH more
        '1000000000000000000' // 1 ETH limit
      );

      expect(result.allowed).toBe(true);
    });

    it('should deny when over limit', async () => {
      testData.set('agent-payments/pay1', {
        id: 'pay1',
        agentId: 'agent-123',
        fee: '900000000000000000', // 0.9 ETH
      });

      const result = await service.checkSpendingLimit(
        'agent-123',
        '200000000000000000', // 0.2 ETH more (total 1.1 ETH)
        '1000000000000000000' // 1 ETH limit
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Spending limit exceeded');
    });

    it('should return error result on Firestore failure', async () => {
      shouldThrowError = true;

      const result = await service.checkSpendingLimit('agent-123', '1000000', '10000000');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Error checking spending limit');
    });
  });

  describe('formatFeeForDisplay', () => {
    it('should format whole dollar amounts', () => {
      const result = AgentPaymentService.formatFeeForDisplay('1000000', 6);
      expect(result).toBe('$1');
    });

    it('should format fractional amounts', () => {
      const result = AgentPaymentService.formatFeeForDisplay('1500000', 6);
      expect(result).toBe('$1.50');
    });

    it('should handle small amounts', () => {
      const result = AgentPaymentService.formatFeeForDisplay('100000', 6);
      expect(result).toBe('$0.10');
    });

    it('should return wei format on parse error', () => {
      const result = AgentPaymentService.formatFeeForDisplay('invalid', 6);
      expect(result).toBe('invalid wei');
    });
  });

  describe('calculateTotalFee', () => {
    it('should sum multiple fees', () => {
      const result = AgentPaymentService.calculateTotalFee(['1000000', '2000000', '500000']);
      expect(result).toBe('3500000');
    });

    it('should handle empty array', () => {
      const result = AgentPaymentService.calculateTotalFee([]);
      expect(result).toBe('0');
    });

    it('should return 0 on invalid input', () => {
      const result = AgentPaymentService.calculateTotalFee(['invalid']);
      expect(result).toBe('0');
    });
  });
});
