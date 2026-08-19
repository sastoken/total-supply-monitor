import type { AppConfig } from '../config';
import { formatSupply, type RawSupplySnapshot } from '../services/supply';
import { textResponse } from '../utils/response';

export function circulatingSupplyRoute(snapshot: RawSupplySnapshot, config: AppConfig): Response {
  return textResponse(
    formatSupply(snapshot.circulatingSupplyRaw, snapshot.decimals),
    config.cacheTtl,
  );
}
