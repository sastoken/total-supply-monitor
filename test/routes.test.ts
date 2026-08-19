import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleRequest, type HandlerDependencies } from '../src';
import type { WorkerEnv } from '../src/config';
import { fixtureReader } from './fixtures';

const env: WorkerEnv = {
  TOKEN_ADDRESS: '0x65b98b81f2525efd6c3f49c44de56db7ea662551',
  TOKEN_NAME: 'SAL',
  TOKEN_SYMBOL: 'SAL',
  CHAIN_ID: '56',
  CACHE_TTL: '60',
  RPC_TIMEOUT_MS: '5000',
  BSC_RPC_URL_PRIMARY: 'https://primary.example',
  BSC_RPC_URL_SECONDARY: 'https://secondary.example',
};

const dependencies: HandlerDependencies = {
  createSnapshotReader: () => fixtureReader(),
  createHealthReader: () => ({ getChainId: async () => 56 }),
  now: () => '2026-08-19T00:00:00.000Z',
};

function cache(): Cache {
  return (caches as CacheStorage & { readonly default: Cache }).default;
}

async function request(path: string, method = 'GET', deps = dependencies): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await handleRequest(
    new Request(`https://api.sastoken.io${path}`, { method }),
    env,
    ctx,
    deps,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

describe('HTTP routes', () => {
  beforeEach(async () => {
    for (const path of ['/total-supply', '/circulating-supply', '/supply.json']) {
      await cache().delete(new Request(`https://api.sastoken.io${path}`));
    }
  });

  it('returns total supply as plain text', async () => {
    const response = await request('/total-supply');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60');
    expect(await response.text()).toBe('1000000000');
  });

  it('returns circulating supply as plain text', async () => {
    const response = await request('/circulating-supply');
    expect(await response.text()).toBe('750000000');
  });

  it('returns supply metadata JSON', async () => {
    const response = await request('/supply.json');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({
      name: 'SAL',
      symbol: 'SAL',
      network: 'bsc',
      chain_id: 56,
      contract: '0x65b98b81F2525eFd6C3F49c44dE56DB7Ea662551',
      decimals: 18,
      total_supply: '1000000000',
      circulating_supply: '750000000',
      non_circulating_supply: '250000000',
      block_number: '12345678',
      updated_at: '2026-08-19T00:00:00.000Z',
    });
  });

  it('rejects query strings on public endpoints', async () => {
    const response = await request('/total-supply?format=json');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('returns 503 when health observes the wrong chain', async () => {
    const response = await request('/health', 'GET', {
      ...dependencies,
      createHealthReader: () => ({ getChainId: async () => 1 }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'supply_unavailable' });
  });

  it('uses the cached response on a second request', async () => {
    let reads = 0;
    const responseDependencies: HandlerDependencies = {
      ...dependencies,
      createSnapshotReader: () => {
        reads += 1;
        return fixtureReader();
      },
    };

    expect(await (await request('/total-supply', 'GET', responseDependencies)).text()).toBe(
      '1000000000',
    );
    expect(await (await request('/total-supply', 'GET', responseDependencies)).text()).toBe(
      '1000000000',
    );
    expect(reads).toBe(1);
  });

  it('supports HEAD for JSON and health responses', async () => {
    expect(await (await request('/supply.json', 'HEAD')).text()).toBe('');
    expect(await (await request('/health', 'HEAD')).text()).toBe('');
  });

  it('does not use a numeric fallback when supply chain validation fails', async () => {
    const response = await request('/total-supply', 'GET', {
      ...dependencies,
      createSnapshotReader: () => ({
        ...fixtureReader(),
        getChainId: async () => 1,
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'supply_unavailable' });
  });

  it('does not expose RPC URLs in failure responses', async () => {
    const response = await request('/total-supply', 'GET', {
      ...dependencies,
      createSnapshotReader: () => ({
        ...fixtureReader(),
        getBlockNumber: async () => {
          throw new Error('request failed at https://secret:token@example.invalid/rpc');
        },
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
  });

  it('returns health without RPC secrets', async () => {
    const response = await request('/health');
    expect(await response.json()).toEqual({ status: 'ok', chain_id: 56, rpc: 'reachable' });
  });

  it('supports HEAD without a response body or stale content length', async () => {
    const response = await request('/total-supply', 'HEAD');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('returns 405 for unsupported methods', async () => {
    const response = await request('/total-supply', 'POST');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('returns 404 for unknown routes', async () => {
    expect((await request('/unknown')).status).toBe(404);
  });

  it('logs structured supply metadata including block number and provider', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await request('/supply.json');
    await waitOnExecutionContext(createExecutionContext());
    const lines = logSpy.mock.calls.map((call) => String(call[0]));
    const supplyLog = lines
      .map((line) => JSON.parse(line))
      .find((entry) => entry.event === 'supply_read');
    expect(supplyLog).toMatchObject({
      endpoint: '/supply.json',
      block_number: '12345678',
      rpc_provider: 'fixture',
      cache: 'miss',
      status: 200,
    });
    logSpy.mockRestore();
  });

  it('logs health checks separately from supply reads', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await request('/health');
    await waitOnExecutionContext(createExecutionContext());
    const entries = logSpy.mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(entries.some((entry) => entry.event === 'health_check')).toBe(true);
    expect(entries.some((entry) => entry.event === 'supply_read')).toBe(false);
    logSpy.mockRestore();
  });

  it('returns 503 without fabricated numbers on upstream failure', async () => {
    const failingDependencies: HandlerDependencies = {
      ...dependencies,
      createSnapshotReader: () => ({
        getBlockNumber: async () => {
          throw new Error('RPC down');
        },
        getChainId: async () => 56,
        readContract: async () => 0n,
      }),
    };
    const response = await request('/total-supply', 'GET', failingDependencies);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'supply_unavailable' });
  });
});
