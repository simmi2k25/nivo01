import { deviceId } from './device';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Thrown when the server is unreachable or still waking up (Render answers with its own HTML page). */
export class WakingError extends ApiError {
  constructor() {
    super(503, 'NivoTalk is waking up — one moment…');
  }
}

type Opts = { method?: string; body?: unknown; raw?: Blob; signal?: AbortSignal };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const { method = opts.body || opts.raw ? 'POST' : 'GET', body, raw, signal } = opts;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      signal,
      headers: {
        'x-device-id': deviceId(),
        ...(raw ? { 'content-type': raw.type || 'application/octet-stream' } : body ? { 'content-type': 'application/json' } : {}),
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new WakingError();
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    if (res.status >= 500 || type.includes('text/html')) throw new WakingError();
    if (!res.ok) throw new ApiError(res.status, 'Something went wrong');
    return undefined as T;
  }
  const data = await res.json();
  // Not enough coins: the coin store opens so they can top up.
  if (res.status === 402) window.dispatchEvent(new CustomEvent('nivo:need-coins'));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Something went wrong');
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
