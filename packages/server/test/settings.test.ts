import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { migrateLegacyTheme } from '../src/lib/settings';
import { testApp } from './helpers';

const store = async (t: Awaited<ReturnType<typeof testApp>>, key: string, value: unknown) =>
  t.db.run(
    sql`insert into settings (key, value, updated_at) values (${key}, ${JSON.stringify(value)}, ${new Date().toISOString()})`,
  );

describe('settings: theme to skin, palette and mode', () => {
  test('maps every old Primer theme onto a mode', () => {
    expect(migrateLegacyTheme({ theme: 'auto' })).toEqual({ mode: 'auto' });
    expect(migrateLegacyTheme({ theme: 'dark' })).toEqual({ mode: 'dark' });
    expect(migrateLegacyTheme({ theme: 'dark_dimmed' })).toEqual({ mode: 'dark' });
    expect(migrateLegacyTheme({ theme: 'dark_high_contrast' })).toEqual({ mode: 'dark' });
    expect(migrateLegacyTheme({ theme: 'light' })).toEqual({ mode: 'light' });
    expect(migrateLegacyTheme({ theme: 'light_colorblind' })).toEqual({ mode: 'light' });
    expect(migrateLegacyTheme({ theme: 'sepia' })).toEqual({});
    expect(migrateLegacyTheme({ theme: 'dark', mode: 'light' })).toEqual({ mode: 'light' });
    expect(migrateLegacyTheme({ secretTtlMin: 5 })).toEqual({ secretTtlMin: 5 });
  });

  test('defaults: skin primer, palette gruvbox, mode auto', async () => {
    const t = await testApp(() => undefined);
    const s = (await t.req('GET', '/api/settings')).body.settings;
    expect(s).toMatchObject({ skin: 'primer', palette: 'gruvbox', mode: 'auto' });
    expect(s.theme).toBeUndefined();
  });

  test('a stored theme row reads as its mode; a stored mode wins after a change', async () => {
    const t = await testApp(() => undefined);
    await store(t, 'theme', 'dark_dimmed');
    expect((await t.req('GET', '/api/settings')).body.settings).toMatchObject({
      skin: 'primer',
      palette: 'gruvbox',
      mode: 'dark',
    });
    const p = await t.req('PUT', '/api/settings', { mode: 'light', skin: 'pico', palette: 'nord' });
    expect(p.status).toBe(200);
    expect(p.body.settings).toMatchObject({ skin: 'pico', palette: 'nord', mode: 'light' });
    expect((await t.req('GET', '/api/settings')).body.settings.mode).toBe('light');
  });

  test('validation: the old key and bad values are refused', async () => {
    const t = await testApp(() => undefined);
    expect((await t.req('PUT', '/api/settings', { theme: 'dark' })).status).toBe(400);
    expect((await t.req('PUT', '/api/settings', { mode: 'dim' })).status).toBe(400);
    expect((await t.req('PUT', '/api/settings', { skin: 'Not An Id' })).status).toBe(400);
  });
});
