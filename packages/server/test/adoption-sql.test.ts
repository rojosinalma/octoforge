import { describe, expect, test } from 'bun:test';
import {
  buildAdoptionSql,
  clusterOf,
  generatePassword,
  memberDatabaseUrl,
  quoteIdent,
  quoteLiteral,
  roleAction,
  sqliteMemberUrl,
} from '../src/lib/adoption-sql';

const PW = 'a1'.repeat(16);

describe('buildAdoptionSql', () => {
  test('first adoption: role, schema owned by it, reader role and grants', () => {
    expect(
      buildAdoptionSql({
        member: 'alice-tool',
        role: 'create',
        password: PW,
        readerExists: false,
        database: 'shared',
      }),
    ).toEqual([
      `CREATE ROLE "alice-tool" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${PW}'`,
      'GRANT "alice-tool" TO CURRENT_USER',
      'CREATE SCHEMA IF NOT EXISTS "alice-tool" AUTHORIZATION "alice-tool"',
      'ALTER SCHEMA "alice-tool" OWNER TO "alice-tool"',
      'REVOKE ALL ON SCHEMA "alice-tool" FROM PUBLIC',
      'ALTER ROLE "alice-tool" IN DATABASE "shared" SET search_path = "alice-tool"',
      'CREATE ROLE "octoforge_reader" WITH NOLOGIN',
      'GRANT CONNECT ON DATABASE "shared" TO "alice-tool", "octoforge_reader"',
      'GRANT USAGE ON SCHEMA "alice-tool" TO "octoforge_reader"',
      'GRANT SELECT ON ALL TABLES IN SCHEMA "alice-tool" TO "octoforge_reader"',
      'ALTER DEFAULT PRIVILEGES FOR ROLE "alice-tool" IN SCHEMA "alice-tool" GRANT SELECT ON TABLES TO "octoforge_reader"',
    ]);
  });

  test('a role Octoforge created: the password is rotated, the reader is not created again', () => {
    const stmts = buildAdoptionSql({
      member: 'alice-tool',
      role: 'rotate',
      password: PW,
      readerExists: true,
      database: 'shared',
    });
    expect(stmts[0]).toBe(`ALTER ROLE "alice-tool" WITH LOGIN PASSWORD '${PW}'`);
    expect(stmts.some((s) => s.startsWith('CREATE ROLE'))).toBe(false);
  });

  test('an existing role with its password given: no password change, search_path per database', () => {
    const stmts = buildAdoptionSql({
      member: 'alice-tool',
      role: 'keep',
      readerExists: true,
      database: 'shared',
    });
    expect(stmts.some((s) => /PASSWORD|CREATE ROLE|ALTER ROLE "alice-tool" WITH/.test(s))).toBe(false);
    expect(stmts[0]).toBe('GRANT "alice-tool" TO CURRENT_USER');
    expect(stmts.filter((s) => s.includes('search_path'))).toEqual([
      'ALTER ROLE "alice-tool" IN DATABASE "shared" SET search_path = "alice-tool"',
    ]);
    expect(stmts).toContain('GRANT CONNECT ON DATABASE "shared" TO "alice-tool", "octoforge_reader"');
  });

  test('role action: create, keep with a password, rotate only what Octoforge created, else refuse', () => {
    const at = (roleExists: boolean, createdByOctoforge: boolean, existingPassword: boolean) =>
      roleAction({ roleExists, createdByOctoforge, existingPassword });
    expect(at(false, false, false)).toBe('create');
    expect(at(false, false, true)).toBe('create');
    expect(at(true, false, true)).toBe('keep');
    expect(at(true, true, true)).toBe('keep');
    expect(at(true, true, false)).toBe('rotate');
    expect(at(true, false, false)).toBe('refuse');
  });

  test('cluster key: host and port of the admin URL', () => {
    expect(clusterOf('postgres://a:b@db.example.com/x')).toBe('db.example.com:5432');
    expect(clusterOf('postgres://a:b@db.example.com:6432/x')).toBe('db.example.com:6432');
  });

  test('refuses names that are not members or are reserved, and odd passwords', () => {
    const base = { role: 'create' as const, password: PW, readerExists: false, database: 'shared' };
    for (const member of [
      'Alice',
      'a"; DROP ROLE x; --',
      'forge',
      'public',
      'octoforge_reader',
      'pg_x',
      'postgres',
    ]) {
      expect(() => buildAdoptionSql({ ...base, member })).toThrow();
    }
    expect(() => buildAdoptionSql({ ...base, member: 'alice-tool', password: "x' OR '1" })).toThrow();
    expect(() => buildAdoptionSql({ ...base, member: 'alice-tool', database: '' })).toThrow();
  });

  test('quoting and passwords', () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
    expect(quoteLiteral("it's")).toBe("'it''s'");
    expect(generatePassword()).toMatch(/^[0-9a-f]{64}$/);
    expect(generatePassword()).not.toBe(generatePassword());
  });
});

describe('member URLs', () => {
  test('Postgres: member role, admin database and options, optional member host', () => {
    const admin = 'postgres://admin:secret@db.example.com:5432/octoforge?sslmode=require';
    expect(memberDatabaseUrl(admin, 'alice-tool', PW, '')).toBe(
      `postgres://alice-tool:${PW}@db.example.com:5432/octoforge?sslmode=require`,
    );
    expect(memberDatabaseUrl(admin, 'alice-tool', PW, 'pg.example.com:6432')).toBe(
      `postgres://alice-tool:${PW}@pg.example.com:6432/octoforge?sslmode=require`,
    );
    expect(memberDatabaseUrl(admin, 'alice-tool', PW, 'pg')).toBe(
      `postgres://alice-tool:${PW}@pg/octoforge?sslmode=require`,
    );
  });

  test('SQLite: one file per member in the shared directory', () => {
    expect(sqliteMemberUrl('/shared/', 'alice-tool')).toBe('sqlite:/shared/alice-tool.db');
    expect(() => sqliteMemberUrl('/shared', '../x')).toThrow();
  });
});
