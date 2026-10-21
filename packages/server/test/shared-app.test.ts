import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { listLog } from '../src/lib/journal';
import { configureLog } from '../src/log';
import { type Call, json, MANIFEST, testApp } from './helpers';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString().trim();
const KEY_BODY = PEM.split('\n')[1] ?? '';
const HOOK_SECRET = 'shared-hook-secret';

const BOB = {
  ...MANIFEST,
  name: 'bob-tool',
  title: 'Bob tool',
  github: {
    auth: ['app'],
    app: { permissions: { issues: 'write', statuses: 'read', metadata: 'read' }, events: [] },
  },
};

const APP = {
  id: 777,
  slug: 'acme-app',
  name: 'Acme App',
  owner: { login: 'acme', type: 'Organization' },
  html_url: 'https://github.com/apps/acme-app',
  permissions: { actions: 'write', metadata: 'read', issues: 'read' },
  events: ['workflow_job'],
};

function github(extra: (c: Call) => Response | undefined = () => undefined) {
  return (c: Call) => {
    if (c.url === 'https://a.example.com/api/octoforge/manifest') return json(MANIFEST);
    if (c.url === 'https://b.example.com/api/octoforge/manifest') return json(BOB);
    if (c.url.endsWith('/health')) return json({ ok: true });
    if (c.url === 'https://api.github.com/app') {
      if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(c.headers.get('authorization') ?? '')) return json({}, 401);
      return json(APP);
    }
    if (c.url.startsWith('https://api.github.com/app/installations')) {
      return json([
        { id: 11, account: { login: 'acme', type: 'Organization' }, permissions: { actions: 'write' } },
        { id: 12, account: { login: 'alice', type: 'User' }, permissions: APP.permissions },
      ]);
    }
    if (c.url === 'https://api.github.com/app-manifests/shared-code/conversions' && c.method === 'POST') {
      return json(
        { ...APP, id: 778, slug: 'octoforge', pem: PEM, webhook_secret: HOOK_SECRET, client_secret: 'x' },
        201,
      );
    }
    if (c.url.endsWith('/api/octoforge/status')) {
      return json({
        ok: true,
        contract: 1,
        version: '1.0.0',
        github: { mode: 'app', source: 'octoforge', app_id: 777, missing: ['issues:write', 'bogus'] },
      });
    }
    if (c.url.endsWith('/api/octoforge/github') && c.method === 'PUT')
      return json({ ok: true, message: 'stored', app_slug: 'acme-app', restart_required: false });
    return extra(c);
  };
}

async function setup(handler = github(), extra: Record<string, string> = {}) {
  const t = await testApp(handler, extra);
  const add = async (member: string, baseUrl: string) =>
    (await t.req('POST', '/api/instances', { member, baseUrl })).body.instance.id as number;
  const a = await add('alice-tool', 'https://a.example.com');
  const b = await add('bob-tool', 'https://b.example.com');
  return { t, a, b };
}

/** Runs `fn` with every log line captured. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ out: T; lines: string }> {
  const lines: string[] = [];
  const keep = { out: process.stdout.write, err: process.stderr.write };
  const grab = (chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  };
  process.stdout.write = grab as typeof process.stdout.write;
  process.stderr.write = grab as typeof process.stderr.write;
  configureLog('debug');
  try {
    return { out: await fn(), lines: lines.join('') };
  } finally {
    configureLog('silent');
    process.stdout.write = keep.out;
    process.stderr.write = keep.err;
  }
}

describe('shared App: existing App', () => {
  test('register → facts stored, key in memory only, never logged or returned', async () => {
    const { t } = await setup();
    const pasted = PEM.replace(/\n/g, '\\n');
    const { out: r, lines } = await captureLogs(() =>
      t.req('PUT', '/api/shared-app/key', { appId: 777, privateKey: pasted, webhookSecret: HOOK_SECRET }),
    );
    expect(r.status).toBe(200);
    expect(r.res.headers.get('cache-control')).toBe('no-store');
    const view = r.body.view;
    expect(view.app).toMatchObject({
      id: 777,
      slug: 'acme-app',
      owner: 'acme',
      ownerType: 'Organization',
      permissionsUrl: 'https://github.com/organizations/acme/settings/apps/acme-app/permissions',
    });
    expect(view.app.installations.map((i: { settingsUrl: string }) => i.settingsUrl)).toEqual([
      'https://github.com/organizations/acme/settings/installations/11',
      'https://github.com/settings/installations/12',
    ]);
    expect(view.key).toMatchObject({ hasWebhookSecret: true });
    expect(view.members.map((m: { name: string; missing: string[] }) => [m.name, m.missing])).toEqual([
      ['alice-tool', []],
      ['bob-tool', ['issues:write', 'statuses:read']],
    ]);
    expect(view.matrix.appMissing).toEqual(['issues:write', 'statuses:read']);
    expect(view.matrix.installationMissing['11']).toContain('metadata:read');

    // The key: never in an answer, a log line or the database.
    for (const text of [
      JSON.stringify(r.body),
      lines,
      JSON.stringify((await t.req('GET', '/api/shared-app')).body),
    ]) {
      expect(text).not.toContain('PRIVATE KEY');
      expect(text).not.toContain(KEY_BODY);
      expect(text).not.toContain(HOOK_SECRET);
    }
    const rows = await t.db.all<{ key: string; value: string }>(
      // biome-ignore lint/suspicious/noExplicitAny: raw query in a test.
      (await import('drizzle-orm')).sql`select key, value from settings` as any,
    );
    expect(JSON.stringify(rows)).not.toContain(KEY_BODY);
    expect(rows.map((x) => x.key)).toContain('shared_app');
    expect(lines).toContain('shared App registered');

    // The JWT was signed with the pasted key (literal \n turned into line breaks).
    const appCall = t.calls.find((c) => c.url === 'https://api.github.com/app');
    expect(appCall?.headers.get('authorization')).toMatch(/^Bearer /);
  });

  test('a bad key is refused before GitHub; a refused key is named', async () => {
    const { t } = await setup((c) =>
      c.url === 'https://api.github.com/app' ? json({ message: 'bad' }, 401) : undefined,
    );
    const garbage = await t.req('PUT', '/api/shared-app/key', { appId: 777, privateKey: 'nope' });
    expect(garbage.status).toBe(400);
    expect(t.calls.some((c) => c.url.startsWith('https://api.github.com'))).toBe(false);
    const refused = await t.req('PUT', '/api/shared-app/key', { appId: 777, privateKey: PEM });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe('GitHub does not accept this key for App 777');
    expect(t.store.size).toBe(0);
  });

  test('re-check reads GET /app again; without the key it says so; facts outlive the key', async () => {
    const { t } = await setup();
    await t.req('PUT', '/api/shared-app/key', { appId: 777, privateKey: PEM });
    const before = t.calls.filter((c) => c.url === 'https://api.github.com/app').length;
    expect((await t.req('POST', '/api/shared-app/recheck')).status).toBe(200);
    expect(t.calls.filter((c) => c.url === 'https://api.github.com/app').length).toBe(before + 1);
    await t.req('DELETE', '/api/shared-app/key');
    const r = await t.req('POST', '/api/shared-app/recheck');
    expect(r.status).toBe(503);
    expect(r.body.message).toContain('no longer in memory');
    const view = (await t.req('GET', '/api/shared-app')).body.view;
    expect(view.app.slug).toBe('acme-app');
    expect(view.key).toBeNull();
  });

  test('deliver to every app member instance, logged as shared, key dropped after', async () => {
    const { t, a, b } = await setup();
    await t.req('PUT', '/api/shared-app/key', { appId: 777, privateKey: PEM, webhookSecret: HOOK_SECRET });
    const r = await t.req('POST', '/api/shared-app/deliver', { instanceIds: [a, b], installationId: 12 });
    expect(r.status).toBe(200);
    expect(r.body.cleared).toBe(true);
    const puts = t.calls.filter((c) => c.url.endsWith('/api/octoforge/github'));
    expect(puts.map((c) => c.url)).toEqual([
      'https://a.example.com/api/octoforge/github',
      'https://b.example.com/api/octoforge/github',
    ]);
    expect(puts[0]?.body).toEqual({
      mode: 'app',
      app_id: 777,
      private_key: PEM,
      webhook_secret: HOOK_SECRET,
      installation_id: 12,
    });
    expect(JSON.stringify(r.body)).not.toContain(KEY_BODY);
    const log = await listLog(t.db, { kind: 'delivery', limit: 10 });
    expect(log.map((e) => e.member).sort()).toEqual(['alice-tool', 'bob-tool']);
    expect(log[0]?.detail).toMatchObject({ app: 'acme-app', app_id: 777, shared: true, installation_id: 12 });
    expect(JSON.stringify(log)).not.toContain(KEY_BODY);
    expect((await t.req('GET', '/api/shared-app')).body.view.key).toBeNull();
    expect((await t.req('POST', '/api/shared-app/deliver', { instanceIds: [a] })).status).toBe(404);
  });

  test('an unknown installation is refused', async () => {
    const { t, a } = await setup();
    await t.req('PUT', '/api/shared-app/key', { appId: 777, privateKey: PEM });
    const r = await t.req('POST', '/api/shared-app/deliver', { instanceIds: [a], installationId: 99 });
    expect(r.status).toBe(400);
  });
});

describe('shared App: create', () => {
  test('union manifest → callback → facts and key, back on the GitHub App page', async () => {
    const { t, a } = await setup();
    const start = await t.req('POST', '/api/shared-app/create', {
      name: 'Octoforge',
      org: 'acme',
      instanceId: a,
    });
    expect(start.status).toBe(200);
    expect(start.body.action).toBe(
      `https://github.com/organizations/acme/settings/apps/new?state=${start.body.state}`,
    );
    expect(start.body.manifest).toMatchObject({
      name: 'Octoforge',
      default_permissions: {
        actions: 'write',
        issues: 'write',
        metadata: 'read',
        statuses: 'read',
      },
      default_events: ['workflow_job'],
      hook_attributes: { url: 'https://a.example.com/webhooks/github', active: true },
      setup_url: 'https://forge.example.com/github-app',
      redirect_url: 'https://forge.example.com/github/callback',
    });
    const cb = await t.app.request(`/github/callback?code=shared-code&state=${start.body.state}`);
    expect(cb.status).toBe(303);
    const loc = new URL(cb.headers.get('location') ?? '', 'https://forge.example.com');
    expect(loc.pathname).toBe('/github-app');
    expect(loc.searchParams.get('created')).toBe('octoforge');
    const view = (await t.req('GET', '/api/shared-app')).body.view;
    expect(view.app).toMatchObject({ id: 778, slug: 'octoforge' });
    expect(view.key).toMatchObject({ hasWebhookSecret: true });
    expect(JSON.stringify(view)).not.toContain(KEY_BODY);
    // The state is single use; a member flow cannot reuse it either.
    const again = await t.app.request(`/github/callback?code=shared-code&state=${start.body.state}`);
    expect(again.headers.get('location')).toContain('error=');
  });

  test('the webhook member needs an instance of its own', async () => {
    const { t, b } = await setup();
    const r = await t.req('POST', '/api/shared-app/create', { name: 'Octoforge', instanceId: b });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('pick an instance of alice-tool for the webhooks');
  });
});

describe('index cards', () => {
  test('each instance shows its GitHub source, the shared App by slug and reported gaps', async () => {
    const { t } = await setup();
    await t.req('PUT', '/api/shared-app/key', { appId: 777, privateKey: PEM });
    const cards = (await t.req('GET', '/api/members')).body.members;
    const alice = cards.find((c: { name: string }) => c.name === 'alice-tool');
    expect(alice.instances[0].github).toEqual({
      mode: 'app',
      source: 'octoforge',
      appId: 777,
      appSlug: 'acme-app',
      login: null,
      missing: [],
    });
  });
});
