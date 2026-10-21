import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { ConfigError, loadEnv, resolveAuth } from '../src/env';
import { testApp } from './helpers';

const SERVER = path.resolve(import.meta.dir, '../src/index.ts');

async function start(env: Record<string, string>) {
  // --no-env-file: a local .env in the working directory must not change what the test sees.
  const proc = Bun.spawn(['bun', '--no-env-file', SERVER], {
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      DATABASE_URL: 'sqlite::memory:',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => proc.kill(), 10_000);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, stderr: await new Response(proc.stderr).text() };
}

describe('auth is fail-closed', () => {
  test('resolveAuth needs a password or an explicit AUTH=none', () => {
    expect(resolveAuth('pw', undefined)).toBe('password');
    expect(resolveAuth(undefined, 'none')).toBe('none');
    expect(() => resolveAuth(undefined, undefined)).toThrow(ConfigError);
    expect(() => resolveAuth('pw', 'none')).toThrow('both set');
  });

  test('loadEnv refuses an empty AUTH_PASSWORD and other values of AUTH', () => {
    expect(() => loadEnv({ AUTH_PASSWORD: '' })).toThrow('AUTH_PASSWORD is not set');
    expect(() => loadEnv({ AUTH: 'off' })).toThrow('AUTH');
    expect(() => loadEnv({ AUTH: 'none', OCTOFORGE_TOKEN: 'short' })).toThrow('OCTOFORGE_TOKEN');
    expect(loadEnv({ AUTH_PASSWORD: 'pw' }).DATABASE_URL).toStartWith('sqlite:');
  });

  test('the server refuses to start without an auth decision', async () => {
    const r = await start({});
    expect(r.code).toBe(78);
    expect(r.stderr).toContain('refusing to start: AUTH_PASSWORD is not set');
  });

  test('the server refuses AUTH=none together with a password', async () => {
    const r = await start({ AUTH: 'none', AUTH_PASSWORD: 'pw' });
    expect(r.code).toBe(78);
    expect(r.stderr).toContain('both set');
  });
});

describe('password gate', () => {
  test('API needs a session; login with the right password issues one', async () => {
    const t = await testApp(() => undefined, { AUTH: '', AUTH_PASSWORD: 'correct horse' });
    expect((await t.req('GET', '/api/instances')).status).toBe(401);
    expect((await t.req('GET', '/health')).status).toBe(200);
    expect((await t.req('GET', '/auth/status')).body).toMatchObject({ authenticated: false, required: true });
    expect((await t.req('POST', '/auth/login', { password: 'wrong' })).status).toBe(401);
    const ok = await t.app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct horse' }),
    });
    expect(ok.status).toBe(200);
    const cookie = (ok.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(cookie).toStartWith('octoforge_session=');
    const res = await t.app.request('/api/instances', { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  test('the App callback needs a session too', async () => {
    const t = await testApp(() => undefined, { AUTH: '', AUTH_PASSWORD: 'pw' });
    const res = await t.app.request('/github/callback?code=abc&state=def');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('error=');
  });
});
