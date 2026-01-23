/**
 * Tests for JWT Authentication utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { generateBuilderJWT, verifyBuilderJWT } from '../src/utils/jwtAuth.js';

describe('jwtAuth', () => {
  const testSecret = 'test-secret-phrase-12345';
  const testTokenAddress = '0x1234567890AbCdEf1234567890AbCdEf12345678';
  const testEndpoint = 'https://api.builder.com/endpoint';

  describe('generateBuilderJWT', () => {
    it('should generate a valid JWT token', () => {
      const token = generateBuilderJWT(testTokenAddress, testEndpoint, testSecret);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should include correct payload fields', () => {
      const token = generateBuilderJWT(testTokenAddress, testEndpoint, testSecret);
      const decoded = jwt.decode(token) as jwt.JwtPayload;

      expect(decoded.iss).toBe('iao-proxy');
      expect(decoded.aud).toBe(testEndpoint);
      expect(decoded.tokenAddress).toBe(testTokenAddress.toLowerCase());
      expect(decoded.iat).toBeDefined();
      expect(decoded.jti).toBeDefined();
    });

    it('should lowercase the token address', () => {
      const token = generateBuilderJWT(testTokenAddress, testEndpoint, testSecret);
      const decoded = jwt.decode(token) as jwt.JwtPayload;

      expect(decoded.tokenAddress).toBe(testTokenAddress.toLowerCase());
    });

    it('should generate unique jti for each token', () => {
      const token1 = generateBuilderJWT(testTokenAddress, testEndpoint, testSecret);
      const token2 = generateBuilderJWT(testTokenAddress, testEndpoint, testSecret);

      const decoded1 = jwt.decode(token1) as jwt.JwtPayload;
      const decoded2 = jwt.decode(token2) as jwt.JwtPayload;

      expect(decoded1.jti).not.toBe(decoded2.jti);
    });

    it('should set default expiration to 5 minutes', () => {
      const token = generateBuilderJWT(testTokenAddress, testEndpoint, testSecret);
      const decoded = jwt.decode(token) as jwt.JwtPayload;

      // exp should be approximately iat + 300 seconds
      expect(decoded.exp).toBeDefined();
      expect(decoded.exp! - decoded.iat!).toBe(300);
    });

    it('should allow custom expiration time', () => {
      const token = generateBuilderJWT(testTokenAddress, testEndpoint, testSecret, '1h');
      const decoded = jwt.decode(token) as jwt.JwtPayload;

      // exp should be approximately iat + 3600 seconds
      expect(decoded.exp! - decoded.iat!).toBe(3600);
    });

    it('should be verifiable with the same secret', () => {
      const token = generateBuilderJWT(testTokenAddress, testEndpoint, testSecret);

      const decoded = jwt.verify(token, testSecret) as jwt.JwtPayload;
      expect(decoded.iss).toBe('iao-proxy');
    });

    it('should fail verification with wrong secret', () => {
      const token = generateBuilderJWT(testTokenAddress, testEndpoint, testSecret);

      expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
    });
  });

  describe('verifyBuilderJWT', () => {
    it('should return decoded payload for valid token', () => {
      const token = generateBuilderJWT(testTokenAddress, testEndpoint, testSecret);

      const result = verifyBuilderJWT(token, testSecret);

      expect(result).not.toBeNull();
      expect(result?.iss).toBe('iao-proxy');
      expect(result?.tokenAddress).toBe(testTokenAddress.toLowerCase());
    });

    it('should return null for invalid token', () => {
      const result = verifyBuilderJWT('invalid-token', testSecret);

      expect(result).toBeNull();
    });

    it('should return null for wrong secret', () => {
      const token = generateBuilderJWT(testTokenAddress, testEndpoint, testSecret);

      const result = verifyBuilderJWT(token, 'wrong-secret');

      expect(result).toBeNull();
    });

    it('should return null for expired token', async () => {
      // Generate token that expires in 1 second
      const token = generateBuilderJWT(testTokenAddress, testEndpoint, testSecret, '1s');

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      const result = verifyBuilderJWT(token, testSecret);

      expect(result).toBeNull();
    });

    it('should verify audience when provided', () => {
      const token = generateBuilderJWT(testTokenAddress, testEndpoint, testSecret);

      const resultCorrect = verifyBuilderJWT(token, testSecret, testEndpoint);
      expect(resultCorrect).not.toBeNull();

      const resultWrong = verifyBuilderJWT(token, testSecret, 'https://wrong.endpoint.com');
      expect(resultWrong).toBeNull();
    });

    it('should verify without audience when not provided', () => {
      const token = generateBuilderJWT(testTokenAddress, testEndpoint, testSecret);

      const result = verifyBuilderJWT(token, testSecret);
      expect(result).not.toBeNull();
    });

    it('should reject token with wrong issuer', () => {
      // Manually create a token with wrong issuer
      const wrongIssuerToken = jwt.sign(
        { iss: 'wrong-issuer', aud: testEndpoint },
        testSecret,
        { algorithm: 'HS256' }
      );

      const result = verifyBuilderJWT(wrongIssuerToken, testSecret);
      expect(result).toBeNull();
    });

    it('should reject token with wrong algorithm', () => {
      // Create token with different algorithm
      const wrongAlgoToken = jwt.sign(
        { iss: 'iao-proxy', aud: testEndpoint },
        testSecret,
        { algorithm: 'HS384' }
      );

      const result = verifyBuilderJWT(wrongAlgoToken, testSecret);
      expect(result).toBeNull();
    });
  });
});
