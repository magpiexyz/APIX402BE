import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class {
    send = mockSend;
  },
  InvokeCommand: class {
    FunctionName: string;
    InvocationType: string;
    Payload: string;
    constructor(params: any) {
      Object.assign(this, params);
    }
  },
}));

import { notifyLambdaForGraduation, type GraduationNotification } from '../src/services/graduationNotifier.js';

describe('graduationNotifier', () => {
  const originalEnv = process.env;

  const evmNotification: GraduationNotification = {
    tokenAddress: '0xabc123',
    chainId: '84532',
    merkleRoot: '0xdeadbeef',
    virtualDistributed: '625000000000000000000000000',
    totalFeesCollected: '100000000',
  };

  const solanaNotification: GraduationNotification = {
    tokenAddress: 'SoLTokenAddr123',
    chainId: 'devnet',
    merkleRoot: '0xdeadbeef',
    virtualDistributed: '625000000000000000',
    totalFeesCollected: '100000000',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      AWS_REGION: 'us-east-1',
      GRADUATION_LAMBDA_EVM: 'batch-transfer-x402',
      GRADUATION_LAMBDA_SOLANA: 'batch-transfer-x402-solana',
    };
    mockSend.mockResolvedValue({ StatusCode: 202 });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('EVM chains', () => {
    it('should invoke EVM Lambda for numeric chainId', async () => {
      await notifyLambdaForGraduation(evmNotification);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.FunctionName).toBe('batch-transfer-x402');
      expect(command.InvocationType).toBe('Event');

      const payload = JSON.parse(command.Payload);
      expect(payload.action).toBe('graduate');
      expect(payload.tokenAddress).toBe('0xabc123');
      expect(payload.chainId).toBe('84532');
      expect(payload.merkleRoot).toBe('0xdeadbeef');
    });

    it('should invoke EVM Lambda for different EVM chainIds', async () => {
      for (const chainId of ['1', '8453', '84532', '137', '42161']) {
        vi.clearAllMocks();
        mockSend.mockResolvedValue({ StatusCode: 202 });
        await notifyLambdaForGraduation({ ...evmNotification, chainId });
        const command = mockSend.mock.calls[0][0];
        expect(command.FunctionName).toBe('batch-transfer-x402');
      }
    });
  });

  describe('Solana chains', () => {
    it('should invoke Solana Lambda for devnet', async () => {
      await notifyLambdaForGraduation(solanaNotification);

      const command = mockSend.mock.calls[0][0];
      expect(command.FunctionName).toBe('batch-transfer-x402-solana');
    });

    it('should invoke Solana Lambda for mainnet-beta', async () => {
      await notifyLambdaForGraduation({ ...solanaNotification, chainId: 'mainnet-beta' });

      const command = mockSend.mock.calls[0][0];
      expect(command.FunctionName).toBe('batch-transfer-x402-solana');
    });

    it('should invoke Solana Lambda for testnet', async () => {
      await notifyLambdaForGraduation({ ...solanaNotification, chainId: 'testnet' });

      const command = mockSend.mock.calls[0][0];
      expect(command.FunctionName).toBe('batch-transfer-x402-solana');
    });
  });

  describe('error handling', () => {
    it('should throw when no Lambda configured for chainId', async () => {
      delete process.env.GRADUATION_LAMBDA_EVM;

      await expect(notifyLambdaForGraduation(evmNotification)).rejects.toThrow(
        'No graduation Lambda configured for chain 84532'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw when no Solana Lambda configured', async () => {
      delete process.env.GRADUATION_LAMBDA_SOLANA;

      await expect(notifyLambdaForGraduation(solanaNotification)).rejects.toThrow(
        'No graduation Lambda configured for chain devnet'
      );
    });

    it('should throw on Lambda invocation error', async () => {
      mockSend.mockRejectedValue(new Error('AccessDeniedException'));

      await expect(notifyLambdaForGraduation(evmNotification)).rejects.toThrow('AccessDeniedException');
    });

    it('should not throw on unexpected status code (just warns)', async () => {
      mockSend.mockResolvedValue({ StatusCode: 500 });

      // Should not throw — just logs a warning
      await expect(notifyLambdaForGraduation(evmNotification)).resolves.toBeUndefined();
    });
  });

  describe('payload format', () => {
    it('should include action: graduate in payload', async () => {
      await notifyLambdaForGraduation(evmNotification);

      const payload = JSON.parse(mockSend.mock.calls[0][0].Payload);
      expect(payload.action).toBe('graduate');
    });

    it('should spread all notification fields into payload', async () => {
      await notifyLambdaForGraduation(evmNotification);

      const payload = JSON.parse(mockSend.mock.calls[0][0].Payload);
      expect(payload).toEqual({
        action: 'graduate',
        ...evmNotification,
      });
    });

    it('should use async invocation (Event type)', async () => {
      await notifyLambdaForGraduation(evmNotification);

      const command = mockSend.mock.calls[0][0];
      expect(command.InvocationType).toBe('Event');
    });
  });
});
