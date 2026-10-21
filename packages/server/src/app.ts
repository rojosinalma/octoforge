import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Db } from './db';
import type { Env } from './env';
import { SESSION_COOKIE, verifySession } from './lib/auth';
import { ActionError, type Credentials } from './lib/credentials';
import type { Database } from './lib/database';
import type { MemberRegistry } from './lib/members';
import type { SharedApp } from './lib/shared-app';
import { errMessage, log } from './log';
import { apiRoutes } from './routes/api';
import { authRoutes } from './routes/auth';
import { callbackRoutes } from './routes/callback';
import { healthRoutes } from './routes/health';
import { isZodError, jsonErr, zodMessage } from './routes/respond';

export interface AppDeps {
  env: Env;
  db: Db;
  members: MemberRegistry;
  credentials: Credentials;
  database: Database;
  sharedApp: SharedApp;
  sessionSecret: string;
}

/** Signed-in, or no login at all (`AUTH=none`). */
export function authenticated(
  deps: Pick<AppDeps, 'env' | 'sessionSecret'>,
  cookie: string | undefined,
): boolean {
  if (deps.env.auth === 'none') return true;
  return verifySession(deps.sessionSecret, cookie);
}

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const http = log('http');

  app.use('*', async (c, next) => {
    const started = performance.now();
    await next();
    // Path only: the query of /github/callback carries the one-time code.
    http.info(`${c.req.method} ${c.req.path}`, {
      status: c.res.status,
      ms: Math.round(performance.now() - started),
    });
  });

  app.use('*', async (c, next) => {
    await next();
    c.header('x-content-type-options', 'nosniff');
    c.header('referrer-policy', 'same-origin');
    c.header('x-frame-options', 'DENY');
  });

  app.onError((err, c) => {
    if (err instanceof ActionError) return jsonErr(c, err.kind, err.message);
    if (isZodError(err)) return jsonErr(c, 'validation', zodMessage(err));
    http.error(`unhandled error on ${c.req.path}`, { reason: errMessage(err) });
    return jsonErr(c, 'system', 'internal error');
  });

  app.route('/health', healthRoutes(deps));
  app.route('/auth', authRoutes(deps));

  app.use('/api/*', async (c, next) => {
    if (authenticated(deps, getCookie(c, SESSION_COOKIE))) return next();
    return jsonErr(c, 'auth', 'authentication required');
  });
  app.route('/api', apiRoutes(deps));
  app.all('/api/*', (c) => jsonErr(c, 'not_found', `no route for ${c.req.method} ${c.req.path}`));

  app.route('/github', callbackRoutes(deps));

  // Static SPA with index.html fallback. The bundle holds no data; the API behind it is what is gated.
  const dist = deps.env.webDist;
  const indexFile = path.join(dist, 'index.html');
  const hasDist = fs.existsSync(indexFile);
  if (!hasDist) log('boot').warn('web dist not found; only /api, /auth and /health are served', { dist });

  app.get('*', async (c) => {
    if (!hasDist) return c.text('octoforge server is running; web UI not built (WEB_DIST missing)', 404);
    const rel = decodeURIComponent(new URL(c.req.url).pathname);
    const target = path.resolve(dist, `.${rel}`);
    if (target.startsWith(dist) && target !== dist) {
      const file = Bun.file(target);
      if (await file.exists()) {
        const immutable = rel.startsWith('/assets/');
        return new Response(file, {
          headers: { 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' },
        });
      }
    }
    return new Response(Bun.file(indexFile), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
    });
  });

  return app;
}
