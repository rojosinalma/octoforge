import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { issueSession, SESSION_COOKIE, SESSION_TTL_MS, safeEqual, verifySession } from '../lib/auth';
import { log } from '../log';
import { jsonErr, jsonOk } from './respond';

const LoginBody = z.object({ password: z.string().min(1) });

/** `AUTH_PASSWORD` gate: login issues a signed HttpOnly cookie, status tells the SPA whether to ask. */
export function authRoutes(deps: Pick<AppDeps, 'env' | 'sessionSecret'>) {
  const app = new Hono();
  const required = deps.env.auth === 'password';
  const secure = (c: { req: { url: string; header(n: string): string | undefined } }) =>
    c.req.header('x-forwarded-proto') === 'https' || c.req.url.startsWith('https://');

  app.get('/status', (c) => {
    const authenticated = !required || verifySession(deps.sessionSecret, getCookie(c, SESSION_COOKIE));
    return jsonOk(c, authenticated ? 'authenticated' : 'login required', { authenticated, required });
  });

  app.post('/login', async (c) => {
    if (!required) return jsonOk(c, 'no password configured', { authenticated: true, required });
    const body = LoginBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return jsonErr(c, 'validation', 'password is required');
    if (!safeEqual(body.data.password, deps.env.AUTH_PASSWORD as string)) {
      log('auth').warn('login failed', { ip: c.req.header('x-forwarded-for') ?? null });
      return jsonErr(c, 'auth', 'wrong password');
    }
    setCookie(c, SESSION_COOKIE, issueSession(deps.sessionSecret), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: secure(c),
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    log('auth').info('login');
    return jsonOk(c, 'logged in', { authenticated: true, required });
  });

  app.post('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return jsonOk(c, 'logged out', { authenticated: !required, required });
  });

  return app;
}
