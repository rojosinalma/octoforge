import { errMessage, log } from '../log';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type HttpOutcome =
  | { ok: true; res: Response; ms: number }
  | { ok: false; kind: 'timeout' | 'network'; message: string; ms: number };

/**
 * One outgoing call with a timeout, logged as `METHOD target → outcome (ms)`. `target` is what the log
 * shows: callers pass a URL with nothing secret in it (no codes, no tokens).
 */
export async function timedFetch(
  subsystem: string,
  url: string,
  init: RequestInit & { timeoutMs: number; target?: string; fetchImpl?: FetchLike },
): Promise<HttpOutcome> {
  const { timeoutMs, target = url, fetchImpl = fetch, ...rest } = init;
  const method = (rest.method ?? 'GET').toUpperCase();
  const started = performance.now();
  const logger = log(subsystem);
  try {
    const res = await fetchImpl(url, {
      ...rest,
      method,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    const ms = Math.round(performance.now() - started);
    (res.ok ? logger.info : logger.warn)(`${method} ${target}`, { status: res.status, ms });
    return { ok: true, res, ms };
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      logger.warn(`${method} ${target}`, { outcome: 'timeout', ms });
      return { ok: false, kind: 'timeout', message: `timed out after ${timeoutMs} ms`, ms };
    }
    const reason = networkReason(err);
    logger.warn(`${method} ${target}`, { outcome: 'unreachable', reason, ms });
    return { ok: false, kind: 'network', message: `unreachable: ${reason}`, ms };
  }
}

/** Short reason for a failed connection: Bun's messages are long and vary between versions. */
export function networkReason(err: unknown): string {
  const code = String((err as { code?: unknown })?.code ?? '');
  const msg = errMessage(err);
  if (/ECONNREFUSED|ConnectionRefused/i.test(code + msg)) return 'connection refused';
  if (/ENOTFOUND|EAI_AGAIN|DNS|getaddrinfo/i.test(code + msg)) return 'host not found';
  if (/ECONNRESET|ConnectionClosed|socket/i.test(code + msg)) return 'connection closed';
  if (/CERT|TLS|SSL/i.test(code + msg)) return `TLS error: ${msg}`;
  return msg;
}

export async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
