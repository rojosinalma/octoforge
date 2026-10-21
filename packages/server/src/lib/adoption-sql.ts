import { randomBytes } from 'node:crypto';
import { MemberName } from '@octoforge/shared';

// Postgres adoption (docs/members.md §3): one login role and one schema per member, both named after
// the member, plus the shared read-only role. DDL cannot take bind parameters, so every identifier
// and literal is validated and quoted here; the builder is pure so tests can read the statements.

export const READER_ROLE = 'octoforge_reader';
/** Names a member may not take: Octoforge's own schema, the reader role, Postgres' own namespaces. */
const RESERVED = new Set(['forge', 'public', 'information_schema', READER_ROLE, 'postgres']);

export function assertAdoptableName(name: string): void {
  if (!MemberName.safeParse(name).success) throw new Error(`"${name}" is not a valid member name`);
  if (RESERVED.has(name) || name.startsWith('pg_')) throw new Error(`"${name}" is reserved in Postgres`);
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  if (value.includes('\0')) throw new Error('literal contains a NUL byte');
  return `'${value.replace(/'/g, "''")}'`;
}

/** 32 random bytes as hex: no character that needs escaping in a URL or a literal. */
export function generatePassword(): string {
  return randomBytes(32).toString('hex');
}

/**
 * What adoption does with the member's login role:
 * - `create`: the role is missing; Octoforge creates it with a generated password.
 * - `rotate`: the role exists and Octoforge created it; a new generated password replaces the old one.
 * - `keep`: the role exists and its current password was given; the password stays as it is.
 * - `refuse`: the role exists, Octoforge did not create it and no password was given.
 */
export type RoleAction = 'create' | 'rotate' | 'keep' | 'refuse';

export function roleAction(input: {
  roleExists: boolean;
  createdByOctoforge: boolean;
  existingPassword: boolean;
}): RoleAction {
  if (!input.roleExists) return 'create';
  if (input.existingPassword) return 'keep';
  return input.createdByOctoforge ? 'rotate' : 'refuse';
}

export interface AdoptionSqlInput {
  member: string;
  role: Exclude<RoleAction, 'refuse'>;
  /** The generated password for `create` and `rotate`; unused (and not needed) for `keep`. */
  password?: string;
  readerExists: boolean;
  /** The shared database: members and the reader need CONNECT when PUBLIC has none. */
  database: string;
}

/** Statements run in one transaction by the admin role (CREATEROLE and CREATE on the database). */
export function buildAdoptionSql(input: AdoptionSqlInput): string[] {
  assertAdoptableName(input.member);
  const role = quoteIdent(input.member);
  const schema = quoteIdent(input.member);
  const reader = quoteIdent(READER_ROLE);
  if (!input.database) throw new Error('the admin URL names no database');
  const database = quoteIdent(input.database);
  const login: string[] = [];
  if (input.role !== 'keep') {
    if (!input.password || !/^[A-Za-z0-9]{16,128}$/.test(input.password))
      throw new Error('generated password has an unexpected form');
    const pw = quoteLiteral(input.password);
    // A CREATEROLE admin may only touch LOGIN and PASSWORD of an existing role (Postgres 16+ rules).
    login.push(
      input.role === 'rotate'
        ? `ALTER ROLE ${role} WITH LOGIN PASSWORD ${pw}`
        : `CREATE ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${pw}`,
    );
  }
  return [
    ...login,
    // The admin needs membership to hand the schema to the role and to set its default privileges.
    `GRANT ${role} TO CURRENT_USER`,
    `CREATE SCHEMA IF NOT EXISTS ${schema} AUTHORIZATION ${role}`,
    `ALTER SCHEMA ${schema} OWNER TO ${role}`,
    `REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`,
    // Per database: a role that also works in its own database keeps its search_path there.
    `ALTER ROLE ${role} IN DATABASE ${database} SET search_path = ${schema}`,
    ...(input.readerExists ? [] : [`CREATE ROLE ${reader} WITH NOLOGIN`]),
    `GRANT CONNECT ON DATABASE ${database} TO ${role}, ${reader}`,
    `GRANT USAGE ON SCHEMA ${schema} TO ${reader}`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${reader}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${role} IN SCHEMA ${schema} GRANT SELECT ON TABLES TO ${reader}`,
  ];
}

/** Role names are cluster-wide: the cluster is the admin URL's host and port. */
export function clusterOf(adminUrl: string): string {
  const u = new URL(adminUrl);
  return `${u.hostname}:${u.port || '5432'}`;
}

/**
 * The URL the member connects with: the admin URL's database and TLS options, the member's role and
 * password, and the host members reach Postgres on (`pgMemberHost`, else the admin URL's host).
 */
export function memberDatabaseUrl(
  adminUrl: string,
  member: string,
  password: string,
  memberHost: string,
): string {
  const admin = new URL(adminUrl);
  const out = new URL(adminUrl);
  out.username = encodeURIComponent(member);
  out.password = encodeURIComponent(password);
  if (memberHost) {
    const [host, port] = memberHost.split(':');
    out.hostname = host ?? admin.hostname;
    out.port = port ?? '';
  }
  return out.toString();
}

/** `sqlite:<dir>/<member>.db`, with the directory as the members see it. */
export function sqliteMemberUrl(sharedDir: string, member: string): string {
  assertAdoptableName(member);
  return `sqlite:${sharedDir.replace(/\/+$/, '')}/${member}.db`;
}
