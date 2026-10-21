import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { type SQL, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import type { Driver, Row } from '../driver';

const MIGRATIONS = new URL('../migrations/sqlite', import.meta.url).pathname;

/** `sqlite:./data/x.db` → `./data/x.db`; `sqlite::memory:` → `:memory:`. */
export function sqlitePath(url: string): string {
  return url.replace(/^sqlite:(\/\/)?/, '');
}

export const sqliteDriver: Driver = {
  schemes: ['sqlite'],
  async open(url) {
    const file = sqlitePath(url);
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    const client = new Database(file, { create: true });
    client.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const orm = drizzle(client);
    migrate(orm, { migrationsFolder: MIGRATIONS });
    return {
      dialect: 'sqlite',
      describe: `sqlite:${file}`,
      async all<T extends Row>(query: SQL) {
        return orm.all<T>(query);
      },
      async run(query: SQL) {
        orm.run(query);
      },
      async ping() {
        try {
          orm.all(sql`select 1`);
          return true;
        } catch {
          return false;
        }
      },
      async close() {
        client.close();
      },
    };
  },
};
