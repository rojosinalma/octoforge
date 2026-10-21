import type { AdoptResult, Engine, Instance } from '@octoforge/shared';
import { sql as q } from 'drizzle-orm';
import postgres from 'postgres';
import type { Db } from '../db';
import { redactUrl } from '../db/driver';
import { errMessage, log } from '../log';
import {
  assertAdoptableName,
  buildAdoptionSql,
  clusterOf,
  generatePassword,
  memberDatabaseUrl,
  READER_ROLE,
  type RoleAction,
  roleAction,
  sqliteMemberUrl,
} from './adoption-sql';
import { ActionError, type Credentials } from './credentials';
import { getInstance, listInstances } from './instances';
import { logAdoption } from './journal';
import type { MemberRegistry } from './members';
import type { SecretStore } from './secrets';
import { getSettings } from './settings';

export interface ProvisionInput {
  member: string;
  /** A fresh random password, used when the role is created or rotated. */
  generated: string;
  /** The current password of a role that already exists; it stays unchanged. Never logged. */
  existing?: string;
  /** pg_roles.oid recorded when Octoforge created this role, else null. */
  createdOid: number | null;
}

export interface Provisioned {
  action: Exclude<RoleAction, 'refuse'>;
  /** The password the member connects with: `generated`, or `existing` for `keep`. */
  password: string;
  /** pg_roles.oid of the member role. */
  oid: number;
}

export interface DatabaseDeps {
  db: Db;
  store: SecretStore;
  members: MemberRegistry;
  credentials: Credentials;
  pgAdminUrl: string | undefined;
  sharedData: string | undefined;
  /** Runs the role/schema statements; replaced in tests. */
  provision?: (adminUrl: string, input: ProvisionInput) => Promise<Provisioned>;
}

/**
 * Logs in as the member role to the shared database. A missing CONNECT privilege (42501) still
 * proves the password: Postgres checks it only after authentication, and adoption grants it.
 */
async function checkLogin(adminUrl: string, member: string, password: string): Promise<void> {
  const sql = postgres(adminUrl, {
    username: member,
    password,
    max: 1,
    connect_timeout: 10,
    fetch_types: false,
    onnotice: () => {},
  });
  try {
    await sql`select 1`;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '42501') return;
    if (code === '28P01') throw new ActionError('validation', `the password does not log in as ${member}`);
    if (code === '28000')
      throw new ActionError('validation', `the password does not log in as ${member}: ${errMessage(err)}`);
    throw new ActionError('upstream', `Postgres: cannot log in as ${member}: ${errMessage(err)}`);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

/**
 * Creates the member's role and schema with the admin URL, all in one transaction. An existing role
 * keeps its password when it is given (checked first, before any DDL); without it, only a role that
 * Octoforge created gets a new one.
 */
export async function provisionPostgres(adminUrl: string, input: ProvisionInput): Promise<Provisioned> {
  const { member } = input;
  const logger = log('postgres');
  const sql = postgres(adminUrl, { max: 1, connect_timeout: 10, onnotice: () => {} });
  const target = redactUrl(adminUrl);
  let action: RoleAction | null = null;
  try {
    const [role] = await sql`select oid::bigint as oid from pg_roles where rolname = ${member}`;
    const [reader] = await sql`select 1 as x from pg_roles where rolname = ${READER_ROLE}`;
    action = roleAction({
      roleExists: Boolean(role),
      createdByOctoforge: Boolean(role) && Number(role?.oid) === input.createdOid,
      existingPassword: Boolean(input.existing),
    });
    if (action === 'refuse') {
      throw new ActionError(
        'conflict',
        `role ${member} already exists and was not created by Octoforge: pass its current password`,
      );
    }
    const password = action === 'keep' ? (input.existing as string) : input.generated;
    if (action === 'keep') {
      await checkLogin(adminUrl, member, password);
      const [grant] =
        await sql`select pg_has_role(current_user, ${member}, 'MEMBER WITH ADMIN OPTION') as ok, current_user as me`;
      if (!grant?.ok) {
        throw new ActionError(
          'conflict',
          `the admin role has no ADMIN OPTION on ${member}: run GRANT "${member}" TO "${grant?.me}" WITH ADMIN OPTION as a superuser`,
        );
      }
    }
    const statements = buildAdoptionSql({
      member,
      role: action,
      password: action === 'keep' ? undefined : password,
      readerExists: Boolean(reader),
      database: decodeURIComponent(new URL(adminUrl).pathname.replace(/^\//, '')),
    });
    const oid = await sql.begin(async (tx) => {
      for (const stmt of statements) await tx.unsafe(stmt);
      const [row] = await tx`select oid::bigint as oid from pg_roles where rolname = ${member}`;
      return Number(row?.oid);
    });
    logger.info(`provision ${member} on ${target}`, { outcome: 'ok', role: action });
    return { action, password, oid };
  } catch (err) {
    logger.warn(`provision ${member} on ${target}`, {
      outcome: 'failed',
      role: action,
      reason: errMessage(err),
    });
    if (err instanceof ActionError) throw err;
    throw new ActionError('upstream', `Postgres: ${errMessage(err)}`);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

async function createdRoleOid(db: Db, cluster: string, role: string): Promise<number | null> {
  const [row] = await db.all(q`select oid from created_roles where cluster = ${cluster} and role = ${role}`);
  return row ? Number(row.oid) : null;
}

async function recordCreatedRole(db: Db, cluster: string, role: string, oid: number): Promise<void> {
  const at = new Date().toISOString();
  await db.run(
    q`insert into created_roles (cluster, role, oid, created_at) values (${cluster}, ${role}, ${oid}, ${at})
      on conflict (cluster, role) do update set oid = excluded.oid, created_at = excluded.created_at`,
  );
}

const ROLE_NOTE: Record<Provisioned['action'], string> = {
  create: 'created',
  rotate: 'new password',
  keep: 'password kept',
};

/** Moves a member's instances into the shared database (docs/members.md §3). */
export class Database {
  constructor(private readonly deps: DatabaseDeps) {}

  engines(): Engine[] {
    const out: Engine[] = [];
    if (this.deps.pgAdminUrl) out.push('postgres');
    if (this.deps.sharedData) out.push('sqlite');
    return out;
  }

  async adopt(
    member: string,
    engine: Engine,
    opts: { existingPassword?: string } = {},
  ): Promise<{ results: AdoptResult[]; schema: string; url: string }> {
    const { manifest } = await this.deps.credentials.requireMember(member);
    const db = manifest.database;
    if (!db?.engines.includes(engine))
      throw new ActionError('validation', `${member} cannot run on ${engine}`);
    if (engine === 'postgres' && !db.schema) {
      throw new ActionError('validation', `${member} cannot live in a named Postgres schema`);
    }
    if (opts.existingPassword && engine !== 'postgres')
      throw new ActionError('validation', 'a current password applies to Postgres only');
    try {
      assertAdoptableName(member);
    } catch (err) {
      throw new ActionError('validation', errMessage(err));
    }
    const instances = await listInstances(this.deps.db, member);
    if (!instances.length) throw new ActionError('validation', `${member} has no instance to adopt`);
    const s = await getSettings(this.deps.db);

    let url: string;
    let shown: string;
    let secretId: string | null = null;
    let role: string | null = null;
    if (engine === 'postgres') {
      const admin = this.deps.pgAdminUrl;
      if (!admin) throw new ActionError('unavailable', 'FORGE_PG_ADMIN_URL is not set');
      const cluster = clusterOf(admin);
      let done: Provisioned;
      try {
        done = await (this.deps.provision ?? provisionPostgres)(admin, {
          member,
          generated: generatePassword(),
          existing: opts.existingPassword,
          createdOid: await createdRoleOid(this.deps.db, cluster, member),
        });
      } catch (err) {
        await logAdoption(this.deps.db, {
          member,
          target: redactUrl(admin),
          action: engine,
          ok: false,
          message: errMessage(err),
        });
        throw err;
      }
      if (done.action === 'create') await recordCreatedRole(this.deps.db, cluster, member, done.oid);
      role = ROLE_NOTE[done.action];
      // Memory only, for the length of the adoption; gone when the last instance has answered.
      secretId = this.deps.store.put({
        kind: 'db',
        member,
        secret: done.password,
        meta: {},
        ttlMs: s.secretTtlMin * 60_000,
        max: s.secretStoreMax,
      }).id;
      url = memberDatabaseUrl(admin, member, done.password, s.pgMemberHost);
      shown = redactUrl(url);
    } else {
      const dir = this.deps.sharedData;
      if (!dir) throw new ActionError('unavailable', 'OCTOFORGE_SHARED_DATA is not set');
      url = sqliteMemberUrl(dir, member);
      shown = url;
    }

    const results: AdoptResult[] = [];
    try {
      const [first, ...rest] = instances as [Instance, ...Instance[]];
      const head = await this.adoptOne(
        member,
        engine,
        first,
        url,
        shown,
        role,
        true,
        s.adoptTimeoutSec * 1000,
      );
      results.push(head);
      if (head.ok) {
        results.push(
          ...(await Promise.all(
            rest.map((i) =>
              this.adoptOne(member, engine, i, url, shown, role, false, s.adoptTimeoutSec * 1000),
            ),
          )),
        );
      } else {
        for (const i of rest) {
          results.push({
            instance: i,
            ok: false,
            copy: false,
            message: 'skipped: the copy on the first instance failed',
            tables: null,
            restartRequired: null,
          });
        }
      }
    } finally {
      if (secretId) this.deps.store.delete(secretId);
    }
    return { results, schema: member, url: shown };
  }

  private async adoptOne(
    member: string,
    engine: Engine,
    inst: Instance,
    url: string,
    shown: string,
    role: string | null,
    copy: boolean,
    timeoutMs: number,
  ): Promise<AdoptResult> {
    const r = await (await this.deps.members.client(inst.baseUrl)).adopt(
      { url, schema: member, copy },
      timeoutMs,
    );
    const result: AdoptResult = r.ok
      ? {
          instance: inst,
          ok: true,
          copy,
          message: r.data.message || 'adopted',
          tables: r.data.tables ?? null,
          restartRequired: r.data.restart_required ?? null,
        }
      : { instance: inst, ok: false, copy, message: r.message, tables: null, restartRequired: null };
    await logAdoption(this.deps.db, {
      member,
      target: inst.baseUrl,
      action: engine,
      ok: result.ok,
      message: result.message,
      detail: {
        url: shown,
        schema: member,
        ...(role ? { role } : {}),
        copy,
        tables: result.tables,
        restart_required: result.restartRequired,
      },
    });
    return result;
  }

  /** DELETE /api/octoforge/database on one instance: back to its own DATABASE_URL after a restart. */
  async release(member: string, instanceId: number): Promise<AdoptResult> {
    const inst = await getInstance(this.deps.db, instanceId);
    if (!inst || inst.member !== member)
      throw new ActionError('not_found', 'no such instance of this member');
    const r = await (await this.deps.members.client(inst.baseUrl)).dropDatabase();
    const result: AdoptResult = r.ok
      ? {
          instance: inst,
          ok: true,
          copy: false,
          message: r.data.message || 'released',
          tables: null,
          restartRequired: r.data.restart_required ?? true,
        }
      : { instance: inst, ok: false, copy: false, message: r.message, tables: null, restartRequired: null };
    await logAdoption(this.deps.db, {
      member,
      target: inst.baseUrl,
      action: 'release',
      ok: result.ok,
      message: result.message,
      detail: { restart_required: result.restartRequired },
    });
    return result;
  }
}
