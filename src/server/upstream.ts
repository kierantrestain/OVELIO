export class UpstreamError extends Error {
  readonly service: string;
  readonly status: number;

  constructor(service: string, status: number, message?: string) {
    super(message ?? (status === 404 ? 'The requested item was not found.' : 'An engine could not complete this request.'));
    this.name = 'UpstreamError';
    this.service = service;
    this.status = status;
  }
}

export type UpstreamOptions = RequestInit & { fetch?: typeof fetch };

export async function upstream<T>(service: string, base: string, path: string, options: UpstreamOptions = {}): Promise<T> {
  const response = await upstreamResponse(service, base, path, options);
  if (response.status === 204) return undefined as T;
  try {
    return await response.json() as T;
  } catch {
    throw new UpstreamError(service, 502);
  }
}

export async function upstreamResponse(service: string, base: string, path: string, options: UpstreamOptions = {}) {
  if (!base || !path.startsWith('/') || path.startsWith('//')) throw new UpstreamError(service, 503);
  const { fetch: request = fetch, ...init } = options;
  const headers = new Headers(init.headers);
  headers.set('Accept', headers.get('Accept') ?? 'application/json');
  if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await request(base.replace(/\/$/, '') + path, {
      ...init,
      headers,
      cache: 'no-store',
      redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    throw new UpstreamError(service, 503);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new UpstreamError(service, response.status);
  }
  return response;
}

export function basic(username: string, password: string) {
  return 'Basic ' + Buffer.from(username + ':' + password, 'utf8').toString('base64');
}
