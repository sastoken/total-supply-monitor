import { createPublicClient } from 'viem';
import { bsc } from 'viem/chains';

import { ERC20_ABI } from '../abi/erc20';
import type { AppConfig } from '../config';
import type { SupplyReader } from '../services/supply';
import { createRpcProviderTracker, createRpcTransport, describeRpcProviders } from './rpc';

function createClient(config: AppConfig) {
  const providerTracker = createRpcProviderTracker();
  const client = createPublicClient({
    chain: bsc,
    transport: createRpcTransport(
      {
        rpcUrls: config.rpcUrls,
        timeoutMs: config.rpcTimeoutMs,
      },
      providerTracker,
    ),
  });
  return { client, providerTracker };
}

export function createBscReader(config: AppConfig): SupplyReader {
  const { client, providerTracker } = createClient(config);

  return {
    getBlockNumber: () => client.getBlockNumber(),
    getChainId: () => client.getChainId(),
    getRpcProvider: () => describeRpcProviders(providerTracker),
    async readContract({ address, abi, functionName, args, blockNumber }) {
      if (functionName === 'balanceOf') {
        if (!args) throw new Error('balanceOf requires an address');
        return client.readContract({ address, abi, functionName, args, blockNumber });
      }

      return client.readContract({ address, abi: ERC20_ABI, functionName, blockNumber });
    },
  };
}

export function createBscHealthReader(config: AppConfig): {
  getChainId(): Promise<number>;
  getRpcProvider(): string;
} {
  const { client, providerTracker } = createClient(config);
  return {
    getChainId: () => client.getChainId(),
    getRpcProvider: () => describeRpcProviders(providerTracker),
  };
}
