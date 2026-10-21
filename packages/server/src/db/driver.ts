import type { SQL } from 'drizzle-orm';

export type Dialect = 'sqlite' | 'postgres';
export type Row = Record<string, unknown>;

/**
 * Dialect-neutral database handle. Queries are Drizzle `sql` templates (parameterised), so the same
 * statements run on SQLite and Postgres; row mapping happens in the callers.
 */
export interface Db {
  dialect: Dialect;
  /** Where the database lives, without credentials (for logs and /health). */
  describe: string;
  all<T extends Row = Row>(query: SQL): Promise<T[]>;
  run(query: SQL): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export interface Driver {
  schemes: readonly string[];
  /** Opens the database and applies pending migrations (additive only). */
  open(url: string): Promise<Db>;
}

/** URL without its password, safe for a log line. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@');
  }
}
