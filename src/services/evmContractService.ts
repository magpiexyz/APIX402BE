/**
 * EVM Contract Service
 * Handles interactions with IAO contracts on EVM chains (Base Sepolia)
 * Reads contract state: graduation threshold, tokens distributed, bonding progress
 * Uses viem for direct RPC calls — no Thirdweb dependency.
 */

import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import fs from 'fs';
import path from 'path';
import { normalizeAddress } from '../utils/normalizeAddress.js';

// Minimal ABI for EIP-5267 eip712Domain() — works on any token that supports it
const EIP5267ABI = [
  {
    name: 'eip712Domain',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'fields', type: 'bytes1' },
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
      { name: 'salt', type: 'bytes32' },
      { name: 'extensions', type: 'uint256[]' },
    ],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
];

// Load IAOToken ABI
let IAOTokenABI: any[] = [];
try {
  const abiPath = path.join(process.cwd(), 'abis/IAOToken.json');
  IAOTokenABI = JSON.parse(fs.readFileSync(abiPath, 'utf-8'));
} catch (error) {
  console.error('❌ Failed to load IAOToken ABI for evmContractService:', error);
}

// Load IAOTokenFactory ABI
let IAOTokenFactoryABI: any[] = [];
try {
  const factoryAbiPath = path.join(process.cwd(), 'abis/IAOTokenFactory.json');
  IAOTokenFactoryABI = JSON.parse(fs.readFileSync(factoryAbiPath, 'utf-8'));
} catch (error) {
  console.error('❌ Failed to load IAOTokenFactory ABI for evmContractService:', error);
}

/**
 * Token metrics from on-chain contract
 */
export interface EVMTokenMetrics {
  tokenAddress: string;
  graduationThreshold: string;      // BigInt as string
  totalTokensDistributed: string;   // BigInt as string
  totalFeesCollected: string;       // BigInt as string
  bondingProgress: number;          // Percentage (0-100)
  isGraduated: boolean;
  liquidityDeployed: boolean;
  paymentTokenPrice: string;        // BigInt as string
  paymentTokenDecimals: number;
}

/**
 * Factory info from on-chain contract
 */
export interface EVMFactoryInfo {
  factoryAddress: string;
  paymentToken: string;
  paymentTokenPrice: string;
  paymentTokenDecimals: number;
}

class EVMContractService {
  // typed as any to avoid strict viem 2.x generic inference issues with dynamic ABIs
  private client: any;
  private factoryAddress: string;

  constructor(factoryAddress: string) {
    this.factoryAddress = factoryAddress;
    const rpcUrl = process.env.RPC_URL || 'https://sepolia.base.org';
    this.client = createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    });
    console.log('✅ EVM Contract Service initialized (viem)');
  }

  /**
   * Get token metrics from on-chain contract
   */
  async getTokenMetrics(tokenAddress: string): Promise<EVMTokenMetrics | null> {
    try {
      const addr = tokenAddress as `0x${string}`;

      const [
        graduationThreshold,
        totalTokensDistributed,
        totalFeesCollected,
        liquidityDeployed,
        paymentTokenPrice,
        paymentTokenDecimals,
      ] = await Promise.all([
        this.client.readContract({ address: addr, abi: IAOTokenABI, functionName: 'graduationThreshold' }) as Promise<bigint>,
        this.client.readContract({ address: addr, abi: IAOTokenABI, functionName: 'totalTokensDistributed' }) as Promise<bigint>,
        this.client.readContract({ address: addr, abi: IAOTokenABI, functionName: 'totalFeesCollected' }) as Promise<bigint>,
        this.client.readContract({ address: addr, abi: IAOTokenABI, functionName: 'liquidityDeployed' }) as Promise<boolean>,
        this.client.readContract({ address: addr, abi: IAOTokenABI, functionName: 'paymentTokenPrice' }) as Promise<bigint>,
        this.client.readContract({ address: addr, abi: IAOTokenABI, functionName: 'paymentTokenDecimals' }) as Promise<number>,
      ]);

      const threshold = BigInt(graduationThreshold.toString());
      const distributed = BigInt(totalTokensDistributed.toString());
      const bondingProgress = threshold > 0n
        ? Number((distributed * 100n) / threshold)
        : 0;

      return {
        tokenAddress: normalizeAddress(tokenAddress),
        graduationThreshold: graduationThreshold.toString(),
        totalTokensDistributed: totalTokensDistributed.toString(),
        totalFeesCollected: totalFeesCollected.toString(),
        bondingProgress: Math.min(bondingProgress, 100),
        isGraduated: liquidityDeployed === true,
        liquidityDeployed: liquidityDeployed === true,
        paymentTokenPrice: paymentTokenPrice.toString(),
        paymentTokenDecimals: Number(paymentTokenDecimals),
      };
    } catch (error: any) {
      console.error(`❌ Failed to get EVM token metrics for ${tokenAddress}:`, error.message);
      return null;
    }
  }

  /**
   * Get factory info from on-chain contract
   */
  async getFactoryInfo(): Promise<EVMFactoryInfo | null> {
    try {
      const addr = this.factoryAddress as `0x${string}`;
      const paymentTokenInfo = await this.client.readContract({
        address: addr,
        abi: IAOTokenFactoryABI,
        functionName: 'paymentTokenInfo',
      }) as [string, bigint, number];

      return {
        factoryAddress: this.factoryAddress,
        paymentToken: paymentTokenInfo[0],
        paymentTokenPrice: paymentTokenInfo[1].toString(),
        paymentTokenDecimals: Number(paymentTokenInfo[2]),
      };
    } catch (error: any) {
      console.error(`❌ Failed to get EVM factory info:`, error.message);
      return null;
    }
  }

  /**
   * Check if a token exists on-chain
   */
  async tokenExists(tokenAddress: string): Promise<boolean> {
    try {
      await this.client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: IAOTokenABI,
        functionName: 'symbol',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get token symbol from contract
   */
  async getTokenSymbol(tokenAddress: string): Promise<string | null> {
    try {
      const symbol = await this.client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: IAOTokenABI,
        functionName: 'symbol',
      }) as string;
      return symbol;
    } catch {
      return null;
    }
  }

  /**
   * Get token name from contract
   */
  async getTokenName(tokenAddress: string): Promise<string | null> {
    try {
      const name = await this.client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: IAOTokenABI,
        functionName: 'name',
      }) as string;
      return name;
    } catch {
      return null;
    }
  }

  /**
   * Get EIP-712 domain name and version from a token contract.
   * Tries EIP-5267 eip712Domain() first; falls back to name() + version "2".
   */
  async getPaymentTokenDomain(tokenAddress: string): Promise<{ name: string; version: string }> {
    const addr = tokenAddress as `0x${string}`;
    try {
      const result = await this.client.readContract({
        address: addr,
        abi: EIP5267ABI,
        functionName: 'eip712Domain',
      }) as [string, string, string, bigint, string, string, bigint[]];
      const name = result[1];
      const version = result[2];
      if (name && version) {
        console.log(`✅ EIP-712 domain from contract: name="${name}" version="${version}"`);
        return { name, version };
      }
    } catch {
      // Contract doesn't support EIP-5267 — fall through to fallback
    }
    // Fallback: read name() and assume version "2" (standard for USDC)
    try {
      const name = await this.client.readContract({
        address: addr,
        abi: EIP5267ABI,
        functionName: 'name',
      }) as string;
      console.log(`⚠️  EIP-5267 not supported; using name()="${name}" version="2" for EIP-712 domain`);
      return { name, version: '2' };
    } catch {
      console.warn(`⚠️  Could not read EIP-712 domain for ${tokenAddress}; using fallback "USD Coin" v2`);
      return { name: 'USD Coin', version: '2' };
    }
  }

  /**
   * Calculate token amount from fee (same formula as contract)
   * Formula: (fee * paymentTokenPrice) / (10^paymentTokenDecimals)
   */
  calculateTokenAmount(fee: bigint, paymentTokenPrice: bigint, paymentTokenDecimals: number): bigint {
    const divisor = BigInt(10 ** paymentTokenDecimals);
    return (fee * paymentTokenPrice) / divisor;
  }
}

export { EVMContractService };
