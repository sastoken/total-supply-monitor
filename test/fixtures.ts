import type { Address } from 'viem';

import { SAL_PUBLIC_SALE_VESTING_ADDRESS, SAL_TOKEN_ADDRESS, type AppConfig } from '../src/config';
import { ERC20_ABI } from '../src/abi/erc20';
import type { SupplyReader } from '../src/services/supply';

export const TOKEN_ADDRESS = SAL_TOKEN_ADDRESS as Address;
export const VESTING_ADDRESS = SAL_PUBLIC_SALE_VESTING_ADDRESS as Address;

export function fixtureConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    tokenAddress: TOKEN_ADDRESS,
    tokenName: 'SAL',
    tokenSymbol: 'SAL',
    chainId: 56,
    cacheTtl: 60,
    rpcTimeoutMs: 5_000,
    rpcUrls: ['https://primary.example', 'https://secondary.example'],
    exclusions: [
      {
        address: VESTING_ADDRESS,
        label: 'SAL Public Sale Vesting',
        reason: 'Locked public-sale allocation',
        controllingParty: 'SAL vesting contract',
        dynamic: true,
        evidence: 'https://bscscan.com/address/0x67845b2fa5ec5b963cc7b0e871b1ae6d45833c25',
      },
    ],
    ...overrides,
  };
}

export function fixtureReader(
  totalSupply = 1_000_000_000n * 10n ** 18n,
  decimals = 18,
  vestingBalance = 250_000_000n * 10n ** 18n,
): SupplyReader {
  return {
    getBlockNumber: async () => 12_345_678n,
    getChainId: async () => 56,
    getRpcProvider: () => 'fixture',
    readContract: async ({ functionName, args }) => {
      if (functionName === 'totalSupply') return totalSupply;
      if (functionName === 'decimals') return decimals;
      if (
        functionName === 'balanceOf' &&
        args?.[0].toLowerCase() === VESTING_ADDRESS.toLowerCase()
      ) {
        return vestingBalance;
      }
      throw new Error(`unexpected call: ${functionName}`);
    },
  };
}

export { ERC20_ABI };
