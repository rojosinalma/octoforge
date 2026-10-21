import type { GitHubAppManifest } from './github';
import { APP_NAME_MAX } from './github';
import type { AccessLevel, AppSpec } from './manifest';

/** One GitHub App for every member: builders for its manifest, its gaps and GitHub's settings pages. */

const RANK: Record<string, number> = { read: 1, write: 2, admin: 3 };
const ORG_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** Rank of a GitHub permission level; unknown or absent = 0. */
export function levelRank(level: string | null | undefined): number {
  return level ? (RANK[level] ?? 0) : 0;
}

/** The higher of two levels (write > read). */
export function higherLevel<T extends string>(a: T | null | undefined, b: T): T {
  return levelRank(a) >= levelRank(b) ? (a as T) : b;
}

export interface MemberAppSpec {
  name: string;
  app: AppSpec;
}

export interface AppUnion {
  /** Every permission any member asks for, at the highest level asked. */
  permissions: Record<string, AccessLevel>;
  /** Every event any member asks for, sorted. */
  events: string[];
  /** The member that receives the App's webhooks, when exactly one names a `webhook_path`. */
  webhook: { member: string; path: string } | null;
  /** Why no App manifest can be built from this union; null when it can. */
  error: string | null;
}

/** Union of the members' `github.app`: highest level per permission, all events, one webhook URL. */
export function unionAppSpecs(members: MemberAppSpec[]): AppUnion {
  const permissions: Record<string, AccessLevel> = {};
  const events = new Set<string>();
  for (const m of members) {
    for (const [perm, level] of Object.entries(m.app.permissions))
      permissions[perm] = higherLevel(permissions[perm], level);
    for (const ev of m.app.events) events.add(ev);
  }
  const hooks = members.filter((m) => m.app.webhook_path);
  const sorted = Object.fromEntries(Object.entries(permissions).sort(([a], [b]) => a.localeCompare(b)));
  let error: string | null = null;
  let webhook: AppUnion['webhook'] = null;
  if (hooks.length > 1) {
    error = `one App has one webhook URL, but ${hooks.map((m) => m.name).join(', ')} each name a webhook_path`;
  } else if (hooks[0]?.app.webhook_path) {
    webhook = { member: hooks[0].name, path: hooks[0].app.webhook_path };
  } else if (events.size) {
    const asking = members.filter((m) => m.app.events.length).map((m) => m.name);
    error = `${asking.join(', ')} ask for events, but no member names a webhook_path`;
  }
  return { permissions: sorted as Record<string, AccessLevel>, events: [...events].sort(), webhook, error };
}

export interface SharedManifestInput {
  union: AppUnion;
  /** App name shown on GitHub; must be unique across GitHub. */
  name: string;
  /** Homepage of the App (Octoforge's public address). */
  homepage: string;
  description?: string;
  /** Public address of the webhook member's instance; needed when the union has a webhook. */
  hookBaseUrl?: string | null;
  /** Octoforge's own callback that exchanges the code. */
  callbackUrl: string;
  /** Where GitHub sends the browser after an installation (Octoforge's GitHub App page). */
  setupUrl?: string;
}

/** The manifest of the shared App: the union's permissions and events, the one webhook URL. */
export function buildSharedAppManifest(input: SharedManifestInput): GitHubAppManifest {
  const { union } = input;
  if (union.error) throw new Error(union.error);
  const name = input.name.trim();
  if (!name) throw new Error('the App needs a name');
  if (name.length > APP_NAME_MAX) throw new Error(`App names are at most ${APP_NAME_MAX} characters`);
  const out: GitHubAppManifest = {
    name,
    url: input.homepage,
    public: false,
    default_permissions: { ...union.permissions },
    default_events: [],
    redirect_url: input.callbackUrl,
    setup_on_update: false,
    request_oauth_on_install: false,
  };
  if (input.description) out.description = input.description;
  if (union.webhook) {
    if (!input.hookBaseUrl) throw new Error(`pick an instance of ${union.webhook.member} for the webhooks`);
    out.hook_attributes = {
      url: `${input.hookBaseUrl.replace(/\/+$/, '')}${union.webhook.path}`,
      active: true,
    };
    out.default_events = [...union.events];
  }
  if (input.setupUrl) out.setup_url = input.setupUrl;
  return out;
}

/**
 * GitHub's organization permissions. An installation on a personal account never receives them, so
 * they are not a gap there (`members` is the common case).
 */
export const ORGANIZATION_PERMISSIONS: ReadonlySet<string> = new Set([
  'members',
  'organization_administration',
  'organization_custom_roles',
  'organization_custom_org_roles',
  'organization_custom_properties',
  'organization_copilot_seat_management',
  'organization_announcement_banners',
  'organization_events',
  'organization_hooks',
  'organization_personal_access_tokens',
  'organization_personal_access_token_requests',
  'organization_plan',
  'organization_projects',
  'organization_packages',
  'organization_secrets',
  'organization_self_hosted_runners',
  'organization_user_blocking',
  'team_discussions',
]);

/** What an installation can receive: a personal account drops the organization permissions. */
export function applicableToAccount(
  needed: Record<string, string>,
  accountType: AccountType | undefined,
): Record<string, string> {
  if (accountType === 'Organization' || accountType === undefined) return needed;
  return Object.fromEntries(Object.entries(needed).filter(([p]) => !ORGANIZATION_PERMISSIONS.has(p)));
}

/** Needed permissions the granted set does not cover, as `"<permission>:<level>"`, sorted. */
export function missingPermissions(
  granted: Record<string, string> | null | undefined,
  needed: Record<string, string>,
): string[] {
  return Object.entries(needed)
    .filter(([perm, level]) => levelRank(granted?.[perm]) < levelRank(level))
    .map(([perm, level]) => `${perm}:${level}`)
    .sort();
}

export interface MatrixInput {
  /** What the App grants; null when Octoforge does not know the App yet. */
  app: Record<string, string> | null;
  /** What each installation accepted. */
  installations: {
    id: number;
    account: string;
    accountType?: AccountType;
    permissions: Record<string, string>;
  }[];
  /** What each member needs. */
  members: { name: string; permissions: Record<string, string> }[];
}

export interface MatrixCell {
  level: string | null;
  /** Lower than what this row needs. */
  gap: boolean;
}

export interface MatrixRow {
  permission: string;
  /** Highest level any member needs; null when no member needs it (the App grants it anyway). */
  needed: string | null;
  app: MatrixCell;
  installations: MatrixCell[];
  members: MatrixCell[];
}

export interface PermissionMatrix {
  rows: MatrixRow[];
  /** What the App must add, as `"<permission>:<level>"`. */
  appMissing: string[];
  /** Per installation id: what it has not accepted yet. */
  installationMissing: Record<number, string[]>;
  /** Per member: what it needs and the App lacks. */
  memberMissing: Record<string, string[]>;
}

/**
 * Rows: every permission a member needs or the App grants. Columns: the App (granted), each
 * installation (accepted), each member (needs). A cell is a gap when it is below what is needed.
 */
export function permissionMatrix(input: MatrixInput): PermissionMatrix {
  const needed: Record<string, string> = {};
  for (const m of input.members)
    for (const [p, l] of Object.entries(m.permissions)) needed[p] = higherLevel(needed[p], l);
  const names = new Set([...Object.keys(needed), ...Object.keys(input.app ?? {})]);
  const rows = [...names].sort().map((permission): MatrixRow => {
    const need = needed[permission] ?? null;
    const appLevel = input.app?.[permission] ?? null;
    return {
      permission,
      needed: need,
      app: { level: appLevel, gap: input.app !== null && levelRank(appLevel) < levelRank(need) },
      installations: input.installations.map((i) => {
        const level = i.permissions[permission] ?? null;
        const applies = permission in applicableToAccount({ [permission]: need ?? 'read' }, i.accountType);
        return { level, gap: applies && levelRank(level) < levelRank(need) };
      }),
      members: input.members.map((m) => {
        const level = m.permissions[permission] ?? null;
        return { level, gap: input.app !== null && levelRank(appLevel) < levelRank(level) };
      }),
    };
  });
  return {
    rows,
    appMissing: input.app ? missingPermissions(input.app, needed) : [],
    installationMissing: Object.fromEntries(
      input.installations.map((i) => [
        i.id,
        missingPermissions(i.permissions, applicableToAccount(needed, i.accountType)),
      ]),
    ),
    memberMissing: Object.fromEntries(
      input.members.map((m) => [m.name, input.app ? missingPermissions(input.app, m.permissions) : []]),
    ),
  };
}

export type AccountType = 'User' | 'Organization' | string;

/** GitHub's page where the owner edits the App's permissions. */
export function appPermissionsUrl(slug: string, owner: string | null, ownerType: AccountType): string {
  if (!SLUG_RE.test(slug)) throw new Error(`"${slug}" is not a valid App slug`);
  if (ownerType === 'Organization' && owner) {
    if (!ORG_RE.test(owner)) throw new Error(`"${owner}" is not a valid organisation name`);
    return `https://github.com/organizations/${owner}/settings/apps/${slug}/permissions`;
  }
  return `https://github.com/settings/apps/${slug}/permissions`;
}

/** GitHub's page of one installation, where its account accepts new permissions. */
export function installationSettingsUrl(id: number, account: string, accountType: AccountType): string {
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${id} is not an installation id`);
  if (accountType === 'Organization') {
    if (!ORG_RE.test(account)) throw new Error(`"${account}" is not a valid organisation name`);
    return `https://github.com/organizations/${account}/settings/installations/${id}`;
  }
  return `https://github.com/settings/installations/${id}`;
}

/** A pasted PEM: literal `\n` sequences become line breaks, surrounding blanks go. */
export function normalisePem(input: string): string {
  return input
    .replace(/\\r\\n|\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
}

/** Looks like a PEM private key (PKCS#1 or PKCS#8). */
export function looksLikePem(pem: string): boolean {
  return /^-----BEGIN (RSA )?PRIVATE KEY-----\n[\s\S]+\n-----END (RSA )?PRIVATE KEY-----$/.test(pem);
}
