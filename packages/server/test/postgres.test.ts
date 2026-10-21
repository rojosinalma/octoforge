import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionPostgres } from '../src/lib/database';
import { listLog } from '../src/lib/journal';
import { json, MANIFEST, testApp } from './helpers';

// Runs against a real, throwaway Postgres only when OCTOFORGE_TEST_PG_URL names a superuser URL, e.g.
//   docker run --rm -d --name pg-test -e POSTGRES_PASSWORD=su -p 55432:5432 postgres:17-alpine
//   OCTOFORGE_TEST_PG_URL=postgres://postgres:su@127.0.0.1:55432/postgres bun test test/postgres.test.ts
// It creates roles and databases: never point it at a database that matters.
const SUPER = process.env.OCTOFORGE_TEST_PG_URL;

const OLD = 'old p@ss/w:rd%';
const ADMIN_PW = 'admin-pw';

function at(base: string, user: string, password: string, database: string): string {
  const u = new URL(base);
  u.username = encodeURIComponent(user);
  u.password = encodeURIComponent(password);
  u.pathname = `/${database}`;
  return u.toString();
}

async function query<T = Record<string, unknown>>(url: string, text: string): Promise<T[]> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return (await sql.unsafe(text)) as unknown as T[];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

describe.skipIf(!SUPER)('real Postgres 17: adoption of existing and created roles', () => {
  const su = SUPER as string;
  const admin = () => at(su, 'forge_admin', ADMIN_PW, 'octoforge');
  const generated = 'a1'.repeat(32);

  beforeAll(async () => {
    const sql = postgres(su, { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe('DROP DATABASE IF EXISTS octoforge');
      await sql.unsafe('DROP DATABASE IF EXISTS "carol-tool"');
      for (const r of ['alice-tool', 'bob-tool', 'carol-tool', 'octoforge_reader', 'forge_admin']) {
        await sql.unsafe(`DROP OWNED BY "${r}"`).catch(() => {});
        await sql.unsafe(`DROP ROLE IF EXISTS "${r}"`);
      }
      // The member's own standalone database, with its own role and password.
      await sql.unsafe(`CREATE ROLE "carol-tool" LOGIN PASSWORD '${OLD.replace(/'/g, "''")}'`);
      await sql.unsafe('CREATE DATABASE "carol-tool" OWNER "carol-tool"');
      await sql.unsafe('ALTER ROLE "carol-tool" IN DATABASE "carol-tool" SET search_path = app, public');
      // The admin: CREATEROLE only, ADMIN OPTION on the member role, owner of the shared database.
      await sql.unsafe(`CREATE ROLE forge_admin LOGIN CREATEROLE PASSWORD '${ADMIN_PW}'`);
      await sql.unsafe('GRANT "carol-tool" TO forge_admin WITH ADMIN OPTION');
      await sql.unsafe('CREATE DATABASE octoforge OWNER forge_admin');
      await sql.unsafe('REVOKE ALL ON DATABASE octoforge FROM PUBLIC');
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  afterAll(async () => {
    const sql = postgres(su, { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe('DROP DATABASE IF EXISTS octoforge WITH (FORCE)');
      await sql.unsafe('DROP DATABASE IF EXISTS "carol-tool" WITH (FORCE)');
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test('an existing role without its password is refused', async () => {
    const input = { member: 'carol-tool', generated, createdOid: null };
    await expect(provisionPostgres(admin(), input)).rejects.toThrow(
      'role carol-tool already exists and was not created by Octoforge: pass its current password',
    );
  });

  test('a wrong password is refused before any DDL', async () => {
    const input = { member: 'carol-tool', generated, existing: 'wrong', createdOid: null };
    await expect(provisionPostgres(admin(), input)).rejects.toThrow(
      'the password does not log in as carol-tool',
    );
    const schemas = await query(
      su.replace(/\/[^/]*$/, '/octoforge'),
      "select 1 from pg_namespace where nspname = 'carol-tool'",
    );
    expect(schemas).toHaveLength(0);
  });

  test('the admin needs ADMIN OPTION on an existing role: refused with the fix', async () => {
    await query(su, 'CREATE ROLE "bob-tool" LOGIN PASSWORD \'bob-pw\'');
    const input = { member: 'bob-tool', generated, existing: 'bob-pw', createdOid: null };
    await expect(provisionPostgres(admin(), input)).rejects.toThrow(
      'the admin role has no ADMIN OPTION on bob-tool: run GRANT "bob-tool" TO "forge_admin" WITH ADMIN OPTION',
    );
  });

  test('the right password: schema created, password kept in both databases, own search_path intact', async () => {
    const done = await provisionPostgres(admin(), {
      member: 'carol-tool',
      generated,
      existing: OLD,
      createdOid: null,
    });
    expect(done).toMatchObject({ action: 'keep', password: OLD });

    const [owner] = await query<{ owner: string }>(
      at(su, 'carol-tool', OLD, 'octoforge'),
      "select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = 'carol-tool'",
    );
    expect(owner?.owner).toBe('carol-tool');
    const [shared] = await query<{ search_path: string }>(
      at(su, 'carol-tool', OLD, 'octoforge'),
      'show search_path',
    );
    expect(shared?.search_path).toBe('"carol-tool"');
    // Its own database: still logs in with the same password, its own search_path untouched.
    const [own] = await query<{ search_path: string }>(
      at(su, 'carol-tool', OLD, 'carol-tool'),
      'show search_path',
    );
    expect(own?.search_path).toBe('app, public');
    const settings = await query<{ db: string | null }>(
      su,
      `select d.datname as db from pg_db_role_setting s left join pg_database d on d.oid = s.setdatabase
       where s.setrole = '"carol-tool"'::regrole`,
    );
    expect(settings.map((s) => s.db).sort()).toEqual(['carol-tool', 'octoforge']);
    // No role-wide setting: a database without its own keeps the server default.
    const [plain] = await query<{ search_path: string }>(
      at(su, 'carol-tool', OLD, 'postgres'),
      'show search_path',
    );
    expect(plain?.search_path).toBe('"$user", public');
  });

  test('a role Octoforge created gets a new password on re-adoption, the old one stops working', async () => {
    const t = await testApp(
      (c) => {
        if (c.url.endsWith('/api/octoforge/manifest')) return json(MANIFEST);
        if (c.url.endsWith('/api/octoforge/database/adopt'))
          return json({ ok: true, message: 'adopted', tables: {}, restart_required: true });
        return undefined;
      },
      { FORGE_PG_ADMIN_URL: admin() },
    );
    await t.req('POST', '/api/instances', { member: 'alice-tool', baseUrl: 'https://a.example.com' });
    const urls = () =>
      t.calls.filter((c) => c.url.endsWith('/database/adopt')).map((c) => (c.body as { url: string }).url);

    const first = await t.req('POST', '/api/members/alice-tool/database', { engine: 'postgres' });
    expect(first.status).toBe(200);
    const [url1] = urls();
    expect(await query(url1 as string, 'select 1 as x')).toEqual([{ x: 1 }]);

    const second = await t.req('POST', '/api/members/alice-tool/database', { engine: 'postgres' });
    expect(second.status).toBe(200);
    const url2 = urls()[1] as string;
    expect(url2).not.toBe(url1);
    expect(await query(url2, 'select 1 as x')).toEqual([{ x: 1 }]);
    await expect(query(url1 as string, 'select 1')).rejects.toThrow();

    const roles = (await listLog(t.db, { kind: 'adoption', limit: 10 })).map((e) => e.detail.role);
    expect(roles).toEqual(['new password', 'created']);
    await t.db.close();
  });
});
