import { build } from './boot';
import { ConfigError, loadEnv } from './env';
import { pruneLog } from './lib/journal';
import { MembersFileError } from './lib/members';
import { getSettings } from './lib/settings';
import { configureLog, errMessage, log } from './log';
import { VERSION } from './version';

const boot = log('boot');

let env: ReturnType<typeof loadEnv>;
try {
  env = loadEnv();
} catch (err) {
  // Fail closed: no start without a clear auth decision or with a malformed variable.
  boot.error(`refusing to start: ${errMessage(err)}`);
  process.exit(err instanceof ConfigError ? 78 : 1);
}
configureLog(env.LOG_LEVEL);

let built: Awaited<ReturnType<typeof build>>;
try {
  built = await build(env);
} catch (err) {
  boot.error(`refusing to start: ${errMessage(err)}`);
  process.exit(err instanceof MembersFileError ? 78 : 1);
}
const { app, db, store, siblings } = built;
boot.info('database ready', { db: db.describe });

const server = Bun.serve({ port: env.PORT, hostname: '0.0.0.0', fetch: app.fetch, idleTimeout: 255 });
boot.info('octoforge listening', {
  version: VERSION,
  members: env.membersFile,
  port: env.PORT,
  auth: env.auth,
  memberApi: Boolean(env.OCTOFORGE_TOKEN),
  publicUrl: env.PUBLIC_URL ?? null,
  postgresAdmin: Boolean(env.FORGE_PG_ADMIN_URL),
  sharedData: env.OCTOFORGE_SHARED_DATA ?? null,
});
if (!env.OCTOFORGE_TOKEN)
  boot.warn('OCTOFORGE_TOKEN is not set: only the index works, no delivery or adoption');
if (!env.PUBLIC_URL) boot.warn('PUBLIC_URL is not set: GitHub Apps cannot be created');

/** Hourly housekeeping: expired secrets out of memory, old log rows out of the database. */
async function housekeeping() {
  try {
    const dropped = store.purge();
    const pruned = await pruneLog(db, (await getSettings(db)).logKeepDays);
    if (dropped || pruned) log('db').info('housekeeping', { expiredSecrets: dropped, prunedLogRows: pruned });
  } catch (err) {
    log('db').warn('housekeeping failed', { reason: errMessage(err) });
  }
}
void housekeeping();
const timer = setInterval(() => void housekeeping(), 3_600_000);
// Sibling list: first push shortly after start-up, then every siblingsResendMin.
siblings.start();

process.on('unhandledRejection', (err) => boot.error('unhandled rejection', { reason: errMessage(err) }));
process.on('uncaughtException', (err) => boot.error('uncaught exception', { reason: errMessage(err) }));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  boot.info('shutting down', { signal });
  clearInterval(timer);
  siblings.stop();
  store.clear();
  await server.stop(true);
  await db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
