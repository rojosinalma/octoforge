import type { AccessLevel, AuthMode, Manifest, MemberStatus } from './manifest';
import type { AppUnion, PermissionMatrix } from './shared-app';

// Every route answers {ok, message, ...data}; errors set ok: false, a kind and a reason.
export type ApiOk<T extends object = Record<string, never>> = { ok: true; message: string } & T;
export type ApiErrKind =
  | 'validation'
  | 'auth'
  | 'not_found'
  | 'conflict'
  | 'upstream'
  | 'unavailable'
  | 'system';
export type ApiErr = { ok: false; message: string; kind: ApiErrKind };
export type ApiResult<T extends object = Record<string, never>> = ApiOk<T> | ApiErr;

export interface Health {
  ok: boolean;
  db: 'ok' | 'error';
  version: string;
}

/** A configured base URL of a member. */
export interface Instance {
  id: number;
  member: string;
  /** Where Octoforge calls the member API. */
  baseUrl: string;
  /** Where GitHub and browsers reach the instance, when it differs from `baseUrl`; null = not set. */
  publicUrl: string | null;
  label: string;
  createdAt: string;
}

export interface InstanceHealth {
  instance: Instance;
  up: boolean;
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  /** The GitHub credential the instance reports in its status; null when it was not asked or did not answer. */
  github: InstanceGithub | null;
}

/** Short form of a member's `status.github` for the index card. */
export interface InstanceGithub {
  mode: string | null;
  source: 'env' | 'octoforge' | 'none';
  appId: number | string | null;
  /** Slug of the shared App when `appId` is the shared App's id. */
  appSlug: string | null;
  login: string | null;
  /** Permissions the member reports as missing. */
  missing: string[];
}

export type ManifestSource = 'instance' | 'github' | 'none';

export interface MemberCard {
  name: string;
  title: string;
  description: string;
  /** Absolute icon URL (on an instance that is up), or null. */
  icon: string | null;
  homepage: string | null;
  repoUrl: string | null;
  manifest: Manifest | null;
  manifestSource: ManifestSource;
  manifestError: string | null;
  instances: InstanceHealth[];
}

/** What this Octoforge can do, from its env (never the values). */
export interface Capabilities {
  authRequired: boolean;
  /** OCTOFORGE_TOKEN set: member API calls are possible. */
  memberToken: boolean;
  publicUrl: string | null;
  /** FORGE_PG_ADMIN_URL set. */
  postgres: boolean;
  /** OCTOFORGE_SHARED_DATA, as members see it. */
  sharedData: string | null;
  version: string;
}

export interface InstanceStatus {
  instance: Instance;
  ok: boolean;
  status: MemberStatus | null;
  error: string | null;
}

export type CredentialKind = 'app' | 'pat';

/** A credential waiting in memory; never carries the secret itself. */
export interface PendingCredential {
  id: string;
  member: string;
  kind: CredentialKind;
  createdAt: string;
  expiresAt: string;
  app?: {
    id: number;
    slug: string;
    name: string;
    htmlUrl: string;
    installUrl: string;
    owner: string | null;
  };
  pat?: {
    login: string;
    tokenType: 'classic' | 'fine_grained' | 'other';
    /** Granted classic scopes; null for fine-grained tokens (GitHub does not list them). */
    scopes: string[] | null;
    missing: string[];
  };
}

export interface Installation {
  id: number;
  account: string;
  accountType: string;
  /** What the installation accepted; GitHub lists it with an App JWT. */
  permissions: Record<string, string>;
}

/** Non-secret facts of the shared App, kept in the settings table so the page works after the key expired. */
export interface SharedAppFacts {
  id: number;
  slug: string;
  name: string;
  owner: string | null;
  ownerType: string;
  htmlUrl: string;
  permissions: Record<string, string>;
  events: string[];
  installations: Installation[];
  /** When GitHub was last asked (ISO time). */
  checkedAt: string;
}

export interface SharedAppMember {
  name: string;
  title: string;
  auth: AuthMode[];
  /** The member's `github.app.permissions`. */
  needs: Record<string, AccessLevel>;
  events: string[];
  webhookPath: string | null;
  /** What it needs and the App lacks (Octoforge's own comparison). */
  missing: string[];
}

export interface SharedAppView {
  app:
    | (Omit<SharedAppFacts, 'installations'> & {
        permissionsUrl: string;
        installUrl: string;
        installations: (Installation & { settingsUrl: string })[];
      })
    | null;
  /** The key in memory: when it expires, whether a webhook secret came with it. Never the key. */
  key: { expiresAt: string; hasWebhookSecret: boolean } | null;
  union: AppUnion;
  /** Members that can use a GitHub App. */
  members: SharedAppMember[];
  /** Members that cannot (token only, no GitHub, no manifest), with the reason. */
  others: { name: string; title: string; reason: string }[];
  matrix: PermissionMatrix;
}

export interface DeliveryResult {
  instance: Instance;
  ok: boolean;
  message: string;
  restartRequired: boolean | null;
}

export interface AdoptResult {
  instance: Instance;
  ok: boolean;
  message: string;
  copy: boolean;
  tables: Record<string, number> | null;
  restartRequired: boolean | null;
}

export type LogKind = 'delivery' | 'adoption';

export interface LogEntry {
  id: number;
  kind: LogKind;
  at: string;
  member: string;
  /** Instance base URL, or `env block` for a fallback hand-over. */
  target: string;
  /** delivery: app | pat | env; adoption: postgres | sqlite | release. */
  action: string;
  ok: boolean;
  message: string;
  detail: Record<string, unknown>;
}

export const API = {
  members: '/api/members',
  member: (m: string) => `/api/members/${encodeURIComponent(m)}`,
  status: (m: string) => `/api/members/${encodeURIComponent(m)}/status`,
  appStart: (m: string) => `/api/members/${encodeURIComponent(m)}/app`,
  pat: (m: string) => `/api/members/${encodeURIComponent(m)}/pat`,
  revoke: (m: string, id: number) => `/api/members/${encodeURIComponent(m)}/instances/${id}/github`,
  adopt: (m: string) => `/api/members/${encodeURIComponent(m)}/database`,
  release: (m: string, id: number) => `/api/members/${encodeURIComponent(m)}/instances/${id}/database`,
  instances: '/api/instances',
  instance: (id: number) => `/api/instances/${id}`,
  pending: '/api/pending',
  pendingOne: (id: string) => `/api/pending/${encodeURIComponent(id)}`,
  installations: (id: string) => `/api/pending/${encodeURIComponent(id)}/installations`,
  deliver: (id: string) => `/api/pending/${encodeURIComponent(id)}/deliver`,
  envBlock: (id: string) => `/api/pending/${encodeURIComponent(id)}/env`,
  sharedApp: '/api/shared-app',
  sharedAppKey: '/api/shared-app/key',
  sharedAppRecheck: '/api/shared-app/recheck',
  sharedAppCreate: '/api/shared-app/create',
  sharedAppDeliver: '/api/shared-app/deliver',
  log: '/api/log',
  settings: '/api/settings',
  capabilities: '/api/capabilities',
} as const;
