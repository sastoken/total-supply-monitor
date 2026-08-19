import { getAddress, isAddress, type Address } from 'viem';

export const SAL_TOKEN_ADDRESS = '0x65b98b81f2525efd6c3f49c44de56db7ea662551' as const;
export const SAL_PUBLIC_SALE_VESTING_ADDRESS =
  '0x67845b2fa5ec5b963cc7b0e871b1ae6d45833c25' as const;

export interface WorkerEnv {
  TOKEN_ADDRESS?: string;
  TOKEN_NAME?: string;
  TOKEN_SYMBOL?: string;
  CHAIN_ID?: string;
  CACHE_TTL?: string;
  RPC_TIMEOUT_MS?: string;
  BSC_RPC_URL_PRIMARY?: string;
  BSC_RPC_URL_SECONDARY?: string;
}

export interface NonCirculatingAddress {
  address: Address;
  label: string;
  reason: string;
  controllingParty: string;
  dynamic: true;
  evidence: string;
}

export interface AppConfig {
  tokenAddress: Address;
  tokenName: string;
  tokenSymbol: string;
  chainId: 56;
  cacheTtl: number;
  rpcTimeoutMs: number;
  rpcUrls: readonly [string, string];
  exclusions: readonly NonCirculatingAddress[];
}

export const NON_CIRCULATING_ADDRESSES: readonly NonCirculatingAddress[] = [
  {
    address: getAddress(SAL_PUBLIC_SALE_VESTING_ADDRESS),
    label: 'SAL Public Sale Vesting',
    reason: 'Public-sale allocation remains locked until claimed from the vesting contract',
    controllingParty: 'SAL vesting contract',
    dynamic: true,
    evidence: `https://bscscan.com/address/${SAL_PUBLIC_SALE_VESTING_ADDRESS}`,
  },
];

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

const MAX_CACHE_TTL_SECONDS = 86_400;
const MAX_RPC_TIMEOUT_MS = 60_000;

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  maximum: number,
): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new ConfigurationError(`${name} must be a positive integer`);

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new ConfigurationError(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return parsed;
}

function requiredRpcUrl(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new ConfigurationError(`${name} is required`);

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ConfigurationError(`${name} must be a valid URL`);
  }
  if (url.protocol !== 'https:') {
    throw new ConfigurationError(`${name} must use https`);
  }
  return trimmed;
}

export function loadConfig(env: WorkerEnv): AppConfig {
  const tokenAddress = env.TOKEN_ADDRESS ?? SAL_TOKEN_ADDRESS;
  if (!isAddress(tokenAddress)) throw new ConfigurationError('TOKEN_ADDRESS is invalid');

  const chainId = env.CHAIN_ID ?? '56';
  if (chainId !== '56') throw new ConfigurationError('CHAIN_ID must be 56 for BSC mainnet');

  const primaryRpcUrl = requiredRpcUrl(env.BSC_RPC_URL_PRIMARY, 'BSC_RPC_URL_PRIMARY');
  const secondaryRpcUrl = requiredRpcUrl(env.BSC_RPC_URL_SECONDARY, 'BSC_RPC_URL_SECONDARY');
  if (primaryRpcUrl.toLowerCase() === secondaryRpcUrl.toLowerCase()) {
    throw new ConfigurationError('BSC RPC URLs must be different');
  }

  return {
    tokenAddress: getAddress(tokenAddress),
    tokenName: env.TOKEN_NAME?.trim() || 'SAL',
    tokenSymbol: env.TOKEN_SYMBOL?.trim() || 'SAL',
    chainId: 56,
    cacheTtl: positiveInteger(env.CACHE_TTL, 60, 'CACHE_TTL', MAX_CACHE_TTL_SECONDS),
    rpcTimeoutMs: positiveInteger(env.RPC_TIMEOUT_MS, 5_000, 'RPC_TIMEOUT_MS', MAX_RPC_TIMEOUT_MS),
    rpcUrls: [primaryRpcUrl, secondaryRpcUrl],
    exclusions: NON_CIRCULATING_ADDRESSES,
  };
}
