import { Settings, SettingsPatch } from '@octoforge/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../db';

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
  const parsed = Settings.safeParse(raw);
  if (parsed.success) return parsed.data;
  // One bad value must not take every setting down: drop the offending keys and parse again.
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string') delete raw[key];
  }
  return Settings.parse(raw);
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
