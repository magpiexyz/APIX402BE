/**
 * Tests for Circuit Breaker Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  canCallBuilder,
  recordBuilderResult,
  getCircuitState,
  getAllCircuits,
  resetCircuit,
  resetAllCircuits,
  getCircuitStats,
  withCircuitBreaker,
  CircuitState,
  CircuitBreakerOpenError,
} from '../src/services/circuitBreaker.js';

describe('circuitBreaker', () => {
  beforeEach(() => {
    // Reset all circuits before each test
    resetAllCircuits();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('canCallBuilder', () => {
    it('should allow call when circuit is closed (new circuit)', () => {
      const result = canCallBuilder('https://api.example.com/endpoint');
      expect(result).toBe(true);
    });

    it('should allow call when circuit is closed (existing)', () => {
      // Make a successful call first
      canCallBuilder('https://api.example.com/endpoint');
      recordBuilderResult('https://api.example.com/endpoint', true);

      const result = canCallBuilder('https://api.example.com/endpoint');
      expect(result).toBe(true);
    });

    it('should deny call when circuit is open', () => {
      const url = 'https://api.example.com/endpoint';

      // Trip the circuit with failures
      for (let i = 0; i < 5; i++) {
        canCallBuilder(url);
        recordBuilderResult(url, false, { consecutiveFailureThreshold: 5 });
      }

      const result = canCallBuilder(url);
      expect(result).toBe(false);
    });

    it('should transition from OPEN to HALF_OPEN after timeout', async () => {
      const url = 'https://api.example.com/timeout-test';

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        canCallBuilder(url, { consecutiveFailureThreshold: 5 });
        recordBuilderResult(url, false, { consecutiveFailureThreshold: 5 });
      }

      // Should be open
      expect(canCallBuilder(url)).toBe(false);

      // Wait for timeout (using short timeout for test)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should transition to HALF_OPEN and allow
      const result = canCallBuilder(url, { openTimeoutMs: 50 });
      expect(result).toBe(true);

      const state = getCircuitState(url);
      expect(state?.state).toBe(CircuitState.HALF_OPEN);
    });

    it('should allow call in HALF_OPEN state', async () => {
      const url = 'https://api.example.com/half-open-test';

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        canCallBuilder(url, { consecutiveFailureThreshold: 5 });
        recordBuilderResult(url, false, { consecutiveFailureThreshold: 5 });
      }

      // Wait and transition to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 100));
      canCallBuilder(url, { openTimeoutMs: 50 });

      // Should allow in HALF_OPEN
      const result = canCallBuilder(url);
      expect(result).toBe(true);
    });
  });

  describe('recordBuilderResult', () => {
    it('should reset failure count on success', () => {
      const url = 'https://api.example.com/success-reset';

      // Record some failures
      canCallBuilder(url);
      recordBuilderResult(url, false);
      recordBuilderResult(url, false);

      let state = getCircuitState(url);
      expect(state?.failures).toBe(2);

      // Record success
      recordBuilderResult(url, true);

      state = getCircuitState(url);
      expect(state?.failures).toBe(0);
      expect(state?.successes).toBe(1);
    });

    it('should open circuit after threshold failures', () => {
      const url = 'https://api.example.com/open-test';

      for (let i = 0; i < 5; i++) {
        canCallBuilder(url, { consecutiveFailureThreshold: 5 });
        recordBuilderResult(url, false, { consecutiveFailureThreshold: 5 });
      }

      const state = getCircuitState(url);
      expect(state?.state).toBe(CircuitState.OPEN);
    });

    it('should close circuit from HALF_OPEN on success', async () => {
      const url = 'https://api.example.com/close-test';

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        canCallBuilder(url, { consecutiveFailureThreshold: 5 });
        recordBuilderResult(url, false, { consecutiveFailureThreshold: 5 });
      }

      // Wait and transition to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 100));
      canCallBuilder(url, { openTimeoutMs: 50 });

      // Record success
      recordBuilderResult(url, true, { successThresholdInHalfOpen: 1 });

      const state = getCircuitState(url);
      expect(state?.state).toBe(CircuitState.CLOSED);
    });

    it('should reopen circuit from HALF_OPEN on failure', async () => {
      const url = 'https://api.example.com/reopen-test';

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        canCallBuilder(url, { consecutiveFailureThreshold: 5 });
        recordBuilderResult(url, false, { consecutiveFailureThreshold: 5 });
      }

      // Wait and transition to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 100));
      canCallBuilder(url, { openTimeoutMs: 50 });

      // Record failure in HALF_OPEN
      recordBuilderResult(url, false);

      const state = getCircuitState(url);
      expect(state?.state).toBe(CircuitState.OPEN);
    });
  });

  describe('getCircuitState', () => {
    it('should return undefined for unknown circuit', () => {
      const result = getCircuitState('https://unknown.com/api');
      expect(result).toBeUndefined();
    });

    it('should return circuit state for known circuit', () => {
      const url = 'https://api.example.com/state-test';
      canCallBuilder(url);

      const result = getCircuitState(url);
      expect(result).toBeDefined();
      expect(result?.state).toBe(CircuitState.CLOSED);
    });
  });

  describe('getAllCircuits', () => {
    it('should return empty map when no circuits', () => {
      const result = getAllCircuits();
      expect(result.size).toBe(0);
    });

    it('should return all circuits', () => {
      canCallBuilder('https://api1.example.com/test');
      canCallBuilder('https://api2.example.com/test');

      const result = getAllCircuits();
      expect(result.size).toBe(2);
    });
  });

  describe('resetCircuit', () => {
    it('should reset circuit to closed state', () => {
      const url = 'https://api.example.com/reset-test';

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        canCallBuilder(url, { consecutiveFailureThreshold: 5 });
        recordBuilderResult(url, false, { consecutiveFailureThreshold: 5 });
      }

      expect(getCircuitState(url)?.state).toBe(CircuitState.OPEN);

      // Reset
      resetCircuit(url);

      const state = getCircuitState(url);
      expect(state?.state).toBe(CircuitState.CLOSED);
      expect(state?.failures).toBe(0);
      expect(state?.successes).toBe(0);
    });
  });

  describe('resetAllCircuits', () => {
    it('should clear all circuits', () => {
      canCallBuilder('https://api1.example.com/test');
      canCallBuilder('https://api2.example.com/test');

      expect(getAllCircuits().size).toBe(2);

      resetAllCircuits();

      expect(getAllCircuits().size).toBe(0);
    });
  });

  describe('getCircuitStats', () => {
    it('should return correct stats', () => {
      const url1 = 'https://api1.example.com/stats';
      const url2 = 'https://api2.example.com/stats';

      // Create one closed circuit
      canCallBuilder(url1);
      recordBuilderResult(url1, true);

      // Create one open circuit
      for (let i = 0; i < 5; i++) {
        canCallBuilder(url2, { consecutiveFailureThreshold: 5 });
        recordBuilderResult(url2, false, { consecutiveFailureThreshold: 5 });
      }

      const stats = getCircuitStats();

      expect(stats.total).toBe(2);
      expect(stats.closed).toBe(1);
      expect(stats.open).toBe(1);
      expect(stats.halfOpen).toBe(0);
    });

    it('should return zeros when no circuits', () => {
      const stats = getCircuitStats();

      expect(stats.total).toBe(0);
      expect(stats.closed).toBe(0);
      expect(stats.open).toBe(0);
      expect(stats.halfOpen).toBe(0);
    });

    it('should count HALF_OPEN circuits in stats', async () => {
      const url1 = 'https://api1.example.com/halfopen-stats';
      const url2 = 'https://api2.example.com/closed-stats';

      // Create one closed circuit
      canCallBuilder(url2);
      recordBuilderResult(url2, true);

      // Create one HALF_OPEN circuit
      for (let i = 0; i < 5; i++) {
        canCallBuilder(url1, { consecutiveFailureThreshold: 5 });
        recordBuilderResult(url1, false, { consecutiveFailureThreshold: 5 });
      }

      // Wait for timeout and transition to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 100));
      canCallBuilder(url1, { openTimeoutMs: 50 });

      const state = getCircuitState(url1);
      expect(state?.state).toBe(CircuitState.HALF_OPEN);

      const stats = getCircuitStats();

      expect(stats.total).toBe(2);
      expect(stats.closed).toBe(1);
      expect(stats.open).toBe(0);
      expect(stats.halfOpen).toBe(1);
    });
  });

  describe('withCircuitBreaker', () => {
    it('should execute function when circuit is closed', async () => {
      const url = 'https://api.example.com/wrapper-test';
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withCircuitBreaker(url, fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    it('should record success on successful call', async () => {
      const url = 'https://api.example.com/success-record';
      const fn = vi.fn().mockResolvedValue('ok');

      await withCircuitBreaker(url, fn);

      const state = getCircuitState(url);
      expect(state?.successes).toBe(1);
    });

    it('should record failure on failed call', async () => {
      const url = 'https://api.example.com/failure-record';
      const fn = vi.fn().mockRejectedValue(new Error('API error'));

      await expect(withCircuitBreaker(url, fn)).rejects.toThrow('API error');

      const state = getCircuitState(url);
      expect(state?.failures).toBe(1);
    });

    it('should throw CircuitBreakerOpenError when circuit is open', async () => {
      const url = 'https://api.example.com/open-wrapper';

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        canCallBuilder(url, { consecutiveFailureThreshold: 5 });
        recordBuilderResult(url, false, { consecutiveFailureThreshold: 5 });
      }

      const fn = vi.fn();

      await expect(withCircuitBreaker(url, fn)).rejects.toThrow(CircuitBreakerOpenError);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('CircuitBreakerOpenError', () => {
    it('should have correct properties', () => {
      const error = new CircuitBreakerOpenError('https://api.example.com');

      expect(error.name).toBe('CircuitBreakerOpenError');
      expect(error.builderUrl).toBe('https://api.example.com');
      expect(error.circuitState).toBe(CircuitState.OPEN);
      expect(error.message).toContain('Circuit breaker is open');
    });
  });

  describe('URL normalization', () => {
    it('should treat same host+path as same circuit', () => {
      canCallBuilder('https://api.example.com/v1/endpoint?foo=bar');
      recordBuilderResult('https://api.example.com/v1/endpoint?baz=qux', true);

      // Both should refer to the same circuit
      const state1 = getCircuitState('https://api.example.com/v1/endpoint?foo=bar');
      const state2 = getCircuitState('https://api.example.com/v1/endpoint?baz=qux');

      expect(state1).toBeDefined();
      expect(state2).toBeDefined();
      expect(state1).toBe(state2);
    });

    it('should handle invalid URLs gracefully', () => {
      const result = canCallBuilder('not-a-valid-url');
      expect(result).toBe(true);
    });
  });
});
