import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  ConfigurationError,
  loadConfig,
  SAL_PUBLIC_SALE_VESTING_ADDRESS,
  SAL_TOKEN_ADDRESS,
  type WorkerEnv,
} from '../src/config';
const baseEnv: WorkerEnv = {
  TOKEN_ADDRESS: SAL_TOKEN_ADDRESS,
  TOKEN_NAME: 'SAL',
  TOKEN_SYMBOL: 'SAL',
  CHAIN_ID: '56',
  CACHE_TTL: '60',
  RPC_TIMEOUT_MS: '5000',
  BSC_RPC_URL_PRIMARY: 'https://bsc-dataseed.bnbchain.org',
  BSC_RPC_URL_SECONDARY: 'https://rpc-bsc.48.club',
};

function withEnv(overrides: Partial<WorkerEnv>): WorkerEnv {
  return { ...baseEnv, ...overrides };
}

describe('loadConfig', () => {
  it('parses a valid environment into a bounded BSC config', () => {
    const config = loadConfig(baseEnv);
    expect(config).toMatchObject({
      tokenAddress: getAddress(SAL_TOKEN_ADDRESS),
      tokenName: 'SAL',
      tokenSymbol: 'SAL',
      chainId: 56,
      cacheTtl: 60,
      rpcTimeoutMs: 5_000,
      rpcUrls: ['https://bsc-dataseed.bnbchain.org', 'https://rpc-bsc.48.club'],
    });
    expect(config.exclusions).toHaveLength(1);
    expect(config.exclusions[0].address).toBe(getAddress(SAL_PUBLIC_SALE_VESTING_ADDRESS));
  });

  it('applies defaults for optional token fields', () => {
    const config = loadEnvSkippingTokenFields();
    expect(config.tokenName).toBe('SAL');
    expect(config.tokenSymbol).toBe('SAL');
    expect(config.tokenAddress).toBe(getAddress(SAL_TOKEN_ADDRESS));
    expect(config.chainId).toBe(56);
    expect(config.cacheTtl).toBe(60);
    expect(config.rpcTimeoutMs).toBe(5_000);
  });

  it('rejects an invalid token address', () => {
    expect(() => loadConfig(withEnv({ TOKEN_ADDRESS: '0xnope' }))).toThrow(ConfigurationError);
  });

  it('rejects a chain ID other than 56', () => {
    expect(() => loadConfig(withEnv({ CHAIN_ID: '1' }))).toThrow(ConfigurationError);
  });

  it('rejects a missing primary RPC URL', () => {
    expect(() => loadConfig(withEnv({ BSC_RPC_URL_PRIMARY: undefined }))).toThrow(
      ConfigurationError,
    );
  });

  it('rejects a plaintext HTTP RPC URL to protect credentials', () => {
    expect(() => loadConfig(withEnv({ BSC_RPC_URL_PRIMARY: 'http://insecure.example' }))).toThrow(
      ConfigurationError,
    );
  });

  it('rejects a malformed RPC URL', () => {
    expect(() => loadConfig(withEnv({ BSC_RPC_URL_SECONDARY: 'not-a-url' }))).toThrow(
      ConfigurationError,
    );
  });

  it('rejects duplicate primary and secondary RPC URLs', () => {
    const duplicate = 'https://bsc-dataseed.bnbchain.org';
    expect(() =>
      loadConfig(withEnv({ BSC_RPC_URL_PRIMARY: duplicate, BSC_RPC_URL_SECONDARY: duplicate })),
    ).toThrow(ConfigurationError);
  });

  it('trims surrounding whitespace from RPC URLs', () => {
    const config = loadConfig(
      withEnv({
        BSC_RPC_URL_PRIMARY: '  https://bsc-dataseed.bnbchain.org  ',
        BSC_RPC_URL_SECONDARY: '  https://rpc-bsc.48.club  ',
      }),
    );
    expect(config.rpcUrls).toEqual([
      'https://bsc-dataseed.bnbchain.org',
      'https://rpc-bsc.48.club',
    ]);
  });

  it('rejects a non-integer or non-positive cache TTL', () => {
    expect(() => loadConfig(withEnv({ CACHE_TTL: '60.5' }))).toThrow(ConfigurationError);
    expect(() => loadConfig(withEnv({ CACHE_TTL: '0' }))).toThrow(ConfigurationError);
    expect(() => loadConfig(withEnv({ CACHE_TTL: '-10' }))).toThrow(ConfigurationError);
  });

  it('rejects a non-integer, non-positive, or unbounded RPC timeout', () => {
    expect(() => loadConfig(withEnv({ RPC_TIMEOUT_MS: 'fast' }))).toThrow(ConfigurationError);
    expect(() => loadConfig(withEnv({ RPC_TIMEOUT_MS: '0' }))).toThrow(ConfigurationError);
    expect(() => loadConfig(withEnv({ RPC_TIMEOUT_MS: '60001' }))).toThrow(ConfigurationError);
  });

  it('rejects an unbounded cache TTL', () => {
    expect(() => loadConfig(withEnv({ CACHE_TTL: '86401' }))).toThrow(ConfigurationError);
  });
});

function loadEnvSkippingTokenFields(): ReturnType<typeof loadConfig> {
  const { TOKEN_ADDRESS, TOKEN_NAME, TOKEN_SYMBOL, CHAIN_ID, CACHE_TTL, RPC_TIMEOUT_MS, ...rpc } =
    baseEnv;
  void TOKEN_ADDRESS;
  void TOKEN_NAME;
  void TOKEN_SYMBOL;
  void CHAIN_ID;
  void CACHE_TTL;
  void RPC_TIMEOUT_MS;
  return loadConfig(rpc);
}
