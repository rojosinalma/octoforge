import { describe, expect, test } from 'bun:test';
import {
  buildAdoptionSql,
  generatePassword,
  memberDatabaseUrl,
  quoteIdent,
  quoteLiteral,
  sqliteMemberUrl,
} from '../src/lib/adoption-sql';

const PW = 'a1'.repeat(16);

describe('buildAdoptionSql', () => {
  test('first adoption: role, schema owned by it, reader role and grants', () => {
    expect(
      buildAdoptionSql({ member: 'alice-tool', password: PW, roleExists: false, readerExists: false }),
    ).toEqual([
      `CREATE ROLE "alice-tool" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${PW}'`,
      'GRANT "alice-tool" TO CURRENT_USER',
      'CREATE SCHEMA IF NOT EXISTS "alice-tool" AUTHORIZATION "alice-tool"',
      'ALTER SCHEMA "alice-tool" OWNER TO "alice-tool"',
      'REVOKE ALL ON SCHEMA "alice-tool" FROM PUBLIC',
      'ALTER ROLE "alice-tool" SET search_path = "alice-tool"',
      'CREATE ROLE "octoforge_reader" WITH NOLOGIN',
      'GRANT USAGE ON SCHEMA "alice-tool" TO "octoforge_reader"',
      'GRANT SELECT ON ALL TABLES IN SCHEMA "alice-tool" TO "octoforge_reader"',
      'ALTER DEFAULT PRIVILEGES FOR ROLE "alice-tool" IN SCHEMA "alice-tool" GRANT SELECT ON TABLES TO "octoforge_reader"',
    ]);
  });

  test('existing roles: the password is rotated, the reader is not created again', () => {
    const stmts = buildAdoptionSql({
      member: 'alice-tool',
      password: PW,
      roleExists: true,
      readerExists: true,
    });
    expect(stmts[0]).toBe(`ALTER ROLE "alice-tool" WITH LOGIN PASSWORD '${PW}'`);
    expect(stmts.some((s) => s.startsWith('CREATE ROLE'))).toBe(false);
  });

  test('refuses names that are not members or are reserved, and odd passwords', () => {
    const base = { password: PW, roleExists: false, readerExists: false };
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
