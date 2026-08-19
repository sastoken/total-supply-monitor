import type { AppConfig } from '../config';
import { toSupplyMetadata, type RawSupplySnapshot } from '../services/supply';
import { jsonResponse } from '../utils/response';

export function supplyJsonRoute(
  snapshot: RawSupplySnapshot,
  config: AppConfig,
  updatedAt?: string,
): Response {
  return jsonResponse(toSupplyMetadata(snapshot, config, updatedAt), 200, config.cacheTtl);
}
