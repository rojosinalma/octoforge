import { describe, expect, test } from 'bun:test';
import { parseGitmodules } from '../src/lib/members';
import { GITMODULES, json, MANIFEST, testApp } from './helpers';

describe('parseGitmodules', () => {
  test('reads path, url, homepage and the GitHub repo', () => {
    expect(parseGitmodules(GITMODULES)).toEqual([
      {
        name: 'alice-tool',
        path: 'alice-tool',
        url: 'https://github.com/alice/alice-tool.git',
        homepage: 'https://alice-tool.example.com',
        repo: 'alice/alice-tool',
      },
      {
        name: 'bob-tool',
        path: 'bob-tool',
        url: 'git@github.com:alice/bob-tool.git',
        homepage: null,
        repo: 'alice/bob-tool',
      },
    ]);
  });
});

describe('index', () => {
  test('cards: manifest from the instance, health, GitHub fallback, not deployed', async () => {
    const t = await testApp((c) => {
      if (c.url === 'https://tool.example.com/api/octoforge/manifest') return json(MANIFEST);
      if (c.url === 'https://tool.example.com/health') return json({ ok: true });
      if (c.url === 'https://raw.githubusercontent.com/alice/bob-tool/HEAD/octoforge.json') return undefined;
    });
    const add = await t.req('POST', '/api/instances', {
      member: 'alice-tool',
      baseUrl: 'https://tool.example.com/',
    });
    expect(add.body.instance.baseUrl).toBe('https://tool.example.com');
    const r = await t.req('GET', '/api/members');
    const [alice, bob] = r.body.members;
    expect(alice).toMatchObject({
      name: 'alice-tool',
      title: 'Alice tool',
      manifestSource: 'instance',
      icon: 'https://tool.example.com/favicon.svg',
      homepage: 'https://alice-tool.example.com',
      repoUrl: 'https://github.com/alice/alice-tool',
    });
    expect(alice.instances[0]).toMatchObject({ up: true, httpStatus: 200 });
    expect(bob).toMatchObject({
      name: 'bob-tool',
      title: 'Bob-tool',
      manifest: null,
      manifestSource: 'none',
      instances: [],
    });
    expect(bob.manifestError).toContain('no octoforge.json');
  });

  test('instances: member must be known, URL must be http(s), no duplicates', async () => {
    const t = await testApp(() => undefined);
    expect(
      (await t.req('POST', '/api/instances', { member: 'carol', baseUrl: 'https://x.example.com' })).status,
    ).toBe(404);
    expect(
      (await t.req('POST', '/api/instances', { member: 'alice-tool', baseUrl: 'ftp://x.example.com' }))
        .status,
    ).toBe(400);
    expect(
      (await t.req('POST', '/api/instances', { member: 'alice-tool', baseUrl: 'https://x.example.com' }))
        .status,
    ).toBe(200);
    const dup = await t.req('POST', '/api/instances', {
      member: 'alice-tool',
      baseUrl: 'https://x.example.com/',
    });
    expect(dup.status).toBe(409);
    const list = await t.req('GET', '/api/instances');
    expect(list.body.instances).toHaveLength(1);
    expect((await t.req('DELETE', `/api/instances/${list.body.instances[0].id}`)).status).toBe(200);
    expect((await t.req('DELETE', '/api/instances/999')).status).toBe(404);
  });

  test('settings: defaults, partial patch, validation', async () => {
    const t = await testApp(() => undefined);
    expect((await t.req('GET', '/api/settings')).body.settings.secretTtlMin).toBe(15);
    const p = await t.req('PUT', '/api/settings', { secretTtlMin: 5 });
    expect(p.body.settings).toMatchObject({ secretTtlMin: 5, secretStoreMax: 20 });
    expect((await t.req('PUT', '/api/settings', { secretTtlMin: 0 })).status).toBe(400);
    expect((await t.req('PUT', '/api/settings', { nope: 1 })).status).toBe(400);
  });

  test('health answers ok with the database state', async () => {
    const t = await testApp(() => undefined);
    const h = await t.req('GET', '/health');
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({ ok: true, db: 'ok' });
  });
});

describe('log lines', () => {
  test('secret-looking fields are redacted', async () => {
    const { log, configureLog } = await import('../src/log');
    const lines: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    configureLog('info');
    process.stdout.write = ((s: string) => {
      lines.push(s);
      return true;
    }) as typeof process.stdout.write;
    try {
      log('test').info('PUT https://a.example.com/api/octoforge/github', {
        status: 200,
        token: 'ghp_secret',
        private_key: 'k',
        webhookSecret: 'w',
      });
    } finally {
      process.stdout.write = orig;
      configureLog('silent');
    }
    expect(lines[0]).toContain('[test] PUT https://a.example.com/api/octoforge/github status=200');
    expect(lines[0]).toContain('token=[redacted]');
    expect(lines[0]).not.toContain('ghp_secret');
    expect(lines[0]).not.toMatch(/=k\b|=w\b/);
  });
});
