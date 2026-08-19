import { createBscHealthReader, createBscReader } from './blockchain/client';
import { loadConfig, type AppConfig, type WorkerEnv } from './config';
import { circulatingSupplyRoute } from './routes/circulating-supply';
import { healthRoute } from './routes/health';
import { supplyJsonRoute } from './routes/supply-json';
import { totalSupplyRoute } from './routes/total-supply';
import { readSupplySnapshot, type RawSupplySnapshot, type SupplyReader } from './services/supply';
import { errorResponse, withoutBody } from './utils/response';

const SUPPLY_PATHS = new Set(['/total-supply', '/circulating-supply', '/supply.json']);
const ALL_PATHS = new Set([...SUPPLY_PATHS, '/health']);
const MAX_LOG_MESSAGE_LENGTH = 200;

function defaultCache(): Cache {
  return (caches as CacheStorage & { readonly default: Cache }).default;
}

type SnapshotReaderFactory = (config: AppConfig) => SupplyReader;
type HealthReaderFactory = (config: AppConfig) => {
  getChainId(): Promise<number>;
  getRpcProvider?(): string;
};

export interface HandlerDependencies {
  createSnapshotReader?: SnapshotReaderFactory;
  createHealthReader?: HealthReaderFactory;
  now?: () => string;
}

function defaultSnapshotReader(config: AppConfig): SupplyReader {
  return createBscReader(config);
}

function defaultHealthReader(config: AppConfig): {
  getChainId(): Promise<number>;
  getRpcProvider?(): string;
} {
  return createBscHealthReader(config);
}

function cacheKeyFor(request: Request): Request {
  return new Request(new URL(request.url).toString(), { method: 'GET' });
}

function buildSupplyResponse(
  path: string,
  snapshot: RawSupplySnapshot,
  config: AppConfig,
  now: () => string,
): Response {
  switch (path) {
    case '/total-supply':
      return totalSupplyRoute(snapshot, config);
    case '/circulating-supply':
      return circulatingSupplyRoute(snapshot, config);
    case '/supply.json':
      return supplyJsonRoute(snapshot, config, now());
    default:
      return errorResponse(404, 'not_found');
  }
}

async function cachedSupplyResponse(
  request: Request,
  ctx: ExecutionContext,
  config: AppConfig,
  getSnapshot: () => Promise<RawSupplySnapshot>,
  now: () => string,
): Promise<{ response: Response; snapshot: RawSupplySnapshot | null }> {
  const cacheKey = cacheKeyFor(request);
  const cached = await defaultCache().match(cacheKey);
  if (cached) return { response: cached, snapshot: null };

  const snapshot = await getSnapshot();
  const response = buildSupplyResponse(new URL(request.url).pathname, snapshot, config, now);

  ctx.waitUntil(
    defaultCache()
      .put(cacheKey, response.clone())
      .catch(() => logCacheWriteFailure()),
  );
  return { response, snapshot };
}

function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const stripped = raw.replace(/https?:\/\/[^\s"']+/g, '[url]');
  return stripped.length > MAX_LOG_MESSAGE_LENGTH
    ? `${stripped.slice(0, MAX_LOG_MESSAGE_LENGTH)}…`
    : stripped;
}

function logEvent(event: Record<string, string | number | undefined>): void {
  console.log(JSON.stringify(event));
}

function logCacheWriteFailure(): void {
  logEvent({ event: 'cache_write_failed' });
}

export async function handleRequest(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (url.search !== '') return errorResponse(404, 'not_found');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse(405, 'method_not_allowed');
  }
  if (!ALL_PATHS.has(url.pathname)) return errorResponse(404, 'not_found');

  const startedAt = Date.now();
  try {
    const config = loadConfig(env);
    const createSnapshotReader = dependencies.createSnapshotReader ?? defaultSnapshotReader;
    const createHealthReader = dependencies.createHealthReader ?? defaultHealthReader;
    const now = dependencies.now ?? (() => new Date().toISOString());

    let response: Response;
    if (url.pathname === '/health') {
      const healthReader = createHealthReader(config);
      const chainId = await healthReader.getChainId();
      if (chainId !== config.chainId) throw new Error(`unexpected chain ID: ${chainId}`);
      response = healthRoute(chainId);
      logEvent({
        event: 'health_check',
        endpoint: url.pathname,
        rpc_provider: healthReader.getRpcProvider?.(),
        duration_ms: Date.now() - startedAt,
        status: response.status,
      });
    } else {
      const { response: supplyResponse, snapshot } = await cachedSupplyResponse(
        request,
        ctx,
        config,
        () => {
          const reader = createSnapshotReader(config);
          return readSupplySnapshot(reader, config);
        },
        now,
      );
      response = supplyResponse;
      logEvent({
        event: 'supply_read',
        endpoint: url.pathname,
        block_number: snapshot?.blockNumber.toString(),
        rpc_provider: snapshot?.rpcProvider,
        cache: snapshot ? 'miss' : 'hit',
        duration_ms: Date.now() - startedAt,
        status: response.status,
      });
    }

    return request.method === 'HEAD' ? withoutBody(response) : response;
  } catch (error) {
    logEvent({
      event: 'supply_read_failed',
      endpoint: url.pathname,
      duration_ms: Date.now() - startedAt,
      status: 503,
      error: error instanceof Error ? error.name : 'unknown_error',
      error_message: sanitizeErrorMessage(error),
    });
    return errorResponse(503, 'supply_unavailable');
  }
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

export type { WorkerEnv };
