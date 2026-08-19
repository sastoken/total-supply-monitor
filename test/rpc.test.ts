import { createPublicClient } from 'viem';
import { bsc } from 'viem/chains';
import { describe, expect, it } from 'vitest';

import {
  createRpcProviderTracker,
  createRpcTransport,
  describeRpcProviders,
} from '../src/blockchain/rpc';

const primaryUrl = 'https://primary.example';
const secondaryUrl = 'https://secondary.example';

function jsonRpcResponse(result: string): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createRpcTransport', () => {
  it('fails over from primary to secondary without transport retries', async () => {
    let primaryCalls = 0;
    let secondaryCalls = 0;
    const primaryFetch: typeof fetch = async () => {
      primaryCalls += 1;
      throw new Error('primary unavailable');
    };
    const secondaryFetch: typeof fetch = async () => {
      secondaryCalls += 1;
      return jsonRpcResponse('0x38');
    };
    const tracker = createRpcProviderTracker();
    const client = createPublicClient({
      chain: bsc,
      transport: createRpcTransport(
        {
          rpcUrls: [primaryUrl, secondaryUrl],
          timeoutMs: 100,
          fetchFns: [primaryFetch, secondaryFetch],
        },
        tracker,
      ),
    });

    await expect(client.getChainId()).resolves.toBe(56);
    expect(primaryCalls).toBe(1);
    expect(secondaryCalls).toBe(1);
    expect(describeRpcProviders(tracker)).toBe('primary,secondary');
  });

  it('does not call secondary when primary succeeds', async () => {
    let secondaryCalls = 0;
    const primaryFetch: typeof fetch = async () => jsonRpcResponse('0x38');
    const secondaryFetch: typeof fetch = async () => {
      secondaryCalls += 1;
      return jsonRpcResponse('0x38');
    };
    const tracker = createRpcProviderTracker();
    const client = createPublicClient({
      chain: bsc,
      transport: createRpcTransport(
        {
          rpcUrls: [primaryUrl, secondaryUrl],
          timeoutMs: 100,
          fetchFns: [primaryFetch, secondaryFetch],
        },
        tracker,
      ),
    });

    await expect(client.getChainId()).resolves.toBe(56);
    expect(secondaryCalls).toBe(0);
    expect(describeRpcProviders(tracker)).toBe('primary');
  });
});
