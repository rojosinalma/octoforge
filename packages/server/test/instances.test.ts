import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { openDb } from '../src/db';
import { listInstances } from '../src/lib/instances';
import { type Call, json, MANIFEST, testApp } from './helpers';

const MIGRATIONS = path.resolve(import.meta.dir, '../src/db/migrations');

function member(status: (c: Call) => Response | undefined = () => undefined) {
  return (c: Call) => {
    if (c.url.endsWith('/api/octoforge/manifest')) return json(MANIFEST);
    if (c.url.endsWith('/api/octoforge/status')) return status(c);
    return undefined;
  };
}

describe('instance public URL', () => {
  test('set on create, changed and cleared later; blank = not set; validated like the base URL', async () => {
    const t = await testApp(member());
    const add = await t.req('POST', '/api/instances', {
      member: 'alice-tool',
      baseUrl: 'http://alice-tool:8080/',
      publicUrl: ' https://alice.example.com/ ',
    });
    expect(add.body.instance).toMatchObject({
      baseUrl: 'http://alice-tool:8080',
      publicUrl: 'https://alice.example.com',
    });
    const id = add.body.instance.id;

    const blank = await t.req('POST', '/api/instances', {
      member: 'alice-tool',
      baseUrl: 'https://b.example.com',
      publicUrl: '',
    });
    expect(blank.body.instance.publicUrl).toBeNull();
    const none = await t.req('POST', '/api/instances', {
      member: 'alice-tool',
      baseUrl: 'https://c.example.com',
    });
    expect(none.body.instance.publicUrl).toBeNull();

    const bad = await t.req('POST', '/api/instances', {
      member: 'alice-tool',
      baseUrl: 'https://d.example.com',
      publicUrl: 'ftp://d.example.com',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.kind).toBe('validation');

    const set = await t.req('PATCH', `/api/instances/${id}`, { publicUrl: 'https://other.example.com//' });
    expect(set.body.instance.publicUrl).toBe('https://other.example.com');
    expect((await listInstances(t.db, 'alice-tool'))[0]?.publicUrl).toBe('https://other.example.com');

    const cleared = await t.req('PATCH', `/api/instances/${id}`, { publicUrl: null });
    expect(cleared.body.instance.publicUrl).toBeNull();
    expect((await t.req('PATCH', `/api/instances/${id}`, { publicUrl: 'nope' })).status).toBe(400);
    expect((await t.req('PATCH', `/api/instances/${id}`, {})).status).toBe(400);
    expect((await t.req('PATCH', '/api/instances/9999', { publicUrl: null })).status).toBe(404);
  });

  describe('the App manifest uses the resolved public address', () => {
    const start = async (t: Awaited<ReturnType<typeof testApp>>, inst: Record<string, unknown>) => {
      const id = (await t.req('POST', '/api/instances', { member: 'alice-tool', ...inst })).body.instance.id;
      const r = await t.req('POST', '/api/members/alice-tool/app', { instanceId: id, name: 'Alice tool' });
      expect(r.status).toBe(200);
      return r.body.manifest;
    };

    test('1. the instance setting, without asking the member', async () => {
      const t = await testApp(
        member(() => json({ contract: 1, public_url: 'https://reported.example.com' })),
      );
      const m = await start(t, { baseUrl: 'http://alice-tool:8080', publicUrl: 'https://alice.example.com' });
      expect(m.hook_attributes.url).toBe('https://alice.example.com/webhooks/github');
      expect(t.calls.some((c) => c.url.endsWith('/api/octoforge/status'))).toBe(false);
    });

    test('2. the public_url the member reports in its status', async () => {
      const t = await testApp(
        member(() => json({ contract: 1, public_url: 'https://reported.example.com/' })),
      );
      const m = await start(t, { baseUrl: 'http://alice-tool:8080' });
      expect(m.hook_attributes.url).toBe('https://reported.example.com/webhooks/github');
      const status = t.calls.find((c) => c.url === 'http://alice-tool:8080/api/octoforge/status');
      expect(status?.headers.get('authorization')).toStartWith('Bearer ');
    });

    test('3. the base URL when neither is set or the member does not answer', async () => {
      const silent = await testApp(member(() => json({ contract: 1 })));
      expect((await start(silent, { baseUrl: 'https://a.example.com' })).hook_attributes.url).toBe(
        'https://a.example.com/webhooks/github',
      );
      const down = await testApp(member(() => json({ message: 'down' }, 503)));
      expect((await start(down, { baseUrl: 'https://a.example.com' })).hook_attributes.url).toBe(
        'https://a.example.com/webhooks/github',
      );
    });
  });
});

describe('migration 0001_public_url', () => {
  test('SQLite: a database made by 0000 upgrades in place and keeps its rows', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octoforge-migrate-'));
    // A migrations folder that stops at 0000, as an older release shipped it.
    const old = path.join(dir, 'migrations');
    fs.cpSync(path.join(MIGRATIONS, 'sqlite'), old, { recursive: true });
    const journalFile = path.join(old, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    journal.entries = journal.entries.filter((e: { tag: string }) => e.tag === '0000_init');
    fs.writeFileSync(journalFile, JSON.stringify(journal));

    const file = path.join(dir, 'octoforge.db');
    const client = new Database(file, { create: true });
    migrate(drizzle(client), { migrationsFolder: old });
    client.run(
      "insert into instances (member, base_url, label, created_at) values ('alice-tool', 'https://a.example.com', '', '2026-01-01T00:00:00.000Z')",
    );
    expect(client.query("select name from pragma_table_info('instances')").all()).not.toContainEqual({
      name: 'public_url',
    });
    client.close();

    const db = await openDb(`sqlite:${file}`);
    const [inst] = await listInstances(db);
    expect(inst).toMatchObject({ member: 'alice-tool', baseUrl: 'https://a.example.com', publicUrl: null });
    await db.close();
  });

  test('both dialects: one additive, nullable column in step with the journal', () => {
    for (const dialect of ['sqlite', 'postgres']) {
      const dirOf = path.join(MIGRATIONS, dialect);
      const sqlText = fs.readFileSync(path.join(dirOf, '0001_public_url.sql'), 'utf8').trim();
      expect(sqlText).toMatch(/^ALTER TABLE [`"]instances[`"] ADD (COLUMN )?[`"]public_url[`"] text;$/);
      const journal = JSON.parse(fs.readFileSync(path.join(dirOf, 'meta', '_journal.json'), 'utf8'));
      expect(journal.entries.slice(0, 2).map((e: { tag: string }) => e.tag)).toEqual([
        '0000_init',
        '0001_public_url',
      ]);
      const snap = JSON.parse(fs.readFileSync(path.join(dirOf, 'meta', '0001_snapshot.json'), 'utf8'));
      const prev = JSON.parse(fs.readFileSync(path.join(dirOf, 'meta', '0000_snapshot.json'), 'utf8'));
      expect(snap.prevId).toBe(prev.id);
      const table = snap.tables.instances ?? snap.tables['public.instances'];
      expect(table.columns.public_url).toMatchObject({ type: 'text', notNull: false });
    }
  });

  test('0002_created_roles: one new table in both dialects, in step with the journal', () => {
    for (const dialect of ['sqlite', 'postgres']) {
      const dirOf = path.join(MIGRATIONS, dialect);
      const sqlText = fs.readFileSync(path.join(dirOf, '0002_created_roles.sql'), 'utf8');
      expect(sqlText).toMatch(/^CREATE TABLE [`"]created_roles[`"]/);
      expect(sqlText).not.toMatch(/ALTER TABLE|DROP/);
      const journal = JSON.parse(fs.readFileSync(path.join(dirOf, 'meta', '_journal.json'), 'utf8'));
      expect(journal.entries.map((e: { tag: string }) => e.tag)).toEqual([
        '0000_init',
        '0001_public_url',
        '0002_created_roles',
      ]);
      const snap = JSON.parse(fs.readFileSync(path.join(dirOf, 'meta', '0002_snapshot.json'), 'utf8'));
      const prev = JSON.parse(fs.readFileSync(path.join(dirOf, 'meta', '0001_snapshot.json'), 'utf8'));
      expect(snap.prevId).toBe(prev.id);
    }
  });
});
