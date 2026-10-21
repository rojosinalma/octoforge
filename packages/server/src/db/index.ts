import type { Db, Driver } from './driver';
import { postgresDriver } from './drivers/postgres';
import { sqliteDriver } from './drivers/sqlite';

export type { Db, Row } from './driver';

const drivers: readonly Driver[] = [sqliteDriver, postgresDriver];

/** Opens the database named by `url` (`sqlite:<file>` or `postgres://…`) and migrates it. */
export function openDb(url: string): Promise<Db> {
  const scheme = url.split(':', 1)[0] ?? '';
  const driver = drivers.find((d) => d.schemes.includes(scheme));
  if (!driver) throw new Error(`no database driver for scheme "${scheme}"`);
  return driver.open(url);
}

/** SQLite returns booleans as 0/1, Postgres natively. */
export function bool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 't';
}

export function json(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v !== 'string') return {};
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
