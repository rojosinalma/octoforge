import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { type AppDeps, authenticated } from '../app';
import { SESSION_COOKIE } from '../lib/auth';
import { ActionError } from '../lib/credentials';
import { errMessage, log } from '../log';

/**
 * GitHub sends the browser back here after the App is created: `?code=…&state=…`. The code is
 * exchanged at once and never logged; the browser lands on the member's credentials page.
 */
export function callbackRoutes(deps: AppDeps) {
  const app = new Hono();
  const logger = log('github');

  app.get('/callback', async (c) => {
    const back = (where: string, q: Record<string, string>) =>
      c.redirect(`${where}?${new URLSearchParams(q)}`, 303);
    if (!authenticated(deps, getCookie(c, SESSION_COOKIE))) {
      return back('/', { error: 'Sign in first, then create the App again' });
    }
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return back('/', { error: 'GitHub sent no code: create the App again' });
    if (deps.sharedApp.ownsState(state)) {
      try {
        const app = await deps.sharedApp.finish(code, state);
        logger.info('shared App created', { app: app.slug, app_id: app.id });
        return back('/github-app', { created: app.slug });
      } catch (err) {
        const message = err instanceof ActionError ? err.message : `App creation failed: ${errMessage(err)}`;
        logger.warn('App callback failed', { reason: message });
        return back('/github-app', { error: message });
      }
    }
    try {
      const { member, pending } = await deps.credentials.finishApp(code, state);
      logger.info('App created', { member, app: pending.app?.slug, app_id: pending.app?.id });
      return back(`/members/${encodeURIComponent(member)}/credentials`, { pending: pending.id });
    } catch (err) {
      const message = err instanceof ActionError ? err.message : `App creation failed: ${errMessage(err)}`;
      logger.warn('App callback failed', { reason: message });
      return back('/', { error: message });
    }
  });

  return app;
}
