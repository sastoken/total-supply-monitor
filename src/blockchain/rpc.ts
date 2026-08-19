import { fallback, http, type Transport } from 'viem';

export type RpcProvider = 'primary' | 'secondary';

export interface RpcProviderTracker {
  readonly used: Set<RpcProvider>;
}

export interface RpcTransportConfig {
  rpcUrls: readonly [string, string];
  timeoutMs: number;
  fetchFns?: readonly [typeof fetch, typeof fetch];
}

export function createRpcProviderTracker(): RpcProviderTracker {
  return { used: new Set<RpcProvider>() };
}

export function describeRpcProviders(tracker: RpcProviderTracker): string {
  if (tracker.used.size === 0) return 'unknown';
  return [...tracker.used].sort().join(',');
}

export function createRpcTransport(
  config: RpcTransportConfig,
  tracker = createRpcProviderTracker(),
): Transport {
  const [primary, secondary] = config.rpcUrls;
  const [primaryFetch, secondaryFetch] = config.fetchFns ?? [fetch, fetch];

  return fallback(
    [
      http(primary, {
        fetchFn: primaryFetch,
        onFetchRequest: () => {
          tracker.used.add('primary');
        },
        timeout: config.timeoutMs,
        retryCount: 0,
      }),
      http(secondary, {
        fetchFn: secondaryFetch,
        onFetchRequest: () => {
          tracker.used.add('secondary');
        },
        timeout: config.timeoutMs,
        retryCount: 0,
      }),
    ],
    {
      rank: false,
      retryCount: 0,
    },
  );
}
