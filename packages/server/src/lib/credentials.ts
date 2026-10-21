import { randomBytes } from 'node:crypto';
import {
  appCreateUrl,
  appInstallUrl,
  buildAppManifest,
  buildEnvBlock,
  type DeliveryResult,
  type EnvValues,
  type GitHubAppManifest,
  type Installation,
  type Instance,
  type Manifest,
  missingScopes,
  type PendingCredential,
  type ResolvedPublicUrl,
  resolvePublicUrl,
} from '@octoforge/shared';
import type { Db } from '../db';
import type { AppCredentials, GitHubClient, GitHubResult } from './github';
import { getInstance, listInstances } from './instances';
import { logDelivery } from './journal';
import type { GithubBody } from './member-client';
import type { Member, MemberRegistry } from './members';
import type { SecretEntry, SecretStore } from './secrets';
import { getSettings } from './settings';

/** A failure the route turns into `{ok: false, kind, message}`. */
export class ActionError extends Error {
  constructor(
    readonly kind: 'validation' | 'not_found' | 'conflict' | 'upstream' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'ActionError';
  }
}

export interface StateMeta extends Record<string, unknown> {
  instanceId: number | null;
  org: string | null;
  /** The flow creates the shared App (GitHub App page), not an App of one member. */
  shared?: boolean;
}
type AppMeta = Omit<AppCredentials, 'pem' | 'webhookSecret'> & Record<string, unknown>;
interface AppSecret {
  pem: string;
  webhookSecret: string;
}
type PatMeta = NonNullable<PendingCredential['pat']> & Record<string, unknown>;
interface PatSecret {
  token: string;
}

export interface CredentialDeps {
  db: Db;
  store: SecretStore;
  members: MemberRegistry;
  github: GitHubClient;
  publicUrl: string | undefined;
}

/** The App manifest flow, token checks, and delivery to member instances or as an `.env` block. */
export class Credentials {
  constructor(private readonly deps: CredentialDeps) {}

  async limits() {
    const s = await getSettings(this.deps.db);
    return { ttlMs: s.secretTtlMin * 60_000, max: s.secretStoreMax };
  }

  async requireMember(name: string): Promise<{ entry: Member; manifest: Manifest }> {
    const entry = this.deps.members.find(name);
    if (!entry) throw new ActionError('not_found', `${name} is not a member`);
    const { manifest, error } = await this.deps.members.manifest(entry);
    if (!manifest)
      throw new ActionError('unavailable', `no manifest for ${name}${error ? `: ${error}` : ''}`);
    return { entry, manifest };
  }

  callbackUrl(): string {
    if (!this.deps.publicUrl) {
      throw new ActionError(
        'unavailable',
        'PUBLIC_URL is not set: GitHub needs it to send you back after creating the App',
      );
    }
    return `${this.deps.publicUrl}/github/callback`;
  }

  /** Step 1: the manifest and the form target; the browser posts it to GitHub. */
  async startApp(
    member: string,
    input: { instanceId: number; name: string; org: string | null },
  ): Promise<{ action: string; manifest: GitHubAppManifest; state: string }> {
    const { entry, manifest } = await this.requireMember(member);
    if (!manifest.github?.auth.includes('app'))
      throw new ActionError('validation', `${member} does not use a GitHub App`);
    const inst = await getInstance(this.deps.db, input.instanceId);
    if (!inst || inst.member !== member)
      throw new ActionError('validation', 'pick an instance of this member');
    const callbackUrl = this.callbackUrl();
    const target = await this.publicUrlOf(inst);
    let app: GitHubAppManifest;
    let action: string;
    const state = randomBytes(24).toString('hex');
    try {
      app = buildAppManifest({
        manifest,
        name: input.name,
        homepage: entry.homepage ?? `https://github.com/${entry.repo}`,
        publicUrl: target.url,
        callbackUrl,
      });
      action = appCreateUrl(state, input.org);
    } catch (err) {
      throw new ActionError('validation', (err as Error).message);
    }
    const { ttlMs, max } = await this.limits();
    this.put({
      kind: 'state',
      member,
      id: state,
      secret: null,
      meta: { instanceId: inst.id, org: input.org },
      ttlMs,
      max,
    });
    return { action, manifest: app, state };
  }

  /**
   * The address GitHub uses for an instance. The member's status is asked only when Octoforge has no
   * public URL of its own for it; an unreachable member falls back to the base URL.
   */
  async publicUrlOf(inst: Instance): Promise<ResolvedPublicUrl> {
    if (inst.publicUrl) return resolvePublicUrl(inst);
    const r = await (await this.deps.members.client(inst.baseUrl)).status();
    return resolvePublicUrl(inst, r.ok ? r.data.public_url : null);
  }

  /** Step 2 (GitHub redirect): checks `state`, exchanges the code, keeps the credentials in memory. */
  async finishApp(code: string, state: string): Promise<{ member: string; pending: PendingCredential }> {
    const st = this.deps.store.take<null, StateMeta>(state, 'state');
    if (st?.meta.shared) throw new ActionError('validation', 'this state belongs to the shared App');
    if (!st) throw new ActionError('validation', 'unknown or expired state: start the App creation again');
    const conv = await this.deps.github.convertManifest(code);
    if (!conv.ok) throw new ActionError('upstream', conv.message);
    const { pem, webhookSecret, ...meta } = conv.data;
    const { ttlMs, max } = await this.limits();
    const entry = this.put<AppSecret, AppMeta>({
      kind: 'app',
      member: st.member,
      secret: { pem, webhookSecret },
      meta: { ...meta },
      ttlMs,
      max,
    });
    return { member: st.member, pending: this.view(entry) };
  }

  /** Checks a pasted token against GitHub and the member's required scopes, then holds it. */
  async addToken(member: string, token: string): Promise<PendingCredential> {
    const { manifest } = await this.requireMember(member);
    const pat = manifest.github?.pat;
    if (!pat || !manifest.github?.auth.includes('pat')) {
      throw new ActionError('validation', `${member} does not take a personal access token`);
    }
    const trimmed = token.trim();
    if (!/^[A-Za-z0-9_]{20,255}$/.test(trimmed))
      throw new ActionError('validation', 'this does not look like a GitHub token');
    const check = await this.deps.github.checkToken(trimmed);
    if (!check.ok) throw new ActionError(check.status === 401 ? 'validation' : 'upstream', check.message);
    const missing = check.data.scopes ? missingScopes(pat.classic_scopes, check.data.scopes) : [];
    const { ttlMs, max } = await this.limits();
    const entry = this.put<PatSecret, PatMeta>({
      kind: 'pat',
      member,
      secret: { token: trimmed },
      meta: { login: check.data.login, tokenType: check.data.tokenType, scopes: check.data.scopes, missing },
      ttlMs,
      max,
    });
    return this.view(entry);
  }

  pending(member?: string): PendingCredential[] {
    return this.deps.store
      .list({ member, kinds: ['app', 'pat'] })
      .map((e) => this.view({ ...e, secret: undefined }));
  }

  discard(id: string): boolean {
    const e = this.deps.store.get(id);
    if (!e || (e.kind !== 'app' && e.kind !== 'pat')) return false;
    return this.deps.store.delete(id);
  }

  async installations(id: string): Promise<GitHubResult<Installation[]>> {
    const e = this.deps.store.get<AppSecret, AppMeta>(id, 'app');
    if (!e) throw new ActionError('not_found', 'this credential expired or was delivered already');
    return this.deps.github.installations(e.meta.id, e.secret.pem);
  }

  /** PUT /api/octoforge/github on each instance. The secret is dropped once every target took it. */
  async deliver(
    id: string,
    input: { instanceIds: number[]; installationId?: number | null },
  ): Promise<{ results: DeliveryResult[]; cleared: boolean }> {
    const e = this.deps.store.get<AppSecret | PatSecret, AppMeta | PatMeta>(id);
    if (!e || (e.kind !== 'app' && e.kind !== 'pat')) {
      throw new ActionError('not_found', 'this credential expired or was delivered already');
    }
    const all = await listInstances(this.deps.db, e.member);
    const targets = all.filter((i) => input.instanceIds.includes(i.id));
    if (!targets.length) throw new ActionError('validation', 'pick at least one instance');
    const body: GithubBody =
      e.kind === 'pat'
        ? { mode: 'pat', token: (e.secret as PatSecret).token }
        : {
            mode: 'app',
            app_id: (e.meta as AppMeta).id,
            private_key: (e.secret as AppSecret).pem,
            webhook_secret: (e.secret as AppSecret).webhookSecret,
            ...(input.installationId ? { installation_id: input.installationId } : {}),
          };
    const results = await Promise.all(
      targets.map((inst) =>
        this.deliverTo(e.member, e.kind as 'app' | 'pat', inst, body, this.logDetail(e.kind, e.meta)),
      ),
    );
    const cleared = results.every((r) => r.ok);
    if (cleared) this.deps.store.delete(id);
    return { results, cleared };
  }

  private logDetail(kind: string, meta: AppMeta | PatMeta): Record<string, unknown> {
    return kind === 'app'
      ? { app: (meta as AppMeta).slug, app_id: (meta as AppMeta).id }
      : { login: (meta as PatMeta).login, token_type: (meta as PatMeta).tokenType };
  }

  /** One `PUT /api/octoforge/github`, logged with `detail` plus the member's answer. Never logs the body. */
  async deliverTo(
    member: string,
    kind: 'app' | 'pat',
    inst: Instance,
    body: GithubBody,
    baseDetail: Record<string, unknown>,
  ): Promise<DeliveryResult> {
    const r = await (await this.deps.members.client(inst.baseUrl)).putGithub(body);
    const result: DeliveryResult = r.ok
      ? {
          instance: inst,
          ok: true,
          message: r.data.message || 'delivered',
          restartRequired: r.data.restart_required ?? null,
        }
      : { instance: inst, ok: false, message: r.message, restartRequired: null };
    const detail: Record<string, unknown> = { ...baseDetail };
    if (r.ok && r.data.login) detail.member_login = r.data.login;
    if (r.ok && r.data.app_slug) detail.member_app = r.data.app_slug;
    if (result.restartRequired !== null) detail.restart_required = result.restartRequired;
    if ('installation_id' in body && body.installation_id) detail.installation_id = body.installation_id;
    await logDelivery(this.deps.db, {
      member,
      target: inst.baseUrl,
      action: kind,
      ok: result.ok,
      message: result.message,
      detail,
    });
    return result;
  }

  /** The fallback: an `.env` block with the member's variable names. Shown once, then the secret is gone. */
  async envBlock(id: string, installationId?: number | null): Promise<string> {
    const e = this.deps.store.take<AppSecret | PatSecret, AppMeta | PatMeta>(id);
    if (!e || (e.kind !== 'app' && e.kind !== 'pat')) {
      throw new ActionError('not_found', 'this credential expired or was delivered already');
    }
    const entry = this.deps.members.find(e.member);
    const manifest = entry ? (await this.deps.members.manifest(entry)).manifest : null;
    if (!manifest)
      throw new ActionError('unavailable', `no manifest for ${e.member}: its variable names are unknown`);
    const values: EnvValues =
      e.kind === 'pat'
        ? { github_token: (e.secret as PatSecret).token }
        : {
            app_id: String((e.meta as AppMeta).id),
            app_private_key: (e.secret as AppSecret).pem,
            app_webhook_secret: (e.secret as AppSecret).webhookSecret,
            ...(installationId ? { app_installation_id: String(installationId) } : {}),
          };
    const block = buildEnvBlock(manifest, values);
    await logDelivery(this.deps.db, {
      member: e.member,
      target: 'env block',
      action: e.kind,
      ok: true,
      message: 'shown once as an .env block',
      detail: e.kind === 'app' ? { app: (e.meta as AppMeta).slug } : { login: (e.meta as PatMeta).login },
    });
    return block;
  }

  private put<T, M extends Record<string, unknown>>(
    input: Parameters<SecretStore['put']>[0] & { secret: T; meta: M },
  ) {
    try {
      return this.deps.store.put<T, M>(input);
    } catch (err) {
      throw new ActionError('conflict', (err as Error).message);
    }
  }

  private view(e: Omit<SecretEntry, 'secret'> & { secret?: unknown }): PendingCredential {
    const base = {
      id: e.id,
      member: e.member,
      kind: e.kind as 'app' | 'pat',
      createdAt: new Date(e.createdAt).toISOString(),
      expiresAt: new Date(e.expiresAt).toISOString(),
    };
    if (e.kind === 'app') {
      const m = e.meta as AppMeta;
      return {
        ...base,
        app: {
          id: m.id,
          slug: m.slug,
          name: m.name,
          htmlUrl: m.htmlUrl,
          installUrl: appInstallUrl(m.htmlUrl),
          owner: m.owner,
        },
      };
    }
    const m = e.meta as PatMeta;
    return { ...base, pat: { login: m.login, tokenType: m.tokenType, scopes: m.scopes, missing: m.missing } };
  }
}
