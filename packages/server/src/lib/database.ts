import type { AdoptResult, Engine, Instance } from '@octoforge/shared';
import postgres from 'postgres';
import type { Db } from '../db';
import { redactUrl } from '../db/driver';
import { errMessage, log } from '../log';
import {
  assertAdoptableName,
  buildAdoptionSql,
  generatePassword,
  memberDatabaseUrl,
  READER_ROLE,
  sqliteMemberUrl,
} from './adoption-sql';
import { ActionError, type Credentials } from './credentials';
import { getInstance, listInstances } from './instances';
import { logAdoption } from './journal';
import type { MemberRegistry } from './members';
import type { SecretStore } from './secrets';
import { getSettings } from './settings';

export interface DatabaseDeps {
  db: Db;
  store: SecretStore;
  members: MemberRegistry;
  credentials: Credentials;
  pgAdminUrl: string | undefined;
  sharedData: string | undefined;
  /** Runs the role/schema statements; replaced in tests. */
  provision?: (adminUrl: string, member: string, password: string) => Promise<void>;
}

/** Creates (or rotates) the member's role and schema with the admin URL, all in one transaction. */
export async function provisionPostgres(adminUrl: string, member: string, password: string): Promise<void> {
  const logger = log('postgres');
  const sql = postgres(adminUrl, { max: 1, connect_timeout: 10, onnotice: () => {} });
  const target = redactUrl(adminUrl);
  try {
    await sql.begin(async (tx) => {
      const [role] = await tx`select 1 as x from pg_roles where rolname = ${member}`;
      const [reader] = await tx`select 1 as x from pg_roles where rolname = ${READER_ROLE}`;
      for (const stmt of buildAdoptionSql({
        member,
        password,
        roleExists: Boolean(role),
        readerExists: Boolean(reader),
      })) {
        await tx.unsafe(stmt);
      }
    });
    logger.info(`provision ${member} on ${target}`, { outcome: 'ok' });
  } catch (err) {
    logger.warn(`provision ${member} on ${target}`, { outcome: 'failed', reason: errMessage(err) });
    throw new ActionError('upstream', `Postgres: ${errMessage(err)}`);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

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
  ): Promise<{ results: AdoptResult[]; schema: string; url: string }> {
    const { manifest } = await this.deps.credentials.requireMember(member);
    const db = manifest.database;
    if (!db?.engines.includes(engine))
      throw new ActionError('validation', `${member} cannot run on ${engine}`);
    if (engine === 'postgres' && !db.schema) {
      throw new ActionError('validation', `${member} cannot live in a named Postgres schema`);
    }
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
    if (engine === 'postgres') {
      const admin = this.deps.pgAdminUrl;
      if (!admin) throw new ActionError('unavailable', 'FORGE_PG_ADMIN_URL is not set');
      const password = generatePassword();
      // Memory only, for the length of the adoption; gone when the last instance has answered.
      secretId = this.deps.store.put({
        kind: 'db',
        member,
        secret: password,
        meta: {},
        ttlMs: s.secretTtlMin * 60_000,
        max: s.secretStoreMax,
      }).id;
      try {
        await (this.deps.provision ?? provisionPostgres)(admin, member, password);
      } catch (err) {
        this.deps.store.delete(secretId);
        await logAdoption(this.deps.db, {
          member,
          target: redactUrl(admin),
          action: engine,
          ok: false,
          message: errMessage(err),
        });
        throw err;
      }
      url = memberDatabaseUrl(admin, member, password, s.pgMemberHost);
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
      const head = await this.adoptOne(member, engine, first, url, shown, true, s.adoptTimeoutSec * 1000);
      results.push(head);
      if (head.ok) {
        results.push(
          ...(await Promise.all(
            rest.map((i) => this.adoptOne(member, engine, i, url, shown, false, s.adoptTimeoutSec * 1000)),
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
