import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../log';

export const SESSION_COOKIE = 'octoforge_session';
export const SESSION_TTL_MS = 30 * 86_400_000;

/** `SESSION_SECRET` from env, else a generated secret persisted at `DATA_DIR/session.secret` (0600). */
export function loadSessionSecret(envSecret: string | undefined, dataDir: string): string {
  if (envSecret) return envSecret;
  const file = path.join(dataDir, 'session.secret');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // not there yet
  }
  const secret = randomBytes(32).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  log('auth').info('generated session secret', { file });
  return secret;
}

/** Constant-time string compare; unequal lengths fail without leaking which length. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Cookie value: `<expiresAtMs>.<nonce>.<hmac>`. */
export function issueSession(secret: string, now = Date.now()): string {
  const payload = `${now + SESSION_TTL_MS}.${randomBytes(8).toString('hex')}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function verifySession(secret: string, value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [exp, nonce, mac] = parts as [string, string, string];
  if (!/^\d+$/.test(exp) || Number(exp) < now) return false;
  return safeEqual(sign(secret, `${exp}.${nonce}`), mac);
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1] ?? null;
}
