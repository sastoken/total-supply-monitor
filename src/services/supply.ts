import { formatUnits, type Address } from 'viem';

import { ERC20_ABI } from '../abi/erc20';
import type { AppConfig, NonCirculatingAddress } from '../config';

export interface SupplyReader {
  getBlockNumber(): Promise<bigint>;
  getChainId(): Promise<number>;
  getRpcProvider?(): string;
  readContract(args: {
    address: Address;
    abi: typeof ERC20_ABI;
    functionName: 'totalSupply' | 'decimals' | 'balanceOf';
    args?: readonly [Address];
    blockNumber: bigint;
  }): Promise<bigint | number>;
}

export interface RawSupplySnapshot {
  blockNumber: bigint;
  rpcProvider: string;
  decimals: number;
  totalSupplyRaw: bigint;
  nonCirculatingSupplyRaw: bigint;
  circulatingSupplyRaw: bigint;
  exclusionBalances: readonly {
    address: Address;
    label: string;
    balanceRaw: bigint;
  }[];
}

export interface SupplyMetadata {
  name: string;
  symbol: string;
  network: 'bsc';
  chain_id: 56;
  contract: Address;
  decimals: number;
  total_supply: string;
  circulating_supply: string;
  non_circulating_supply: string;
  block_number: string;
  updated_at: string;
}

export class SupplyInvariantError extends Error {
  constructor(message = 'circulating supply invariant failed') {
    super(message);
    this.name = 'SupplyInvariantError';
  }
}

export class DuplicateExclusionError extends Error {
  constructor(address: string) {
    super(`duplicate exclusion address: ${address}`);
    this.name = 'DuplicateExclusionError';
  }
}

export class ExternalContractValueError extends Error {
  constructor(field: string) {
    super(`invalid contract value: ${field}`);
    this.name = 'ExternalContractValueError';
  }
}

const UINT256_MAX = 2n ** 256n - 1n;

function toRawQuantity(value: bigint | number, field: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n || value > UINT256_MAX) throw new ExternalContractValueError(field);
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ExternalContractValueError(field);
  }
  return BigInt(value);
}

function toDecimals(value: bigint | number): number {
  const decimals = toRawQuantity(value, 'decimals');
  if (decimals > 255n) throw new ExternalContractValueError('decimals');
  return Number(decimals);
}

function assertBscChain(chainId: number): void {
  if (!Number.isInteger(chainId) || chainId !== 56) {
    throw new ExternalContractValueError('chain_id');
  }
}

export function validateExclusions(exclusions: readonly NonCirculatingAddress[]): void {
  const addresses = new Set<string>();
  for (const exclusion of exclusions) {
    const normalized = exclusion.address.toLowerCase();
    if (addresses.has(normalized)) throw new DuplicateExclusionError(exclusion.address);
    addresses.add(normalized);
  }
}

export function calculateCirculatingSupply(
  totalSupplyRaw: bigint,
  exclusionBalances: readonly bigint[],
): { nonCirculatingSupplyRaw: bigint; circulatingSupplyRaw: bigint } {
  const nonCirculatingSupplyRaw = exclusionBalances.reduce((sum, balance) => sum + balance, 0n);
  const circulatingSupplyRaw = totalSupplyRaw - nonCirculatingSupplyRaw;

  if (totalSupplyRaw < 0n || nonCirculatingSupplyRaw < 0n || circulatingSupplyRaw < 0n) {
    throw new SupplyInvariantError();
  }
  if (circulatingSupplyRaw > totalSupplyRaw) throw new SupplyInvariantError();

  return { nonCirculatingSupplyRaw, circulatingSupplyRaw };
}

export function formatSupply(raw: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError('decimals must be an integer from 0 to 255');
  }

  const formatted = formatUnits(raw, decimals);
  if (!formatted.includes('.')) return formatted;
  return formatted.replace(/0+$/, '').replace(/\.$/, '');
}

export async function readSupplySnapshot(
  client: SupplyReader,
  config: AppConfig,
): Promise<RawSupplySnapshot> {
  validateExclusions(config.exclusions);
  const chainId = await client.getChainId();
  assertBscChain(chainId);
  const blockNumber = await client.getBlockNumber();
  if (blockNumber < 0n) throw new ExternalContractValueError('block_number');

  const [totalSupplyResult, decimalsResult, ...balanceResults] = await Promise.all([
    client.readContract({
      address: config.tokenAddress,
      abi: ERC20_ABI,
      functionName: 'totalSupply',
      blockNumber,
    }),
    client.readContract({
      address: config.tokenAddress,
      abi: ERC20_ABI,
      functionName: 'decimals',
      blockNumber,
    }),
    ...config.exclusions.map((exclusion) =>
      client.readContract({
        address: config.tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [exclusion.address],
        blockNumber,
      }),
    ),
  ]);

  const totalSupplyRaw = toRawQuantity(totalSupplyResult, 'total_supply');
  const decimals = toDecimals(decimalsResult);
  const exclusionBalances = config.exclusions.map((exclusion, index) => ({
    address: exclusion.address,
    label: exclusion.label,
    balanceRaw: toRawQuantity(balanceResults[index], `balance:${exclusion.address}`),
  }));
  const { nonCirculatingSupplyRaw, circulatingSupplyRaw } = calculateCirculatingSupply(
    totalSupplyRaw,
    exclusionBalances.map(({ balanceRaw }) => balanceRaw),
  );

  return {
    blockNumber,
    rpcProvider: client.getRpcProvider?.() ?? 'unknown',
    decimals,
    totalSupplyRaw,
    nonCirculatingSupplyRaw,
    circulatingSupplyRaw,
    exclusionBalances,
  };
}

export function toSupplyMetadata(
  snapshot: RawSupplySnapshot,
  config: AppConfig,
  updatedAt = new Date().toISOString(),
): SupplyMetadata {
  return {
    name: config.tokenName,
    symbol: config.tokenSymbol,
    network: 'bsc',
    chain_id: 56,
    contract: config.tokenAddress,
    decimals: snapshot.decimals,
    total_supply: formatSupply(snapshot.totalSupplyRaw, snapshot.decimals),
    circulating_supply: formatSupply(snapshot.circulatingSupplyRaw, snapshot.decimals),
    non_circulating_supply: formatSupply(snapshot.nonCirculatingSupplyRaw, snapshot.decimals),
    block_number: snapshot.blockNumber.toString(),
    updated_at: updatedAt,
  };
}
