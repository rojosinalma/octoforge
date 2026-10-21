import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// SQLite schema. The Postgres twin is schema.pg.ts; both feed drizzle-kit and must stay in step.
// No table ever holds a credential, a private key, a token or a database password.

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const instances = sqliteTable(
  'instances',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    member: text('member').notNull(),
    baseUrl: text('base_url').notNull(),
    /** Where GitHub and browsers reach the instance, when it differs from base_url. */
    publicUrl: text('public_url'),
    label: text('label').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('instances_member_url').on(t.member, t.baseUrl)],
);

export const deliveries = sqliteTable(
  'deliveries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: text('at').notNull(),
    member: text('member').notNull(),
    target: text('target').notNull(),
    kind: text('kind').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    message: text('message').notNull(),
    detail: text('detail').notNull().default('{}'),
  },
  (t) => [index('deliveries_at').on(t.at)],
);

export const adoptions = sqliteTable(
  'adoptions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: text('at').notNull(),
    member: text('member').notNull(),
    target: text('target').notNull(),
    engine: text('engine').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    message: text('message').notNull(),
    detail: text('detail').notNull().default('{}'),
  },
  (t) => [index('adoptions_at').on(t.at)],
);

/** Postgres roles Octoforge created itself: only these may get a new password on a later adoption. */
export const createdRoles = sqliteTable(
  'created_roles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** host:port of FORGE_PG_ADMIN_URL; role names are cluster-wide. */
    cluster: text('cluster').notNull(),
    role: text('role').notNull(),
    /** pg_roles.oid at creation: a role dropped and created again by someone else does not match. */
    oid: integer('oid').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('created_roles_cluster_role').on(t.cluster, t.role)],
);
