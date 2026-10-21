import { Engine, type InstanceStatus } from '@octoforge/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { ActionError } from '../lib/credentials';
import {
  addInstance,
  InstancePatch,
  listInstances,
  NewInstance,
  removeInstance,
  updateInstance,
} from '../lib/instances';
import { listLog } from '../lib/journal';
import { getSettings, patchSettings } from '../lib/settings';
import { VERSION } from '../version';
import { jsonErr, jsonOk } from './respond';

const Id = z.coerce.number().int().positive();
const AppStart = z.object({
  instanceId: z.number().int().positive(),
  name: z.string().trim().min(1).max(34),
  org: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/)
    .nullable()
    .default(null),
});
const PatBody = z.object({ token: z.string().min(1).max(255) });
const DeliverBody = z.object({
  instanceIds: z.array(z.number().int().positive()).min(1).max(50),
  installationId: z.number().int().positive().nullable().optional(),
});
const EnvBody = z.object({ installationId: z.number().int().positive().nullable().optional() });
const AdoptBody = z.object({ engine: Engine });
const LogQuery = z.object({
  kind: z.enum(['delivery', 'adoption']).optional(),
  member: z.string().optional(),
  before: z.string().optional(),
});

async function body<T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>): Promise<T> {
  const raw = await c.req.json().catch(() => {
    throw new ActionError('validation', 'body must be JSON');
  });
  return schema.parse(raw);
}

export function apiRoutes(deps: AppDeps) {
  const app = new Hono();
  const { db, members, credentials, database, env } = deps;

  const member = (name: string) => {
    const sub = members.find(name);
    if (!sub) throw new ActionError('not_found', `${name} is not a member`);
    return sub;
  };

  app.get('/capabilities', (c) =>
    jsonOk(c, 'capabilities', {
      capabilities: {
        authRequired: env.auth === 'password',
        memberToken: Boolean(env.OCTOFORGE_TOKEN),
        publicUrl: env.PUBLIC_URL ?? null,
        postgres: Boolean(env.FORGE_PG_ADMIN_URL),
        sharedData: env.OCTOFORGE_SHARED_DATA ?? null,
        version: VERSION,
      },
    }),
  );

  // Members ------------------------------------------------------------------

  app.get('/members', async (c) => {
    const fresh = c.req.query('fresh') === '1';
    const cards = await Promise.all(members.list().map((s) => members.card(s, { fresh })));
    return jsonOk(c, `${cards.length} members`, { members: cards });
  });

  app.get('/members/:m', async (c) => {
    const card = await members.card(member(c.req.param('m')), { fresh: c.req.query('fresh') === '1' });
    return jsonOk(c, card.name, { member: card });
  });

  app.get('/members/:m/status', async (c) => {
    const sub = member(c.req.param('m'));
    const statuses: InstanceStatus[] = await Promise.all(
      (await listInstances(db, sub.name)).map(async (instance) => {
        const r = await (await members.client(instance.baseUrl)).status();
        return r.ok
          ? { instance, ok: true, status: r.data, error: null }
          : { instance, ok: false, status: null, error: r.message };
      }),
    );
    return jsonOk(c, `${statuses.length} instances`, { statuses });
  });

  app.post('/members/:m/app', async (c) => {
    const input = await body(c, AppStart);
    const out = await credentials.startApp(member(c.req.param('m')).name, input);
    return jsonOk(c, 'post the manifest to GitHub', out);
  });

  app.post('/members/:m/pat', async (c) => {
    const { token } = await body(c, PatBody);
    const pending = await credentials.addToken(member(c.req.param('m')).name, token);
    const missing = pending.pat?.missing ?? [];
    return jsonOk(
      c,
      missing.length
        ? `token of ${pending.pat?.login} lacks ${missing.join(', ')}`
        : `token of ${pending.pat?.login} is valid`,
      { pending },
    );
  });

  app.delete('/members/:m/instances/:id/github', async (c) => {
    const sub = member(c.req.param('m'));
    const inst = (await listInstances(db, sub.name)).find((i) => i.id === Id.parse(c.req.param('id')));
    if (!inst) throw new ActionError('not_found', 'no such instance of this member');
    const r = await (await members.client(inst.baseUrl)).deleteGithub();
    if (!r.ok) return jsonErr(c, 'upstream', r.message);
    return jsonOk(c, r.data.message || 'delivered credential dropped', {
      restartRequired: r.data.restart_required ?? null,
    });
  });

  app.post('/members/:m/database', async (c) => {
    const { engine } = await body(c, AdoptBody);
    const out = await database.adopt(member(c.req.param('m')).name, engine);
    const failed = out.results.filter((r) => !r.ok).length;
    return jsonOk(c, failed ? `${failed} of ${out.results.length} instances failed` : 'adopted', out);
  });

  app.delete('/members/:m/instances/:id/database', async (c) => {
    const result = await database.release(member(c.req.param('m')).name, Id.parse(c.req.param('id')));
    if (!result.ok) return jsonErr(c, 'upstream', result.message);
    return jsonOk(c, result.message, { result });
  });

  // Instances ----------------------------------------------------------------

  app.get('/instances', async (c) => {
    const instances = await listInstances(db);
    return jsonOk(c, `${instances.length} instances`, { instances });
  });

  app.post('/instances', async (c) => {
    const input = await body(c, NewInstance);
    member(input.member);
    if ((await listInstances(db, input.member)).some((i) => i.baseUrl === input.baseUrl)) {
      throw new ActionError('conflict', `${input.baseUrl} is already an instance of ${input.member}`);
    }
    const instance = await addInstance(db, input);
    return jsonOk(c, `added ${instance.baseUrl}`, { instance });
  });

  app.patch('/instances/:id', async (c) => {
    const patch = await body(c, InstancePatch);
    const instance = await updateInstance(db, Id.parse(c.req.param('id')), patch);
    if (!instance) throw new ActionError('not_found', 'no such instance');
    return jsonOk(c, instance.publicUrl ? `public URL set to ${instance.publicUrl}` : 'public URL cleared', {
      instance,
    });
  });

  app.delete('/instances/:id', async (c) => {
    const removed = await removeInstance(db, Id.parse(c.req.param('id')));
    if (!removed) throw new ActionError('not_found', 'no such instance');
    return jsonOk(c, 'instance removed');
  });

  // Pending credentials ------------------------------------------------------

  app.get('/pending', (c) => {
    const pending = credentials.pending(c.req.query('member') || undefined);
    return jsonOk(c, `${pending.length} pending`, { pending });
  });

  app.delete('/pending/:id', (c) => {
    if (!credentials.discard(c.req.param('id'))) throw new ActionError('not_found', 'already gone');
    return jsonOk(c, 'discarded');
  });

  app.get('/pending/:id/installations', async (c) => {
    const r = await credentials.installations(c.req.param('id'));
    if (!r.ok) return jsonErr(c, 'upstream', r.message);
    return jsonOk(c, `${r.data.length} installations`, { installations: r.data });
  });

  app.post('/pending/:id/deliver', async (c) => {
    const input = await body(c, DeliverBody);
    const out = await credentials.deliver(c.req.param('id'), input);
    const failed = out.results.filter((r) => !r.ok).length;
    return jsonOk(c, failed ? `${failed} of ${out.results.length} deliveries failed` : 'delivered', out);
  });

  app.post('/pending/:id/env', async (c) => {
    const { installationId } = await body(c, EnvBody);
    const env = await credentials.envBlock(c.req.param('id'), installationId);
    c.header('cache-control', 'no-store');
    return jsonOk(c, 'copy it now: it is not shown again', { env });
  });

  // Log and settings ----------------------------------------------------------

  app.get('/log', async (c) => {
    const q = LogQuery.parse(c.req.query());
    const limit = (await getSettings(db)).logPageSize;
    const entries = await listLog(db, { ...q, limit });
    return jsonOk(c, `${entries.length} entries`, { entries, limit });
  });

  app.get('/settings', async (c) => jsonOk(c, 'settings', { settings: await getSettings(db) }));

  app.put('/settings', async (c) => {
    const settings = await patchSettings(db, await c.req.json().catch(() => null));
    return jsonOk(c, 'settings saved', { settings });
  });

  return app;
}
