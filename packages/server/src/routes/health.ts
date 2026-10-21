import type { Health } from '@octoforge/shared';
import { Hono } from 'hono';
import type { AppDeps } from '../app';
import { VERSION } from '../version';

/** Never gated. 503 when the database does not answer. */
export function healthRoutes(deps: Pick<AppDeps, 'db'>) {
  const app = new Hono();
  app.get('/', async (c) => {
    const ok = await deps.db.ping();
    const body: Health = { ok, db: ok ? 'ok' : 'error', version: VERSION };
    return c.json(body, ok ? 200 : 503);
  });
  return app;
}
