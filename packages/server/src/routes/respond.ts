import type { ApiErr, ApiErrKind, ApiOk } from '@octoforge/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

export function jsonOk<T extends object>(c: Context, message: string, data?: T): Response {
  const body: ApiOk<T> = { ok: true, message, ...(data ?? ({} as T)) };
  return c.json(body, 200);
}

const STATUS: Record<ApiErrKind, ContentfulStatusCode> = {
  validation: 400,
  auth: 401,
  not_found: 404,
  conflict: 409,
  upstream: 502,
  unavailable: 503,
  system: 500,
};

export function jsonErr(
  c: Context,
  kind: ApiErrKind,
  message: string,
  status?: ContentfulStatusCode,
): Response {
  const body: ApiErr = { ok: false, kind, message };
  return c.json(body, status ?? STATUS[kind]);
}

/** Zod issues → one readable line: `pollIntervalMin: Too small; theme: Invalid option`. */
export function zodMessage(err: ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

export function isZodError(err: unknown): err is ZodError {
  return err instanceof ZodError;
}
