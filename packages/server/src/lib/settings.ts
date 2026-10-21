import { Settings, SettingsPatch } from '@octoforge/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../db';

/**
 * Settings written before 0.2 kept one `theme` row (a Primer theme such as `dark_dimmed`). It maps onto the
 * mode (dark* = dark, light* = light, auto = auto); skin and palette keep their defaults. The old row stays
 * in place and an explicitly stored `mode` wins.
 */
export function migrateLegacyTheme(raw: Record<string, unknown>): Record<string, unknown> {
  const { theme, ...rest } = raw;
  if (typeof theme !== 'string' || 'mode' in rest) return rest;
  const mode =
    theme === 'auto'
      ? 'auto'
      : theme.startsWith('dark')
        ? 'dark'
        : theme.startsWith('light')
          ? 'light'
          : null;
  return mode ? { ...rest, mode } : rest;
}

/** Stored rows merged over the schema defaults. Read at use time, never cached. */
export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.all<{ key: string; value: string }>(sql`select key, value from settings`);
  const raw: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      raw[row.key] = JSON.parse(row.value);
    } catch {
      // Unparseable value: that key falls back to its default.
    }
  }
  const input = migrateLegacyTheme(raw);
  const parsed = Settings.safeParse(input);
  if (parsed.success) return parsed.data;
  // One bad value must not take every setting down: drop the offending keys and parse again.
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string') delete input[key];
  }
  return Settings.parse(input);
}

/** Setting.fetch-style read of one key. */
export async function setting<K extends keyof Settings>(db: Db, key: K): Promise<Settings[K]> {
  return (await getSettings(db))[key];
}

/** Validates with `SettingsPatch` (throws ZodError on bad input) and upserts each key. */
export async function patchSettings(db: Db, patch: unknown): Promise<Settings> {
  const valid = SettingsPatch.parse(patch);
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(valid)) {
    if (value === undefined) continue;
    await db.run(
      sql`insert into settings (key, value, updated_at) values (${key}, ${JSON.stringify(value)}, ${now})
          on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    );
  }
  return getSettings(db);
}

/**
 * A row of the settings table outside the settings schema (not editable through PUT /api/settings),
 * for non-secret facts Octoforge learned, such as the shared GitHub App. Unparseable = null.
 */
export async function readFact<T>(db: Db, key: string): Promise<T | null> {
  const [row] = await db.all<{ value: string }>(sql`select value from settings where key = ${key}`);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function writeFact(db: Db, key: string, value: unknown): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    sql`insert into settings (key, value, updated_at) values (${key}, ${JSON.stringify(value)}, ${now})
        on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
  );
}

export async function deleteFact(db: Db, key: string): Promise<void> {
  await db.run(sql`delete from settings where key = ${key}`);
}
