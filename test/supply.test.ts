import { describe, expect, it } from 'vitest';

import {
  DuplicateExclusionError,
  ExternalContractValueError,
  SupplyInvariantError,
  calculateCirculatingSupply,
  formatSupply,
  readSupplySnapshot,
  toSupplyMetadata,
  validateExclusions,
} from '../src/services/supply';
import { fixtureConfig, fixtureReader, VESTING_ADDRESS } from './fixtures';

describe('formatSupply', () => {
  it('formats 18-decimal values exactly', () => {
    expect(formatSupply(1_000_000_000n * 10n ** 18n, 18)).toBe('1000000000');
  });

  it('preserves fractions and trims only trailing zeroes', () => {
    expect(formatSupply(12_345_600n, 6)).toBe('12.3456');
  });

  it('supports non-18 decimals, zero, and large integers', () => {
    expect(formatSupply(123_456_789n, 2)).toBe('1234567.89');
    expect(formatSupply(0n, 18)).toBe('0');
    expect(formatSupply(2n ** 255n, 0)).toBe((2n ** 255n).toString());
  });

  it('rejects invalid decimals before formatting', () => {
    expect(() => formatSupply(1n, -1)).toThrow(RangeError);
    expect(() => formatSupply(1n, 256)).toThrow(RangeError);
    expect(() => formatSupply(1n, 1.5)).toThrow(RangeError);
  });
});

function readerWithResults(results: {
  chainId?: number;
  blockNumber?: bigint;
  totalSupply?: bigint | number;
  decimals?: bigint | number;
  balances?: readonly (bigint | number)[];
}) {
  let balanceIndex = 0;
  return {
    getBlockNumber: async () => results.blockNumber ?? 12_345_678n,
    getChainId: async () => results.chainId ?? 56,
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'totalSupply') return results.totalSupply ?? 1_000n;
      if (functionName === 'decimals') return results.decimals ?? 18;
      if (functionName === 'balanceOf') return results.balances?.[balanceIndex++] ?? 0n;
      throw new Error(`unexpected function: ${functionName}`);
    },
  };
}

function configWithTwoExclusions() {
  const config = fixtureConfig();
  return {
    ...config,
    exclusions: [
      ...config.exclusions,
      {
        ...config.exclusions[0],
        address: '0x0000000000000000000000000000000000000001' as const,
        label: 'Secondary lock',
      },
    ],
  };
}

describe('supply calculations', () => {
  it('subtracts dynamic exclusion balances', () => {
    expect(calculateCirculatingSupply(1_000n, [100n, 250n])).toEqual({
      nonCirculatingSupplyRaw: 350n,
      circulatingSupplyRaw: 650n,
    });
  });

  it('allows exclusions equal to total supply', () => {
    expect(calculateCirculatingSupply(250n, [250n]).circulatingSupplyRaw).toBe(0n);
  });

  it('rejects an invalid invariant', () => {
    expect(() => calculateCirculatingSupply(100n, [101n])).toThrow(SupplyInvariantError);
  });

  it('rejects duplicate exclusion addresses case-insensitively', () => {
    const exclusion = fixtureConfig().exclusions[0];
    expect(() =>
      validateExclusions([exclusion, { ...exclusion, address: VESTING_ADDRESS }]),
    ).toThrow(DuplicateExclusionError);
  });
});

describe('readSupplySnapshot', () => {
  it('reads and computes a consistent snapshot', async () => {
    const snapshot = await readSupplySnapshot(fixtureReader(), fixtureConfig());

    expect(snapshot.blockNumber).toBe(12_345_678n);
    expect(snapshot.totalSupplyRaw).toBe(1_000_000_000n * 10n ** 18n);
    expect(snapshot.nonCirculatingSupplyRaw).toBe(250_000_000n * 10n ** 18n);
    expect(snapshot.circulatingSupplyRaw).toBe(750_000_000n * 10n ** 18n);
  });

  it('serializes all quantities as strings', async () => {
    const snapshot = await readSupplySnapshot(fixtureReader(), fixtureConfig());
    const metadata = toSupplyMetadata(snapshot, fixtureConfig(), '2026-08-19T00:00:00.000Z');

    expect(metadata).toMatchObject({
      total_supply: '1000000000',
      circulating_supply: '750000000',
      non_circulating_supply: '250000000',
      block_number: '12345678',
      updated_at: '2026-08-19T00:00:00.000Z',
    });
  });

  it('fails closed when the RPC serves the wrong chain', async () => {
    const reader = readerWithResults({ chainId: 1 });
    await expect(readSupplySnapshot(reader, fixtureConfig())).rejects.toThrow(
      ExternalContractValueError,
    );
  });

  it('rejects malformed upstream quantities', async () => {
    await expect(
      readSupplySnapshot(readerWithResults({ totalSupply: -1n }), fixtureConfig()),
    ).rejects.toThrow(ExternalContractValueError);
    await expect(
      readSupplySnapshot(readerWithResults({ decimals: 999 }), fixtureConfig()),
    ).rejects.toThrow(ExternalContractValueError);
  });

  it('aggregates multiple exclusion balances on the same block', async () => {
    const config = configWithTwoExclusions();
    const reader = readerWithResults({
      totalSupply: 1_000n,
      balances: [100n, 50n],
    });
    const snapshot = await readSupplySnapshot(reader, config);

    expect(snapshot.totalSupplyRaw).toBe(1_000n);
    expect(snapshot.nonCirculatingSupplyRaw).toBe(150n);
    expect(snapshot.circulatingSupplyRaw).toBe(850n);
    expect(snapshot.exclusionBalances).toHaveLength(2);
  });

  it('pins every contract read to the same block number', async () => {
    const blockNumbers: bigint[] = [];
    const baseReader = fixtureReader();
    const snapshot = await readSupplySnapshot(
      {
        ...baseReader,
        readContract: async (args) => {
          blockNumbers.push(args.blockNumber);
          return baseReader.readContract(args);
        },
      },
      fixtureConfig(),
    );

    expect(blockNumbers).toEqual(Array(blockNumbers.length).fill(snapshot.blockNumber));
    expect(blockNumbers).toHaveLength(3);
  });
});
