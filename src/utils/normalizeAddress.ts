/**
 * Normalize blockchain address for consistent storage and comparison.
 * EVM addresses (0x-prefixed) are lowercased.
 * Solana addresses (base58) are case-sensitive and preserved as-is.
 */
export function normalizeAddress(address: string): string {
  if (address.toLowerCase().startsWith('0x')) {
    return address.toLowerCase();
  }
  return address;
}
