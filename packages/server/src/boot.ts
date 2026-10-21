import { type AppDeps, createApp } from './app';
import { type Db, openDb } from './db';
import type { Env } from './env';
import { loadSessionSecret } from './lib/auth';
import { Credentials } from './lib/credentials';
import { Database, type DatabaseDeps } from './lib/database';
import { GitHubClient } from './lib/github';
import type { FetchLike } from './lib/http';
import { listInstances } from './lib/instances';
import { MemberRegistry, membersFromFile } from './lib/members';
import { SecretStore } from './lib/secrets';
import { getSettings } from './lib/settings';
import { SharedApp } from './lib/shared-app';
import { Siblings, type SiblingsDeps } from './lib/siblings';

export interface Built {
  deps: AppDeps;
  app: ReturnType<typeof createApp>;
  store: SecretStore;
  db: Db;
  siblings: Siblings;
}

/** Wires every part from the environment; tests pass a fake fetch and a fake provisioner. */
export async function build(
  env: Env,
  opts: {
    fetchImpl?: FetchLike;
    provision?: DatabaseDeps['provision'];
    db?: Db;
    siblings?: Pick<SiblingsDeps, 'startDelayMs' | 'concurrency'>;
  } = {},
): Promise<Built> {
  // A bad member list stops the start-up before anything opens.
  const memberList = membersFromFile(env.membersFile);
  const db = opts.db ?? (await openDb(env.DATABASE_URL));
  const store = new SecretStore();
  const timeoutMs = async () => (await getSettings(db)).requestTimeoutMs;
  const members = new MemberRegistry({
    members: memberList,
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
  const sharedApp = new SharedApp({ db, store, members, github, credentials, publicUrl: env.PUBLIC_URL });
  const siblings = new Siblings({
    members,
    instances: () => listInstances(db),
    resendMin: async () => (await getSettings(db)).siblingsResendMin,
    token: env.OCTOFORGE_TOKEN,
    publicUrl: env.PUBLIC_URL,
    ...opts.siblings,
  });
  const sessionSecret = loadSessionSecret(env.SESSION_SECRET, env.DATA_DIR);
  const deps: AppDeps = { env, db, members, credentials, database, sharedApp, siblings, sessionSecret };
  return { deps, app: createApp(deps), store, db, siblings };
}
