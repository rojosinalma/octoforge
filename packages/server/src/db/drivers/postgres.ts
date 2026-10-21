import { type SQL, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { type Driver, type Row, redactUrl } from '../driver';

const MIGRATIONS = new URL('../migrations/postgres', import.meta.url).pathname;
/** Octoforge's own tables live in this schema; member schemas sit next to it. */
export const FORGE_SCHEMA = 'forge';

export const postgresDriver: Driver = {
  schemes: ['postgres', 'postgresql'],
  async open(url) {
    const parsed = new URL(url);
    const ssl = parsed.searchParams.get('sslmode') === 'require' ? ('require' as const) : undefined;
    const client = postgres(url, {
      ssl,
      max: 5,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => {},
      connection: { search_path: FORGE_SCHEMA },
    });
    await client.unsafe(`CREATE SCHEMA IF NOT EXISTS "${FORGE_SCHEMA}"`);
    const orm = drizzle(client);
    await migrate(orm, { migrationsFolder: MIGRATIONS, migrationsSchema: FORGE_SCHEMA });
    return {
      dialect: 'postgres',
      describe: `${redactUrl(url)} (schema ${FORGE_SCHEMA})`,
      async all<T extends Row>(query: SQL) {
        return Array.from(await orm.execute(query)) as T[];
      },
      async run(query: SQL) {
        await orm.execute(query);
      },
      async ping() {
        try {
          await orm.execute(sql`select 1`);
          return true;
        } catch {
          return false;
        }
      },
      async close() {
        await client.end({ timeout: 5 }).catch(() => {});
      },
    };
  },
};
