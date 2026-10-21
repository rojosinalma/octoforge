import { describe, expect, test } from 'bun:test';
import { MemberClient } from '../src/lib/member-client';
import { json, MANIFEST, mockFetch, TOKEN } from './helpers';

const BASE = 'https://tool.example.com';

describe('MemberClient', () => {
  test('manifest: no bearer, parsed against the contract', async () => {
    const m = mockFetch((c) => (c.url === `${BASE}/api/octoforge/manifest` ? json(MANIFEST) : undefined));
    const r = await new MemberClient({
      baseUrl: `${BASE}/`,
      token: TOKEN,
      timeoutMs: 1000,
      fetchImpl: m.fetch,
    }).manifest();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.title).toBe('Alice tool');
    expect(m.calls[0]?.headers.get('authorization')).toBeNull();
  });

  test('status and delivery send the bearer and return the answer', async () => {
    const m = mockFetch((c) => {
      if (c.url.endsWith('/status'))
        return json({
          ok: true,
          message: 'status',
          contract: 1,
          version: '1.0.0',
          github: { mode: 'pat', source: 'env', login: 'alice' },
        });
      if (c.url.endsWith('/github') && c.method === 'PUT')
        return json({ ok: true, message: 'stored', login: 'alice', restart_required: false });
    });
    const client = new MemberClient({ baseUrl: BASE, token: TOKEN, timeoutMs: 1000, fetchImpl: m.fetch });
    const s = await client.status();
    expect(s.ok && s.data.github?.login).toBe('alice');
    const d = await client.putGithub({ mode: 'pat', token: 'ghp_x' });
    expect(d.ok && d.data.restart_required).toBe(false);
    for (const c of m.calls) expect(c.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(m.calls[1]?.body).toEqual({ mode: 'pat', token: 'ghp_x' });
  });

  test('401 names the token mismatch', async () => {
    const m = mockFetch(() => json({ ok: false, message: 'unauthorized' }, 401));
    const r = await new MemberClient({
      baseUrl: BASE,
      token: TOKEN,
      timeoutMs: 1000,
      fetchImpl: m.fetch,
    }).status();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('unauthorized');
      expect(r.status).toBe(401);
      expect(r.message).toContain('OCTOFORGE_TOKEN');
    }
  });

  test('timeout is reported as such', async () => {
    const slow: typeof fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const r = await new MemberClient({
      baseUrl: BASE,
      token: TOKEN,
      timeoutMs: 50,
      fetchImpl: slow,
    }).status();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('timeout');
      expect(r.message).toContain('50 ms');
    }
  });

  test('member API off (plain 404), refusal with a reason, network failure, no token', async () => {
    const off = mockFetch(() => new Response('Not Found', { status: 404 }));
    const r1 = await new MemberClient({
      baseUrl: BASE,
      token: TOKEN,
      timeoutMs: 1000,
      fetchImpl: off.fetch,
    }).status();
    expect(!r1.ok && r1.kind).toBe('disabled');

    const no = mockFetch(() => json({ ok: false, message: 'GitHub does not accept this token' }, 422));
    const r2 = await new MemberClient({
      baseUrl: BASE,
      token: TOKEN,
      timeoutMs: 1000,
      fetchImpl: no.fetch,
    }).putGithub({
      mode: 'pat',
      token: 'x',
    });
    expect(!r2.ok && r2.kind).toBe('rejected');
    expect(!r2.ok && r2.message).toBe('GitHub does not accept this token');

    const down: typeof fetch = (() =>
      Promise.reject(new TypeError('connection refused'))) as unknown as typeof fetch;
    const r3 = await new MemberClient({
      baseUrl: BASE,
      token: TOKEN,
      timeoutMs: 1000,
      fetchImpl: down,
    }).status();
    expect(!r3.ok && r3.kind).toBe('network');

    const r4 = await new MemberClient({ baseUrl: BASE, timeoutMs: 1000, fetchImpl: down }).status();
    expect(!r4.ok && r4.kind).toBe('disabled');
  });

  test('health: up on 2xx with latency, down otherwise', async () => {
    const m = mockFetch((c) =>
      c.url === `${BASE}/health` ? json({ ok: true }) : new Response('x', { status: 503 }),
    );
    const client = new MemberClient({ baseUrl: BASE, timeoutMs: 1000, fetchImpl: m.fetch });
    const up = await client.health('/health');
    expect(up.up).toBe(true);
    expect(up.ms).toBeGreaterThanOrEqual(0);
    const down = await client.health('/other');
    expect(down).toMatchObject({ up: false, httpStatus: 503 });
  });
});
