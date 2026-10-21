import { type Manifest, MemberStatus, parseManifest } from '@octoforge/shared';
import { type FetchLike, readJson, timedFetch } from './http';

/** Failure of a member call, with a reason a person can act on. */
export type MemberErrKind = 'unauthorized' | 'disabled' | 'timeout' | 'network' | 'rejected' | 'invalid';

export type MemberResult<T> =
  | { ok: true; status: number; data: T; ms: number }
  | { ok: false; kind: MemberErrKind; status: number | null; message: string; ms: number };

export interface MemberClientOptions {
  baseUrl: string;
  /** OCTOFORGE_TOKEN; without it only the manifest and health can be read. */
  token?: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}

export interface GithubAnswer {
  message: string;
  login?: string;
  app_slug?: string;
  restart_required?: boolean;
}

export interface AdoptAnswer {
  message: string;
  tables?: Record<string, number>;
  restart_required?: boolean;
}

export type GithubBody =
  | { mode: 'pat'; token: string }
  | { mode: 'app'; app_id: number; private_key: string; webhook_secret: string; installation_id?: number };

const BASE = '/api/octoforge';

/** Client for the member API of docs/members.md, one instance per base URL. Never logs a body. */
export class MemberClient {
  private readonly base: string;
  constructor(private readonly opts: MemberClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
  }

  manifest(): Promise<MemberResult<Manifest>> {
    return this.call<unknown>('GET', `${BASE}/manifest`, undefined, { auth: false }).then((r) => {
      if (!r.ok) return r;
      // The document itself; an `{ok, manifest}` envelope is accepted too.
      const doc = r.data as { manifest?: unknown };
      const parsed = parseManifest(doc && typeof doc.manifest === 'object' ? doc.manifest : r.data);
      return parsed.ok
        ? { ...r, data: parsed.manifest }
        : {
            ok: false,
            kind: 'invalid',
            status: r.status,
            message: `bad manifest: ${parsed.error}`,
            ms: r.ms,
          };
    });
  }

  status(): Promise<MemberResult<MemberStatus>> {
    return this.call('GET', `${BASE}/status`).then((r) => {
      if (!r.ok) return r;
      const parsed = MemberStatus.safeParse(r.data);
      return parsed.success
        ? { ...r, data: parsed.data }
        : {
            ok: false,
            kind: 'invalid',
            status: r.status,
            message: 'status answer does not match the contract',
            ms: r.ms,
          };
    });
  }

  putGithub(body: GithubBody): Promise<MemberResult<GithubAnswer>> {
    return this.call<GithubAnswer>('PUT', `${BASE}/github`, body);
  }

  deleteGithub(): Promise<MemberResult<GithubAnswer>> {
    return this.call<GithubAnswer>('DELETE', `${BASE}/github`);
  }

  adopt(
    body: { url: string; schema: string; copy: boolean },
    timeoutMs?: number,
  ): Promise<MemberResult<AdoptAnswer>> {
    return this.call<AdoptAnswer>('POST', `${BASE}/database/adopt`, body, { timeoutMs });
  }

  dropDatabase(): Promise<MemberResult<AdoptAnswer>> {
    return this.call<AdoptAnswer>('DELETE', `${BASE}/database`);
  }

  /** GET <base><path>: up when it answers 2xx. */
  async health(
    path: string,
  ): Promise<{ up: boolean; httpStatus: number | null; ms: number; error: string | null }> {
    const out = await timedFetch('member', `${this.base}${path}`, {
      timeoutMs: this.opts.timeoutMs,
      fetchImpl: this.opts.fetchImpl,
    });
    if (!out.ok) return { up: false, httpStatus: null, ms: out.ms, error: out.message };
    await out.res.body?.cancel().catch(() => {});
    return {
      up: out.res.ok,
      httpStatus: out.res.status,
      ms: out.ms,
      error: out.res.ok ? null : `HTTP ${out.res.status}`,
    };
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { auth?: boolean; timeoutMs?: number } = {},
  ): Promise<MemberResult<T>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.auth !== false) {
      if (!this.opts.token) {
        return {
          ok: false,
          kind: 'disabled',
          status: null,
          message: 'OCTOFORGE_TOKEN is not set in Octoforge',
          ms: 0,
        };
      }
      headers.authorization = `Bearer ${this.opts.token}`;
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    const out = await timedFetch('member', `${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs: opts.timeoutMs ?? this.opts.timeoutMs,
      fetchImpl: this.opts.fetchImpl,
    });
    if (!out.ok) return { ok: false, kind: out.kind, status: null, message: out.message, ms: out.ms };
    const { res, ms } = out;
    const data = (await readJson(res)) as
      | (Record<string, unknown> & { ok?: boolean; message?: string })
      | null;
    if (res.status === 401) {
      return {
        ok: false,
        kind: 'unauthorized',
        status: 401,
        message:
          'the member rejected the bearer token: OCTOFORGE_TOKEN differs between Octoforge and the member',
        ms,
      };
    }
    if (res.status === 404 && !(data && data.ok === false && typeof data.message === 'string')) {
      return {
        ok: false,
        kind: 'disabled',
        status: 404,
        message:
          'the member API is off: set OCTOFORGE_TOKEN on the member, or upgrade it to a version with contract 1',
        ms,
      };
    }
    if (!data || typeof data !== 'object') {
      return {
        ok: false,
        kind: 'invalid',
        status: res.status,
        message: `HTTP ${res.status} without a JSON body`,
        ms,
      };
    }
    if (!res.ok || data.ok === false) {
      const reason = typeof data.message === 'string' && data.message ? data.message : `HTTP ${res.status}`;
      return { ok: false, kind: 'rejected', status: res.status, message: reason, ms };
    }
    return { ok: true, status: res.status, data: data as T, ms };
  }
}
