import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { listLog } from '../src/lib/journal';
import { type Call, json, MANIFEST, testApp } from './helpers';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const HOOK_SECRET = 'hook-secret-value';
const CLASSIC = `ghp_${'a'.repeat(36)}`;

function member(extra: (c: Call) => Response | undefined = () => undefined) {
  return (c: Call) => {
    if (c.url.endsWith('/api/octoforge/manifest')) return json(MANIFEST);
    if (c.url === 'https://api.github.com/app-manifests/good-code/conversions' && c.method === 'POST') {
      return json(
        {
          id: 4242,
          slug: 'alice-tool-app',
          name: 'Alice tool',
          html_url: 'https://github.com/apps/alice-tool-app',
          owner: { login: 'alice' },
          pem: PEM,
          webhook_secret: HOOK_SECRET,
          client_id: 'Iv1.x',
          client_secret: 'client-secret',
        },
        201,
      );
    }
    if (c.url.startsWith('https://api.github.com/app/installations')) {
      return json([{ id: 99, account: { login: 'alice', type: 'User' } }]);
    }
    if (c.url === 'https://api.github.com/user') {
      const auth = c.headers.get('authorization');
      if (auth === `Bearer ${CLASSIC}`) return json({ login: 'alice' }, 200, { 'x-oauth-scopes': 'repo' });
      return json({ message: 'Bad credentials' }, 401);
    }
    if (c.url.endsWith('/api/octoforge/github') && c.method === 'PUT') {
      if (c.url.startsWith('https://b.example.com'))
        return json({ ok: false, message: 'cannot write settings' }, 500);
      return json({ ok: true, message: 'stored', app_slug: 'alice-tool-app', restart_required: false });
    }
    if (c.url === 'https://fail.example.com/api/octoforge/database/adopt') {
      return json({ ok: false, message: 'row counts differ: jobs' }, 409);
    }
    if (c.url.endsWith('/api/octoforge/database/adopt')) {
      const copy = (c.body as { copy: boolean }).copy;
      return json({
        ok: true,
        message: copy ? 'copied' : 'switched',
        tables: copy ? { jobs: 3 } : {},
        restart_required: true,
      });
    }
    return extra(c);
  };
}

async function withInstances(t: Awaited<ReturnType<typeof testApp>>, urls: string[]) {
  const ids: number[] = [];
  for (const u of urls)
    ids.push((await t.req('POST', '/api/instances', { member: 'alice-tool', baseUrl: u })).body.instance.id);
  return ids;
}

describe('GitHub App flow', () => {
  test('start → callback → pending (no secret) → deliver → cleared and logged', async () => {
    const t = await testApp(member());
    const [a, b] = await withInstances(t, ['https://a.example.com', 'https://b.example.com']);

    const start = await t.req('POST', '/api/members/alice-tool/app', {
      instanceId: a,
      name: 'Alice tool',
      org: 'my-org',
    });
    expect(start.status).toBe(200);
    expect(start.body.action).toBe(
      `https://github.com/organizations/my-org/settings/apps/new?state=${start.body.state}`,
    );
    expect(start.body.manifest.hook_attributes.url).toBe('https://a.example.com/webhooks/github');
    expect(start.body.manifest.redirect_url).toBe('https://forge.example.com/github/callback');

    // A forged state is refused and never reaches GitHub.
    const forged = await t.app.request('/github/callback?code=good-code&state=forged');
    expect(forged.headers.get('location')).toContain('error=');
    expect(t.calls.some((c) => c.url.includes('/app-manifests/'))).toBe(false);

    const cb = await t.app.request(`/github/callback?code=good-code&state=${start.body.state}`);
    expect(cb.status).toBe(303);
    const loc = new URL(cb.headers.get('location') ?? '', 'https://forge.example.com');
    expect(loc.pathname).toBe('/members/alice-tool/credentials');
    const id = loc.searchParams.get('pending') ?? '';

    // The state is single use.
    const again = await t.app.request(`/github/callback?code=good-code&state=${start.body.state}`);
    expect(again.headers.get('location')).toContain('error=');

    const pending = await t.req('GET', '/api/pending?member=alice-tool');
    expect(pending.body.pending[0].app).toMatchObject({
      id: 4242,
      slug: 'alice-tool-app',
      installUrl: 'https://github.com/apps/alice-tool-app/installations/new',
    });
    const text = JSON.stringify(pending.body);
    expect(text).not.toContain('PRIVATE KEY');
    expect(text).not.toContain(HOOK_SECRET);

    const inst = await t.req('GET', `/api/pending/${id}/installations`);
    expect(inst.body.installations).toEqual([{ id: 99, account: 'alice', accountType: 'User' }]);
    const jwtCall = t.calls.find((c) => c.url.startsWith('https://api.github.com/app/installations'));
    expect(jwtCall?.headers.get('authorization')).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);

    // One instance fails: the secret stays for a retry.
    const d1 = await t.req('POST', `/api/pending/${id}/deliver`, { instanceIds: [a, b], installationId: 99 });
    expect(d1.body.cleared).toBe(false);
    expect(d1.body.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, false]);
    const put = t.calls.find((c) => c.url === 'https://a.example.com/api/octoforge/github');
    expect(put?.body).toEqual({
      mode: 'app',
      app_id: 4242,
      private_key: PEM,
      webhook_secret: HOOK_SECRET,
      installation_id: 99,
    });
    expect(put?.headers.get('authorization')).toStartWith('Bearer ');

    const d2 = await t.req('POST', `/api/pending/${id}/deliver`, { instanceIds: [a] });
    expect(d2.body.cleared).toBe(true);
    expect(t.store.get(id)).toBeNull();
    expect((await t.req('POST', `/api/pending/${id}/deliver`, { instanceIds: [a] })).status).toBe(404);

    const log = await listLog(t.db, { kind: 'delivery', limit: 10 });
    expect(log).toHaveLength(3);
    expect(log.filter((e) => e.ok)).toHaveLength(2);
    expect(JSON.stringify(log)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(log)).not.toContain(HOOK_SECRET);
    expect(log.find((e) => !e.ok)?.message).toBe('cannot write settings');
  });

  test('without PUBLIC_URL the flow cannot start', async () => {
    const t = await testApp(member(), { PUBLIC_URL: '' });
    const [a] = await withInstances(t, ['https://a.example.com']);
    const r = await t.req('POST', '/api/members/alice-tool/app', { instanceId: a, name: 'Alice tool' });
    expect(r.status).toBe(503);
    expect(r.body.message).toContain('PUBLIC_URL');
  });

  test('GitHub refusing the code reaches the user as a reason', async () => {
    const t = await testApp(member());
    const [a] = await withInstances(t, ['https://a.example.com']);
    const start = await t.req('POST', '/api/members/alice-tool/app', { instanceId: a, name: 'Alice tool' });
    const cb = await t.app.request(`/github/callback?code=expired&state=${start.body.state}`);
    const loc = new URL(cb.headers.get('location') ?? '', 'https://forge.example.com');
    expect(loc.searchParams.get('error')).toBe('GitHub answered HTTP 404');
  });
});

describe('token flow', () => {
  test('a classic token is checked, missing scopes are named, the .env block is shown once', async () => {
    const t = await testApp(member());
    await withInstances(t, ['https://a.example.com']);
    const bad = await t.req('POST', '/api/members/alice-tool/pat', { token: `ghp_${'b'.repeat(36)}` });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('GitHub does not accept this token');

    const r = await t.req('POST', '/api/members/alice-tool/pat', { token: CLASSIC });
    expect(r.body.pending.pat).toEqual({
      login: 'alice',
      tokenType: 'classic',
      scopes: ['repo'],
      missing: ['workflow'],
    });
    expect(r.body.message).toContain('lacks workflow');
    expect(JSON.stringify(r.body)).not.toContain(CLASSIC);

    const env = await t.req('POST', `/api/pending/${r.body.pending.id}/env`, {});
    expect(env.body.env).toContain(`GITHUB_TOKEN=${CLASSIC}`);
    expect(env.res.headers.get('cache-control')).toBe('no-store');
    expect((await t.req('POST', `/api/pending/${r.body.pending.id}/env`, {})).status).toBe(404);
    const log = await listLog(t.db, { limit: 10 });
    expect(log[0]).toMatchObject({ target: 'env block', action: 'pat', ok: true });
    expect(JSON.stringify(log)).not.toContain(CLASSIC);
  });

  test('garbage is refused before GitHub is asked; discard forgets', async () => {
    const t = await testApp(member());
    await withInstances(t, ['https://a.example.com']);
    expect((await t.req('POST', '/api/members/alice-tool/pat', { token: 'not a token' })).status).toBe(400);
    expect(t.calls.some((c) => c.url === 'https://api.github.com/user')).toBe(false);
    const r = await t.req('POST', '/api/members/alice-tool/pat', { token: CLASSIC });
    expect((await t.req('DELETE', `/api/pending/${r.body.pending.id}`)).status).toBe(200);
    expect((await t.req('GET', '/api/pending')).body.pending).toEqual([]);
  });
});

describe('database adoption', () => {
  test('SQLite: copy on the first instance, switch on the others, logged', async () => {
    const t = await testApp(member(), { OCTOFORGE_SHARED_DATA: '/shared/' });
    await withInstances(t, ['https://a.example.com', 'https://c.example.com']);
    const r = await t.req('POST', '/api/members/alice-tool/database', { engine: 'sqlite' });
    expect(r.status).toBe(200);
    expect(r.body.url).toBe('sqlite:/shared/alice-tool.db');
    const calls = t.calls.filter((c) => c.url.endsWith('/database/adopt'));
    expect(calls.map((c) => c.body)).toEqual([
      { url: 'sqlite:/shared/alice-tool.db', schema: 'alice-tool', copy: true },
      { url: 'sqlite:/shared/alice-tool.db', schema: 'alice-tool', copy: false },
    ]);
    expect(r.body.results.every((x: { restartRequired: boolean }) => x.restartRequired)).toBe(true);
    expect(await listLog(t.db, { kind: 'adoption', limit: 10 })).toHaveLength(2);
  });

  test('Postgres: provisions the role, passes its URL, never keeps or logs the password', async () => {
    let seen = '';
    const t = await testApp(
      member(),
      { FORGE_PG_ADMIN_URL: 'postgres://admin:adminpw@db.example.com:5432/octoforge' },
      {
        provision: async (_admin, m, password) => {
          expect(m).toBe('alice-tool');
          seen = password;
        },
      },
    );
    await withInstances(t, ['https://a.example.com']);
    const r = await t.req('POST', '/api/members/alice-tool/database', { engine: 'postgres' });
    expect(r.status).toBe(200);
    expect(seen).toMatch(/^[0-9a-f]{64}$/);
    const adopt = t.calls.find((c) => c.url.endsWith('/database/adopt'));
    expect(adopt?.body).toEqual({
      url: `postgres://alice-tool:${seen}@db.example.com:5432/octoforge`,
      schema: 'alice-tool',
      copy: true,
    });
    expect(JSON.stringify(r.body)).not.toContain(seen);
    expect(r.body.url).toContain('***');
    expect(t.store.size).toBe(0);
    const log = await listLog(t.db, { kind: 'adoption', limit: 10 });
    expect(JSON.stringify(log)).not.toContain(seen);
    expect(JSON.stringify(log)).not.toContain('adminpw');
  });

  test('a failed copy skips the other instances', async () => {
    const t = await testApp(member(), { OCTOFORGE_SHARED_DATA: '/shared' });
    await withInstances(t, ['https://fail.example.com', 'https://c.example.com']);
    const r = await t.req('POST', '/api/members/alice-tool/database', { engine: 'sqlite' });
    expect(r.body.message).toBe('2 of 2 instances failed');
    expect(r.body.results[0]).toMatchObject({ ok: false, copy: true, message: 'row counts differ: jobs' });
    expect(r.body.results[1].message).toContain('skipped');
    expect(t.calls.filter((c) => c.url.endsWith('/database/adopt'))).toHaveLength(1);
  });

  test('engines must be configured and supported', async () => {
    const t = await testApp(member());
    await withInstances(t, ['https://a.example.com']);
    expect((await t.req('POST', '/api/members/alice-tool/database', { engine: 'postgres' })).status).toBe(
      503,
    );
    expect((await t.req('POST', '/api/members/alice-tool/database', { engine: 'mysql' })).status).toBe(400);
  });
});
