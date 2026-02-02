import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notifyForGraduation, type GraduationNotification } from '../src/services/graduationNotifier.js';

describe('graduationNotifier', () => {
  const originalEnv = process.env;
  const mockFetch = vi.fn();

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
      GRADUATION_FUNCTION_EVM_URL: 'https://graduation-evm-abc123.run.app',
      GRADUATION_FUNCTION_SOLANA_URL: 'https://graduation-solana-abc123.run.app',
      GRADUATION_INTERNAL_SECRET: 'test-secret',
    };
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    global.fetch = mockFetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('EVM chains', () => {
    it('should invoke EVM Cloud Function for numeric chainId', async () => {
      await notifyForGraduation(evmNotification);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://graduation-evm-abc123.run.app',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Graduation-Secret': 'test-secret',
          }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.action).toBe('graduate');
      expect(body.tokenAddress).toBe('0xabc123');
      expect(body.chainId).toBe('84532');
      expect(body.merkleRoot).toBe('0xdeadbeef');
    });

    it('should invoke EVM Cloud Function for different EVM chainIds', async () => {
      for (const chainId of ['1', '8453', '84532', '137', '42161']) {
        vi.clearAllMocks();
        mockFetch.mockResolvedValue({ ok: true, status: 200 });
        await notifyForGraduation({ ...evmNotification, chainId });
        expect(mockFetch).toHaveBeenCalledWith(
          'https://graduation-evm-abc123.run.app',
          expect.anything(),
        );
      }
    });
  });

  describe('Solana chains', () => {
    it('should invoke Solana Cloud Function for devnet', async () => {
      await notifyForGraduation(solanaNotification);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://graduation-solana-abc123.run.app',
        expect.anything(),
      );
    });

    it('should invoke Solana Cloud Function for mainnet-beta', async () => {
      await notifyForGraduation({ ...solanaNotification, chainId: 'mainnet-beta' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://graduation-solana-abc123.run.app',
        expect.anything(),
      );
    });

    it('should invoke Solana Cloud Function for testnet', async () => {
      await notifyForGraduation({ ...solanaNotification, chainId: 'testnet' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://graduation-solana-abc123.run.app',
        expect.anything(),
      );
    });
  });

  describe('error handling', () => {
    it('should throw when no Cloud Function configured for chainId', async () => {
      delete process.env.GRADUATION_FUNCTION_EVM_URL;

      await expect(notifyForGraduation(evmNotification)).rejects.toThrow(
        'No graduation Cloud Function configured for chain 84532'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw when no Solana Cloud Function configured', async () => {
      delete process.env.GRADUATION_FUNCTION_SOLANA_URL;

      await expect(notifyForGraduation(solanaNotification)).rejects.toThrow(
        'No graduation Cloud Function configured for chain devnet'
      );
    });

    it('should throw on fetch error', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(notifyForGraduation(evmNotification)).rejects.toThrow('ECONNREFUSED');
    });

    it('should not throw on non-ok response (just warns)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      // Should not throw — just logs a warning
      await expect(notifyForGraduation(evmNotification)).resolves.toBeUndefined();
    });
  });

  describe('payload format', () => {
    it('should include action: graduate in payload', async () => {
      await notifyForGraduation(evmNotification);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.action).toBe('graduate');
    });

    it('should spread all notification fields into payload', async () => {
      await notifyForGraduation(evmNotification);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({
        action: 'graduate',
        ...evmNotification,
      });
    });

    it('should send X-Graduation-Secret header when secret is set', async () => {
      await notifyForGraduation(evmNotification);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-Graduation-Secret']).toBe('test-secret');
    });

    it('should not send X-Graduation-Secret header when secret is not set', async () => {
      delete process.env.GRADUATION_INTERNAL_SECRET;

      await notifyForGraduation(evmNotification);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-Graduation-Secret']).toBeUndefined();
    });
  });
});
