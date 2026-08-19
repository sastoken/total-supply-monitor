import { jsonResponse } from '../utils/response';

export function healthRoute(chainId: number): Response {
  return jsonResponse({ status: 'ok', chain_id: chainId, rpc: 'reachable' });
}
