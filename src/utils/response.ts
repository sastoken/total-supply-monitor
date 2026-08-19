export function cacheControl(ttl: number): string {
  return `public, max-age=${ttl}, s-maxage=${ttl}`;
}

export function textResponse(body: string, ttl: number): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': cacheControl(ttl),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function jsonResponse(body: unknown, status = 200, ttl?: number): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  if (ttl !== undefined) headers.set('Cache-Control', cacheControl(ttl));
  else headers.set('Cache-Control', 'no-store');

  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(status: 404 | 405 | 503, code: string): Response {
  const response = jsonResponse({ error: code }, status);
  if (status === 405) response.headers.set('Allow', 'GET, HEAD');
  return response;
}

export function withoutBody(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');

  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
