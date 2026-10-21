import type { LogEntry, LogKind } from '@octoforge/shared';
import { sql } from 'drizzle-orm';
import { bool, type Db, json, type Row } from '../db';

// Delivery and adoption log: what went where, when, and whether it worked. Never a secret:
// callers pass messages and details built from member answers and redacted URLs only.

export interface JournalInput {
  member: string;
  target: string;
  action: string;
  ok: boolean;
  message: string;
  detail?: Record<string, unknown>;
}

export async function logDelivery(db: Db, e: JournalInput): Promise<void> {
  await db.run(
    sql`insert into deliveries (at, member, target, kind, ok, message, detail)
        values (${new Date().toISOString()}, ${e.member}, ${e.target}, ${e.action}, ${e.ok}, ${e.message},
                ${JSON.stringify(e.detail ?? {})})`,
  );
}

export async function logAdoption(db: Db, e: JournalInput): Promise<void> {
  await db.run(
    sql`insert into adoptions (at, member, target, engine, ok, message, detail)
        values (${new Date().toISOString()}, ${e.member}, ${e.target}, ${e.action}, ${e.ok}, ${e.message},
                ${JSON.stringify(e.detail ?? {})})`,
  );
}

function toEntry(kind: LogKind, r: Row): LogEntry {
  return {
    id: Number(r.id),
    kind,
    at: String(r.at),
    member: String(r.member),
    target: String(r.target),
    action: String(r.action),
    ok: bool(r.ok),
    message: String(r.message),
    detail: json(r.detail),
  };
}

/** Newest first; `before` (an ISO time) pages backwards. */
export async function listLog(
  db: Db,
  opts: { kind?: LogKind; member?: string; before?: string; limit: number },
): Promise<LogEntry[]> {
  const before = opts.before ?? '9999';
  const byMember = opts.member ? sql`and member = ${opts.member}` : sql``;
  const out: LogEntry[] = [];
  if (opts.kind !== 'adoption') {
    const rows = await db.all(
      sql`select id, at, member, target, kind as action, ok, message, detail from deliveries
          where at < ${before} ${byMember}
          order by at desc limit ${opts.limit}`,
    );
    out.push(...rows.map((r) => toEntry('delivery', r)));
  }
  if (opts.kind !== 'delivery') {
    const rows = await db.all(
      sql`select id, at, member, target, engine as action, ok, message, detail from adoptions
          where at < ${before} ${byMember}
          order by at desc limit ${opts.limit}`,
    );
    out.push(...rows.map((r) => toEntry('adoption', r)));
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, opts.limit);
}

/** Retention: drops rows older than `days`. Returns how many went. */
export async function pruneLog(db: Db, days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const a = await db.all(sql`delete from deliveries where at < ${cutoff} returning id`);
  const b = await db.all(sql`delete from adoptions where at < ${cutoff} returning id`);
  return a.length + b.length;
}
