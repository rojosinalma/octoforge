import { randomBytes } from 'node:crypto';
import {
  appCreateUrl,
  appInstallUrl,
  appPermissionsUrl,
  buildSharedAppManifest,
  type DeliveryResult,
  type GitHubAppManifest,
  type Installation,
  installationSettingsUrl,
  looksLikePem,
  missingPermissions,
  normalisePem,
  permissionMatrix,
  type SharedAppFacts,
  type SharedAppMember,
  type SharedAppView,
  unionAppSpecs,
} from '@octoforge/shared';
import type { Db } from '../db';
import { log } from '../log';
import { ActionError, type Credentials, type StateMeta } from './credentials';
import type { GitHubClient } from './github';
import { getInstance, listInstances } from './instances';
import type { MemberRegistry, SharedAppRef } from './members';
import type { SecretStore } from './secrets';
import { deleteFact, readFact, writeFact } from './settings';

/** Settings row with the App's non-secret facts; outside the settings schema, never the key. */
export const SHARED_APP_FACT = 'shared_app';
/** Owner of the secret-store entries of the shared App (it belongs to no single member). */
const OWNER = 'octoforge';

interface SharedSecret {
  pem: string;
  webhookSecret: string;
}
interface SharedMeta extends Record<string, unknown> {
  appId: number;
}

export interface SharedAppDeps {
  db: Db;
  store: SecretStore;
  members: MemberRegistry;
  github: GitHubClient;
  credentials: Credentials;
  publicUrl: string | undefined;
}

/** One GitHub App for every member: register or create it, compare its permissions, deliver it. */
export class SharedApp {
  private readonly logger = log('github');
  constructor(private readonly deps: SharedAppDeps) {}

  facts(): Promise<SharedAppFacts | null> {
    return readFact<SharedAppFacts>(this.deps.db, SHARED_APP_FACT);
  }

  async ref(): Promise<SharedAppRef | null> {
    const f = await this.facts();
    return f ? { id: f.id, slug: f.slug } : null;
  }

  private key() {
    const [entry] = this.deps.store.list({ member: OWNER, kinds: ['shared'] });
    return entry ? this.deps.store.get<SharedSecret, SharedMeta>(entry.id, 'shared') : null;
  }

  private async keep(appId: number, secret: SharedSecret) {
    for (const e of this.deps.store.list({ member: OWNER, kinds: ['shared'] })) this.deps.store.delete(e.id);
    const { ttlMs, max } = await this.deps.credentials.limits();
    try {
      this.deps.store.put<SharedSecret, SharedMeta>({
        kind: 'shared',
        member: OWNER,
        secret,
        meta: { appId },
        ttlMs,
        max,
      });
    } catch (err) {
      throw new ActionError('conflict', (err as Error).message);
    }
  }

  /** Reads GET /app and GET /app/installations with the key and stores the non-secret facts. */
  private async refresh(appId: number, pem: string): Promise<SharedAppFacts> {
    const app = await this.deps.github.app(appId, pem);
    if (!app.ok) throw new ActionError(app.status === 401 ? 'validation' : 'upstream', app.message);
    const inst = await this.deps.github.installations(appId, pem);
    if (!inst.ok) throw new ActionError('upstream', inst.message);
    const { id, slug, name, owner, ownerType, htmlUrl, permissions, events } = app.data;
    const facts: SharedAppFacts = {
      id,
      slug,
      name,
      owner,
      ownerType,
      htmlUrl,
      permissions,
      events,
      installations: inst.data,
      checkedAt: new Date().toISOString(),
    };
    await writeFact(this.deps.db, SHARED_APP_FACT, facts);
    return facts;
  }

  /** "Use an existing App": checks the key against GitHub, keeps it in memory, stores the facts. */
  async register(input: {
    appId: number;
    privateKey: string;
    webhookSecret?: string;
  }): Promise<SharedAppFacts> {
    const pem = normalisePem(input.privateKey);
    if (!looksLikePem(pem)) throw new ActionError('validation', 'this does not look like a PEM private key');
    const facts = await this.refresh(input.appId, pem);
    await this.keep(facts.id, { pem, webhookSecret: input.webhookSecret?.trim() ?? '' });
    this.logger.info('shared App registered', { app: facts.slug, app_id: facts.id });
    return facts;
  }

  /** "Re-check": reads the App again after its permissions changed on GitHub. */
  async recheck(): Promise<SharedAppFacts> {
    const key = this.key();
    if (!key) {
      throw new ActionError(
        'unavailable',
        'the App key is no longer in memory: paste it again under "Use an existing App" to re-check',
      );
    }
    return this.refresh(key.meta.appId, key.secret.pem);
  }

  discardKey(): boolean {
    let n = 0;
    for (const e of this.deps.store.list({ member: OWNER, kinds: ['shared'] }))
      if (this.deps.store.delete(e.id)) n++;
    return n > 0;
  }

  async forget(): Promise<void> {
    this.discardKey();
    await deleteFact(this.deps.db, SHARED_APP_FACT);
  }

  /** "Create the shared App": the manifest is the union of every member's `github.app`. */
  async start(input: {
    name: string;
    org: string | null;
    instanceId: number | null;
  }): Promise<{ action: string; manifest: GitHubAppManifest; state: string }> {
    const { union } = await this.memberSpecs();
    if (union.error) throw new ActionError('validation', union.error);
    const callbackUrl = this.deps.credentials.callbackUrl();
    let hookBaseUrl: string | null = null;
    if (union.webhook) {
      const inst = input.instanceId ? await getInstance(this.deps.db, input.instanceId) : null;
      if (!inst || inst.member !== union.webhook.member)
        throw new ActionError('validation', `pick an instance of ${union.webhook.member} for the webhooks`);
      hookBaseUrl = (await this.deps.credentials.publicUrlOf(inst)).url;
    }
    const state = randomBytes(24).toString('hex');
    let manifest: GitHubAppManifest;
    let action: string;
    try {
      manifest = buildSharedAppManifest({
        union,
        name: input.name,
        homepage: this.deps.publicUrl ?? callbackUrl,
        description: 'One GitHub App for every tool managed by Octoforge.',
        hookBaseUrl,
        callbackUrl,
        setupUrl: `${this.deps.publicUrl}/github-app`,
      });
      action = appCreateUrl(state, input.org);
    } catch (err) {
      throw new ActionError('validation', (err as Error).message);
    }
    const { ttlMs, max } = await this.deps.credentials.limits();
    try {
      this.deps.store.put<null, StateMeta>({
        kind: 'state',
        member: OWNER,
        id: state,
        secret: null,
        meta: { instanceId: input.instanceId, org: input.org, shared: true },
        ttlMs,
        max,
      });
    } catch (err) {
      throw new ActionError('conflict', (err as Error).message);
    }
    return { action, manifest, state };
  }

  /** True when `state` was issued by `start` (the callback then hands the code here). */
  ownsState(state: string): boolean {
    return Boolean(this.deps.store.get<null, StateMeta>(state, 'state')?.meta.shared);
  }

  /** The GitHub redirect: exchanges the code, keeps the key in memory, stores the facts. */
  async finish(code: string, state: string): Promise<SharedAppFacts> {
    const st = this.deps.store.take<null, StateMeta>(state, 'state');
    if (!st?.meta.shared)
      throw new ActionError('validation', 'unknown or expired state: create the App again');
    const conv = await this.deps.github.convertManifest(code);
    if (!conv.ok) throw new ActionError('upstream', conv.message);
    const { pem, webhookSecret, ...app } = conv.data;
    const facts: SharedAppFacts = { ...app, installations: [], checkedAt: new Date().toISOString() };
    await writeFact(this.deps.db, SHARED_APP_FACT, facts);
    await this.keep(app.id, { pem, webhookSecret });
    return facts;
  }

  /** Members that can take an App (with their needs), and the others with the reason. */
  private async memberSpecs() {
    const members: Omit<SharedAppMember, 'missing'>[] = [];
    const others: SharedAppView['others'] = [];
    const specs: Parameters<typeof unionAppSpecs>[0] = [];
    const lookups = await Promise.all(
      this.deps.members
        .list()
        .map(async (entry) => ({ entry, ...(await this.deps.members.manifest(entry)) })),
    );
    for (const { entry, manifest, error } of lookups) {
      const title = manifest?.title ?? entry.name;
      if (!manifest) {
        others.push({ name: entry.name, title, reason: error ? `no manifest: ${error}` : 'no manifest' });
        continue;
      }
      const g = manifest.github;
      if (!g) {
        others.push({ name: entry.name, title, reason: 'needs no GitHub credentials' });
        continue;
      }
      if (!g.auth.includes('app') || !g.app) {
        const why = g.pat?.user_identity ? 'token only: it acts as a person' : 'token only';
        others.push({ name: entry.name, title, reason: why });
        continue;
      }
      specs.push({ name: entry.name, app: g.app });
      members.push({
        name: entry.name,
        title,
        auth: g.auth,
        needs: g.app.permissions,
        events: g.app.events,
        webhookPath: g.app.webhook_path ?? null,
      });
    }
    return { members, others, union: unionAppSpecs(specs) };
  }

  async view(): Promise<SharedAppView> {
    const [{ members, others, union }, facts] = await Promise.all([this.memberSpecs(), this.facts()]);
    const key = this.key();
    const matrix = permissionMatrix({
      app: facts?.permissions ?? null,
      installations: facts?.installations ?? [],
      members: members.map((m) => ({ name: m.name, permissions: m.needs })),
    });
    return {
      app: facts
        ? {
            ...facts,
            permissionsUrl: appPermissionsUrl(facts.slug, facts.owner, facts.ownerType),
            installUrl: appInstallUrl(facts.htmlUrl),
            installations: facts.installations.map((i) => ({
              ...i,
              settingsUrl: installationSettingsUrl(i.id, i.account, i.accountType),
            })),
          }
        : null,
      key:
        key && facts && key.meta.appId === facts.id
          ? {
              expiresAt: new Date(key.expiresAt).toISOString(),
              hasWebhookSecret: Boolean(key.secret.webhookSecret),
            }
          : null,
      union,
      members: members.map((m) => ({
        ...m,
        missing: facts ? missingPermissions(facts.permissions, m.needs) : [],
      })),
      others,
      matrix,
    };
  }

  /** PUT /api/octoforge/github with the shared App on each picked instance; the key goes when all took it. */
  async deliver(input: {
    instanceIds: number[];
    installationId?: number | null;
  }): Promise<{ results: DeliveryResult[]; cleared: boolean }> {
    const key = this.key();
    const facts = await this.facts();
    if (!key || !facts || key.meta.appId !== facts.id) {
      throw new ActionError('not_found', 'the App key is no longer in memory: paste it again to deliver');
    }
    const { members } = await this.memberSpecs();
    const allowed = new Set(members.map((m) => m.name));
    const all = await listInstances(this.deps.db);
    const targets = all.filter((i) => input.instanceIds.includes(i.id));
    if (!targets.length) throw new ActionError('validation', 'pick at least one instance');
    const wrong = targets.filter((i) => !allowed.has(i.member));
    if (wrong.length) {
      const names = [...new Set(wrong.map((i) => i.member))].join(', ');
      throw new ActionError('validation', `${names} cannot use a GitHub App`);
    }
    const installation = input.installationId
      ? facts.installations.find((i: Installation) => i.id === input.installationId)
      : null;
    if (input.installationId && !installation)
      throw new ActionError('validation', 'this installation is not one of the App: re-check first');
    const body = {
      mode: 'app' as const,
      app_id: facts.id,
      private_key: key.secret.pem,
      webhook_secret: key.secret.webhookSecret,
      ...(installation ? { installation_id: installation.id } : {}),
    };
    const results = await Promise.all(
      targets.map((inst) =>
        this.deps.credentials.deliverTo(inst.member, 'app', inst, body, {
          app: facts.slug,
          app_id: facts.id,
          shared: true,
        }),
      ),
    );
    const cleared = results.every((r) => r.ok);
    if (cleared) this.discardKey();
    return { results, cleared };
  }
}
