import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from '../src/boot';
import { type Env, loadEnv } from '../src/env';
import type { FetchLike } from '../src/lib/http';
import { configureLog } from '../src/log';

configureLog('silent');

export const TOKEN = 'm'.repeat(40);

export const MEMBERS = {
  members: [
    { name: 'alice-tool', repo: 'alice/alice-tool', homepage: 'https://alice-tool.example.com' },
    { name: 'bob-tool', repo: 'alice/bob-tool' },
  ],
};

export const MANIFEST = {
  contract: 1,
  name: 'alice-tool',
  title: 'Alice tool',
  description: 'Does things.',
  icon: '/favicon.svg',
  health: '/health',
  github: {
    auth: ['app', 'pat'],
    app: {
      permissions: { actions: 'write', metadata: 'read' },
      events: ['workflow_job'],
      webhook_path: '/webhooks/github',
    },
    pat: { classic_scopes: ['repo', 'workflow'], fine_grained: { actions: 'write' } },
  },
  database: { engines: ['sqlite', 'postgres'], schema: true },
  env: {
    github_token: 'GITHUB_TOKEN',
    app_id: 'GITHUB_APP_ID',
    app_private_key: 'GITHUB_APP_PRIVATE_KEY',
    app_webhook_secret: 'GITHUB_WEBHOOK_SECRET',
    app_installation_id: 'GITHUB_APP_INSTALLATION_ID',
  },
};

export interface Call {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

export type Handler = (call: Call) => Response | Promise<Response> | undefined;

/** A fetch that records every call and answers from `handler`; unknown URLs answer 404. */
export function mockFetch(handler: Handler): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const raw = init?.body;
    let body: unknown = raw;
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      headers: new Headers(init?.headers),
      body,
    };
    calls.push(call);
    const res = await handler(call);
    return res ?? new Response('not found', { status: 404 });
  };
  return { fetch: fetchImpl, calls };
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

export function testEnv(extra: Record<string, string> = {}): Env {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octoforge-test-'));
  const membersFile = path.join(dir, 'members.json');
  fs.writeFileSync(membersFile, JSON.stringify(MEMBERS));
  return loadEnv({
    AUTH: 'none',
    DATA_DIR: dir,
    DATABASE_URL: 'sqlite::memory:',
    MEMBERS_FILE: membersFile,
    OCTOFORGE_TOKEN: TOKEN,
    PUBLIC_URL: 'https://forge.example.com',
    SESSION_SECRET: 's'.repeat(40),
    WEB_DIST: path.join(dir, 'no-dist'),
    ...extra,
  });
}

export async function testApp(
  handler: Handler,
  extra: Record<string, string> = {},
  opts: Parameters<typeof build>[1] = {},
) {
  const env = testEnv(extra);
  const mock = mockFetch(handler);
  const built = await build(env, { fetchImpl: mock.fetch, ...opts });
  const req = async (method: string, url: string, body?: unknown) => {
    const res = await built.app.request(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary answer shapes.
    return { status: res.status, res, body: (await res.json().catch(() => null)) as Record<string, any> };
  };
  return { ...built, env, calls: mock.calls, req };
}
