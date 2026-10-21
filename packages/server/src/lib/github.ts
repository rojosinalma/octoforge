import { createSign } from 'node:crypto';
import type { Installation } from '@octoforge/shared';
import { parseScopes, tokenType } from '@octoforge/shared';
import { type FetchLike, readJson, timedFetch } from './http';

export const GITHUB_API = 'https://api.github.com';
const HEADERS = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };

export type GitHubResult<T> = { ok: true; data: T } | { ok: false; status: number | null; message: string };

/** What the manifest conversion hands over. client_id/client_secret are dropped: no member uses OAuth. */
export interface AppCredentials {
  id: number;
  slug: string;
  name: string;
  htmlUrl: string;
  owner: string | null;
  pem: string;
  webhookSecret: string;
}

export interface TokenCheck {
  login: string;
  tokenType: 'classic' | 'fine_grained' | 'other';
  scopes: string[] | null;
}

function failure(status: number, body: unknown): { ok: false; status: number; message: string } {
  const msg =
    body && typeof body === 'object' && 'message' in body
      ? String((body as { message: unknown }).message)
      : '';
  return {
    ok: false,
    status,
    message: msg ? `GitHub: ${msg} (HTTP ${status})` : `GitHub answered HTTP ${status}`,
  };
}

/** Signs an App JWT (RS256): valid 9 minutes, back-dated 60 s for clock drift. */
export function appJwt(appId: number, pem: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: nowSec - 60, exp: nowSec + 540, iss: String(appId) })}`;
  const sig = createSign('RSA-SHA256').update(body).sign(pem).toString('base64url');
  return `${body}.${sig}`;
}

export class GitHubClient {
  constructor(
    private readonly timeoutMs: () => Promise<number>,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  /** POST /app-manifests/{code}/conversions: the one-time code becomes the App and its credentials. */
  async convertManifest(code: string): Promise<GitHubResult<AppCredentials>> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(code)) return { ok: false, status: null, message: 'malformed code' };
    const out = await timedFetch('github', `${GITHUB_API}/app-manifests/${code}/conversions`, {
      method: 'POST',
      headers: HEADERS,
      timeoutMs: await this.timeoutMs(),
      target: `${GITHUB_API}/app-manifests/<code>/conversions`,
      fetchImpl: this.fetchImpl,
    });
    if (!out.ok) return { ok: false, status: null, message: out.message };
    const body = (await readJson(out.res)) as Record<string, unknown> | null;
    if (out.res.status !== 201 && out.res.status !== 200) return failure(out.res.status, body);
    if (
      !body ||
      typeof body.id !== 'number' ||
      typeof body.pem !== 'string' ||
      typeof body.slug !== 'string'
    ) {
      return { ok: false, status: out.res.status, message: 'GitHub answered without an App id, key or slug' };
    }
    const owner = body.owner as { login?: string } | null | undefined;
    return {
      ok: true,
      data: {
        id: body.id,
        slug: body.slug,
        name: String(body.name ?? body.slug),
        htmlUrl: String(body.html_url ?? `https://github.com/apps/${body.slug}`),
        owner: owner?.login ?? null,
        pem: body.pem,
        webhookSecret: typeof body.webhook_secret === 'string' ? body.webhook_secret : '',
      },
    };
  }

  /** GET /user with the token: who it acts as and, for classic tokens, which scopes it carries. */
  async checkToken(token: string): Promise<GitHubResult<TokenCheck>> {
    const out = await timedFetch('github', `${GITHUB_API}/user`, {
      headers: { ...HEADERS, authorization: `Bearer ${token}` },
      timeoutMs: await this.timeoutMs(),
      fetchImpl: this.fetchImpl,
    });
    if (!out.ok) return { ok: false, status: null, message: out.message };
    const body = (await readJson(out.res)) as { login?: string } | null;
    if (out.res.status === 401)
      return { ok: false, status: 401, message: 'GitHub does not accept this token' };
    if (!out.res.ok || !body?.login) return failure(out.res.status, body);
    const kind = tokenType(token);
    const header = out.res.headers.get('x-oauth-scopes');
    return {
      ok: true,
      data: {
        login: body.login,
        tokenType: kind,
        scopes: kind === 'fine_grained' ? null : parseScopes(header),
      },
    };
  }

  /** GET /app/installations with an App JWT: where the new App is installed. */
  async installations(appId: number, pem: string): Promise<GitHubResult<Installation[]>> {
    let jwt: string;
    try {
      jwt = appJwt(appId, pem);
    } catch {
      return { ok: false, status: null, message: 'the App key cannot sign a JWT' };
    }
    const out = await timedFetch('github', `${GITHUB_API}/app/installations?per_page=100`, {
      headers: { ...HEADERS, authorization: `Bearer ${jwt}` },
      timeoutMs: await this.timeoutMs(),
      fetchImpl: this.fetchImpl,
    });
    if (!out.ok) return { ok: false, status: null, message: out.message };
    const body = await readJson(out.res);
    if (!out.res.ok || !Array.isArray(body)) return failure(out.res.status, body);
    return {
      ok: true,
      data: body.map(
        (i: { id: number; account?: { login?: string; slug?: string; type?: string } | null }) => ({
          id: i.id,
          account: i.account?.login ?? i.account?.slug ?? `installation ${i.id}`,
          accountType: i.account?.type ?? 'User',
        }),
      ),
    };
  }
}
