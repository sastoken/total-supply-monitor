import type { AppConfig } from '../config';
import { formatSupply, type RawSupplySnapshot } from '../services/supply';
import { textResponse } from '../utils/response';

export function totalSupplyRoute(snapshot: RawSupplySnapshot, config: AppConfig): Response {
  return textResponse(formatSupply(snapshot.totalSupplyRaw, snapshot.decimals), config.cacheTtl);
}
