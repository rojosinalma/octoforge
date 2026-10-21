import type { AppSpec, Manifest, PatSpec } from './manifest';

/** GitHub limits: App names are at most 34 characters, fine-grained token names 40. */
export const APP_NAME_MAX = 34;
export const PAT_NAME_MAX = 40;
const ORG_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

const trimSlash = (url: string) => url.replace(/\/+$/, '');

export interface AppManifestInput {
  manifest: Pick<Manifest, 'name' | 'title' | 'description'> & { github?: { app?: AppSpec } };
  /** App name shown on GitHub; must be unique across GitHub. */
  name: string;
  /** Homepage of the App (the member's repository). */
  homepage: string;
  /** Base URL of the instance that receives the webhooks (and the setup redirect). */
  instanceUrl: string;
  /** Octoforge's own callback that exchanges the code. */
  callbackUrl: string;
}

/** GitHub App manifest (https://docs.github.com/apps/sharing-github-apps/registering-a-github-app-from-a-manifest). */
export interface GitHubAppManifest {
  name: string;
  url: string;
  description?: string;
  public: false;
  default_permissions: Record<string, string>;
  default_events: string[];
  hook_attributes?: { url: string; active: boolean };
  redirect_url: string;
  setup_url?: string;
  setup_on_update: boolean;
  request_oauth_on_install: boolean;
}

/** Builds the manifest GitHub receives: the member's `github.app` plus name, URLs and owner-chosen name. */
export function buildAppManifest(input: AppManifestInput): GitHubAppManifest {
  const app = input.manifest.github?.app;
  if (!app) throw new Error(`${input.manifest.name} does not support a GitHub App`);
  const name = input.name.trim();
  if (!name) throw new Error('the App needs a name');
  if (name.length > APP_NAME_MAX) throw new Error(`App names are at most ${APP_NAME_MAX} characters`);
  const base = trimSlash(input.instanceUrl);
  const out: GitHubAppManifest = {
    name,
    url: input.homepage,
    public: false,
    default_permissions: { ...app.permissions },
    default_events: [],
    redirect_url: input.callbackUrl,
    setup_on_update: false,
    request_oauth_on_install: false,
  };
  if (input.manifest.description) out.description = input.manifest.description;
  if (app.webhook_path) {
    out.hook_attributes = { url: `${base}${app.webhook_path}`, active: true };
    out.default_events = [...app.events];
  } else if (app.events.length) {
    throw new Error(`${input.manifest.name} asks for events but names no webhook_path`);
  }
  if (app.setup_path) out.setup_url = `${base}${app.setup_path}`;
  return out;
}

/** Where the manifest form posts: the personal account, or an organisation's settings. */
export function appCreateUrl(state: string, org?: string | null): string {
  const q = `?state=${encodeURIComponent(state)}`;
  if (!org) return `https://github.com/settings/apps/new${q}`;
  if (!ORG_RE.test(org)) throw new Error(`"${org}" is not a valid organisation name`);
  return `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new${q}`;
}

/** Page where the owner installs a freshly created App. */
export function appInstallUrl(htmlUrl: string): string {
  return `${trimSlash(htmlUrl)}/installations/new`;
}

/** GitHub's pre-filled form for a classic token. */
export function classicTokenUrl(pat: Pick<PatSpec, 'classic_scopes'>, description: string): string {
  const scopes = pat.classic_scopes.map(encodeURIComponent).join(',');
  return `https://github.com/settings/tokens/new?scopes=${scopes}&description=${encodeURIComponent(description)}`;
}

export interface FineGrainedInput {
  pat: Pick<PatSpec, 'fine_grained'>;
  name: string;
  description: string;
  /** Days until expiry (1-366); 0 or null = no expiry. */
  expiresInDays: number | null;
  /** Resource owner (organisation); empty = the signed-in user. */
  targetName?: string | null;
}

/** GitHub's pre-filled form for a fine-grained token (name, description, expiry and one param per permission). */
export function fineGrainedTokenUrl(input: FineGrainedInput): string {
  const q = new URLSearchParams();
  q.set('name', input.name.slice(0, PAT_NAME_MAX));
  q.set('description', input.description.slice(0, 1024));
  if (input.targetName) {
    if (!ORG_RE.test(input.targetName)) throw new Error(`"${input.targetName}" is not a valid owner name`);
    q.set('target_name', input.targetName);
  }
  const days = input.expiresInDays;
  q.set('expires_in', days && days > 0 ? String(Math.min(366, Math.floor(days))) : 'none');
  for (const [perm, level] of Object.entries(input.pat.fine_grained)) q.set(perm, level);
  return `https://github.com/settings/personal-access-tokens/new?${q.toString()}`;
}

export type TokenType = 'classic' | 'fine_grained' | 'other';

export function tokenType(token: string): TokenType {
  if (token.startsWith('github_pat_')) return 'fine_grained';
  if (token.startsWith('ghp_')) return 'classic';
  return 'other';
}

/** Classic scopes that include others (GitHub's scope hierarchy). */
const IMPLIED: Record<string, string[]> = {
  repo: ['repo:status', 'repo_deployment', 'public_repo', 'repo:invite', 'security_events'],
  'admin:org': ['write:org', 'read:org', 'manage_runners:org'],
  'write:org': ['read:org'],
  'admin:public_key': ['write:public_key', 'read:public_key'],
  'write:public_key': ['read:public_key'],
  'admin:repo_hook': ['write:repo_hook', 'read:repo_hook'],
  'write:repo_hook': ['read:repo_hook'],
  user: ['read:user', 'user:email', 'user:follow'],
  'write:packages': ['read:packages'],
  'admin:gpg_key': ['write:gpg_key', 'read:gpg_key'],
  'write:gpg_key': ['read:gpg_key'],
  'admin:ssh_signing_key': ['write:ssh_signing_key', 'read:ssh_signing_key'],
  'write:ssh_signing_key': ['read:ssh_signing_key'],
  project: ['read:project'],
  'write:discussion': ['read:discussion'],
  'admin:enterprise': ['manage_runners:enterprise', 'manage_billing:enterprise', 'read:enterprise'],
  'manage_billing:enterprise': ['read:enterprise'],
};

/** Parses GitHub's `X-OAuth-Scopes` header (`repo, workflow`). */
export function parseScopes(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Required classic scopes the granted set does not cover, after expanding implied scopes. */
export function missingScopes(required: string[], granted: string[]): string[] {
  const have = new Set<string>();
  const add = (s: string) => {
    if (have.has(s)) return;
    have.add(s);
    for (const sub of IMPLIED[s] ?? []) add(sub);
  };
  for (const s of granted) add(s);
  return required.filter((s) => !have.has(s));
}
