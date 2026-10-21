import type { Manifest, MemberStatus } from './manifest';

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
  baseUrl: string;
  label: string;
  createdAt: string;
}

export interface InstanceHealth {
  instance: Instance;
  up: boolean;
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
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
  log: '/api/log',
  settings: '/api/settings',
  capabilities: '/api/capabilities',
} as const;
