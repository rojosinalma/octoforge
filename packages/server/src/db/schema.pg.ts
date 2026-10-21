import { bigint, boolean, index, pgTable, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';

// Postgres twin of schema.ts. Tables live in the `forge` schema: the connection sets
// search_path=forge and the migrations run there, so the table definitions stay unqualified.

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const instances = pgTable(
  'instances',
  {
    id: serial('id').primaryKey(),
    member: text('member').notNull(),
    baseUrl: text('base_url').notNull(),
    /** Where GitHub and browsers reach the instance, when it differs from base_url. */
    publicUrl: text('public_url'),
    label: text('label').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('instances_member_url').on(t.member, t.baseUrl)],
);

export const deliveries = pgTable(
  'deliveries',
  {
    id: serial('id').primaryKey(),
    at: text('at').notNull(),
    member: text('member').notNull(),
    target: text('target').notNull(),
    kind: text('kind').notNull(),
    ok: boolean('ok').notNull(),
    message: text('message').notNull(),
    detail: text('detail').notNull().default('{}'),
  },
  (t) => [index('deliveries_at').on(t.at)],
);

export const adoptions = pgTable(
  'adoptions',
  {
    id: serial('id').primaryKey(),
    at: text('at').notNull(),
    member: text('member').notNull(),
    target: text('target').notNull(),
    engine: text('engine').notNull(),
    ok: boolean('ok').notNull(),
    message: text('message').notNull(),
    detail: text('detail').notNull().default('{}'),
  },
  (t) => [index('adoptions_at').on(t.at)],
);

/** Postgres roles Octoforge created itself: only these may get a new password on a later adoption. */
export const createdRoles = pgTable(
  'created_roles',
  {
    id: serial('id').primaryKey(),
    /** host:port of FORGE_PG_ADMIN_URL; role names are cluster-wide. */
    cluster: text('cluster').notNull(),
    role: text('role').notNull(),
    /** pg_roles.oid at creation: a role dropped and created again by someone else does not match. */
    oid: bigint('oid', { mode: 'number' }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('created_roles_cluster_role').on(t.cluster, t.role)],
);
