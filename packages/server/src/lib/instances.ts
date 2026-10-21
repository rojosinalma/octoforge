import type { Instance } from '@octoforge/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Row } from '../db';

const HttpUrl = z
  .string()
  .trim()
  .url('must be a URL')
  .regex(/^https?:\/\//, 'must start with http:// or https://')
  .transform((u) => u.replace(/\/+$/, ''));

const blankToNull = (v: unknown) => (typeof v === 'string' && !v.trim() ? null : v);
/** URL or null; blank = null. */
const NullableUrl = z.preprocess(blankToNull, HttpUrl.nullable());

export const NewInstance = z.object({
  member: z.string().min(1),
  baseUrl: HttpUrl,
  publicUrl: NullableUrl.optional().transform((v) => v ?? null),
  label: z.string().trim().max(60).default(''),
});
export type NewInstance = z.infer<typeof NewInstance>;

/** Change to an existing instance; `publicUrl: null` or blank clears it. */
export const InstancePatch = z.object({ publicUrl: NullableUrl });
export type InstancePatch = z.infer<typeof InstancePatch>;

function toInstance(r: Row): Instance {
  return {
    id: Number(r.id),
    member: String(r.member),
    baseUrl: String(r.base_url),
    publicUrl: r.public_url ? String(r.public_url) : null,
    label: String(r.label ?? ''),
    createdAt: String(r.created_at),
  };
}

export async function listInstances(db: Db, member?: string): Promise<Instance[]> {
  const rows = member
    ? await db.all(sql`select * from instances where member = ${member} order by id`)
    : await db.all(sql`select * from instances order by member, id`);
  return rows.map(toInstance);
}

export async function getInstance(db: Db, id: number): Promise<Instance | null> {
  const [row] = await db.all(sql`select * from instances where id = ${id}`);
  return row ? toInstance(row) : null;
}

export async function addInstance(db: Db, input: NewInstance): Promise<Instance> {
  const now = new Date().toISOString();
  const [row] = await db.all(
    sql`insert into instances (member, base_url, public_url, label, created_at)
        values (${input.member}, ${input.baseUrl}, ${input.publicUrl}, ${input.label}, ${now}) returning *`,
  );
  if (!row) throw new Error('insert returned no row');
  return toInstance(row);
}

export async function updateInstance(db: Db, id: number, patch: InstancePatch): Promise<Instance | null> {
  const [row] = await db.all(
    sql`update instances set public_url = ${patch.publicUrl} where id = ${id} returning *`,
  );
  return row ? toInstance(row) : null;
}

export async function removeInstance(db: Db, id: number): Promise<boolean> {
  const rows = await db.all(sql`delete from instances where id = ${id} returning id`);
  return rows.length > 0;
}
