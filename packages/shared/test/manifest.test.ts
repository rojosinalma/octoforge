import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { MemberStatus, parseManifest } from '../src';

/** The example in the contract document must always parse: docs and schema stay in step. */
function contractExample(): unknown {
  const doc = fs.readFileSync(path.resolve(import.meta.dir, '../../../docs/members.md'), 'utf8');
  const block = /```json\n([\s\S]*?)\n```/.exec(doc);
  if (!block?.[1]) throw new Error('no json block in docs/members.md');
  return JSON.parse(block[1]);
}

const minimal = { contract: 1, name: 'alice-tool', title: 'Alice tool' };

describe('parseManifest', () => {
  test('the contract example in docs/members.md parses', () => {
    const r = parseManifest(contractExample());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.name).toBe('octohatchery');
    expect(r.manifest.github?.auth).toEqual(['app', 'pat']);
    expect(r.manifest.github?.app?.permissions.administration).toBe('write');
    expect(r.manifest.github?.app?.webhook_path).toBe('/webhooks/github');
    expect(r.manifest.github?.pat?.classic_scopes).toEqual(['repo', 'workflow']);
    expect(r.manifest.database).toEqual({ engines: ['sqlite', 'postgres'], schema: true });
    expect(r.manifest.env.app_private_key).toBe('GITHUB_APP_PRIVATE_KEY');
  });

  test('a minimal manifest gets defaults', () => {
    const r = parseManifest(minimal);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.health).toBe('/health');
    expect(r.manifest.description).toBe('');
    expect(r.manifest.env).toEqual({});
    expect(r.manifest.github).toBeUndefined();
  });

  test('refuses an unknown contract version', () => {
    const r = parseManifest({ ...minimal, contract: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('contract 2 is not supported');
  });

  test('refuses a bad name, a relative path and an unknown access level', () => {
    expect(parseManifest({ ...minimal, name: 'Alice Tool' }).ok).toBe(false);
    expect(parseManifest({ ...minimal, health: 'health' }).ok).toBe(false);
    const r = parseManifest({
      ...minimal,
      github: { auth: ['app'], app: { permissions: { contents: 'owner' } } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('github.app.permissions.contents');
  });

  test('auth modes need their section', () => {
    const r = parseManifest({ ...minimal, github: { auth: ['app', 'pat'], pat: {} } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('github.app');
  });

  test('env names must look like variables', () => {
    expect(parseManifest({ ...minimal, env: { github_token: 'github-token' } }).ok).toBe(false);
  });

  test('member status answers parse, with defaults for absent parts', () => {
    const s = MemberStatus.parse({
      contract: 1,
      version: '0.3.0',
      github: { mode: 'app', source: 'octoforge', app_id: 42 },
      database: { engine: 'postgres', schema: 'alice-tool', source: 'octoforge' },
    });
    expect(s.github?.source).toBe('octoforge');
    expect(MemberStatus.parse({ contract: 1 }).github).toBeNull();
  });
});
