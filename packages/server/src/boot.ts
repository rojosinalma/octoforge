import { type AppDeps, createApp } from './app';
import { type Db, openDb } from './db';
import type { Env } from './env';
import { loadSessionSecret } from './lib/auth';
import { Credentials } from './lib/credentials';
import { Database, type DatabaseDeps } from './lib/database';
import { GitHubClient } from './lib/github';
import type { FetchLike } from './lib/http';
import { listInstances } from './lib/instances';
import { MemberRegistry, readSubmodules } from './lib/members';
import { SecretStore } from './lib/secrets';
import { getSettings } from './lib/settings';

export interface Built {
  deps: AppDeps;
  app: ReturnType<typeof createApp>;
  store: SecretStore;
  db: Db;
}

/** Wires every part from the environment; tests pass a fake fetch and a fake provisioner. */
export async function build(
  env: Env,
  opts: { fetchImpl?: FetchLike; provision?: DatabaseDeps['provision']; db?: Db } = {},
): Promise<Built> {
  const db = opts.db ?? (await openDb(env.DATABASE_URL));
  const store = new SecretStore();
  const timeoutMs = async () => (await getSettings(db)).requestTimeoutMs;
  const members = new MemberRegistry({
    submodules: () => readSubmodules(env.gitmodulesFile),
    instances: (m) => listInstances(db, m),
    timeoutMs,
    cacheMs: async () => (await getSettings(db)).manifestCacheMin * 60_000,
    token: env.OCTOFORGE_TOKEN,
    fetchImpl: opts.fetchImpl,
  });
  const github = new GitHubClient(timeoutMs, opts.fetchImpl);
  const credentials = new Credentials({ db, store, members, github, publicUrl: env.PUBLIC_URL });
  const database = new Database({
    db,
    store,
    members,
    credentials,
    pgAdminUrl: env.FORGE_PG_ADMIN_URL,
    sharedData: env.OCTOFORGE_SHARED_DATA,
    provision: opts.provision,
  });
  const sessionSecret = loadSessionSecret(env.SESSION_SECRET, env.DATA_DIR);
  const deps: AppDeps = { env, db, members, credentials, database, sessionSecret };
  return { deps, app: createApp(deps), store, db };
}
