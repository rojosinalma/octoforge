import { describe, expect, test } from 'bun:test';
import {
  type AppSpec,
  appPermissionsUrl,
  buildSharedAppManifest,
  installationSettingsUrl,
  looksLikePem,
  MemberStatus,
  missingPermissions,
  normalisePem,
  permissionMatrix,
  unionAppSpecs,
} from '../src';

const spec = (s: Partial<AppSpec>): AppSpec => ({ permissions: {}, events: [], ...s });

describe('unionAppSpecs', () => {
  test('highest level wins, events merge, one member names the webhook', () => {
    const u = unionAppSpecs([
      {
        name: 'alice-tool',
        app: spec({
          permissions: { actions: 'write', contents: 'read', metadata: 'read' },
          events: ['workflow_job'],
          webhook_path: '/webhooks/github',
        }),
      },
      {
        name: 'bob-tool',
        app: spec({ permissions: { contents: 'write', issues: 'write', actions: 'read', metadata: 'read' } }),
      },
    ]);
    expect(u).toEqual({
      permissions: { actions: 'write', contents: 'write', issues: 'write', metadata: 'read' },
      events: ['workflow_job'],
      webhook: { member: 'alice-tool', path: '/webhooks/github' },
      error: null,
    });
  });

  test('two webhook paths: an error that names both members', () => {
    const u = unionAppSpecs([
      { name: 'alice-tool', app: spec({ webhook_path: '/a' }) },
      { name: 'bob-tool', app: spec({ webhook_path: '/b' }) },
    ]);
    expect(u.error).toBe('one App has one webhook URL, but alice-tool, bob-tool each name a webhook_path');
    expect(u.webhook).toBeNull();
    expect(() =>
      buildSharedAppManifest({ union: u, name: 'Octoforge', homepage: 'h', callbackUrl: 'c' }),
    ).toThrow('one App has one webhook URL');
  });

  test('events without any webhook path are refused', () => {
    const u = unionAppSpecs([{ name: 'alice-tool', app: spec({ events: ['push'] }) }]);
    expect(u.error).toContain('no member names a webhook_path');
  });
});

describe('buildSharedAppManifest', () => {
  const union = unionAppSpecs([
    {
      name: 'alice-tool',
      app: spec({ permissions: { actions: 'write' }, events: ['workflow_job'], webhook_path: '/hook' }),
    },
    { name: 'bob-tool', app: spec({ permissions: { issues: 'write' } }) },
  ]);
  const base = {
    union,
    name: 'Octoforge',
    homepage: 'https://forge.example.com',
    callbackUrl: 'https://forge.example.com/github/callback',
    setupUrl: 'https://forge.example.com/github-app',
  };

  test('union permissions, events and the hook on the webhook member', () => {
    expect(buildSharedAppManifest({ ...base, hookBaseUrl: 'https://tool.example.com/' })).toEqual({
      name: 'Octoforge',
      url: 'https://forge.example.com',
      public: false,
      default_permissions: { actions: 'write', issues: 'write' },
      default_events: ['workflow_job'],
      hook_attributes: { url: 'https://tool.example.com/hook', active: true },
      redirect_url: 'https://forge.example.com/github/callback',
      setup_url: 'https://forge.example.com/github-app',
      setup_on_update: false,
      request_oauth_on_install: false,
    });
  });

  test('the webhook member needs an instance', () => {
    expect(() => buildSharedAppManifest(base)).toThrow('pick an instance of alice-tool');
  });
});

describe('permissionMatrix', () => {
  const app = { actions: 'write', contents: 'write', metadata: 'read' };
  const m = permissionMatrix({
    app,
    installations: [
      { id: 1, account: 'alice', permissions: { actions: 'write', contents: 'read', metadata: 'read' } },
    ],
    members: [
      { name: 'alice-tool', permissions: { actions: 'write', metadata: 'read' } },
      { name: 'bob-tool', permissions: { contents: 'write', issues: 'write', statuses: 'read' } },
    ],
  });

  test('gaps per App, installation and member', () => {
    expect(m.appMissing).toEqual(['issues:write', 'statuses:read']);
    expect(m.installationMissing).toEqual({ 1: ['contents:write', 'issues:write', 'statuses:read'] });
    expect(m.memberMissing).toEqual({ 'alice-tool': [], 'bob-tool': ['issues:write', 'statuses:read'] });
    expect(m.rows.map((r) => r.permission)).toEqual([
      'actions',
      'contents',
      'issues',
      'metadata',
      'statuses',
    ]);
    const issues = m.rows.find((r) => r.permission === 'issues');
    expect(issues).toEqual({
      permission: 'issues',
      needed: 'write',
      app: { level: null, gap: true },
      installations: [{ level: null, gap: true }],
      members: [
        { level: null, gap: false },
        { level: 'write', gap: true },
      ],
    });
    expect(m.rows.find((r) => r.permission === 'actions')?.app.gap).toBe(false);
  });

  test('read does not cover write; write covers read', () => {
    expect(missingPermissions({ contents: 'read' }, { contents: 'write' })).toEqual(['contents:write']);
    expect(missingPermissions({ contents: 'write' }, { contents: 'read' })).toEqual([]);
    expect(missingPermissions({ contents: 'admin' }, { contents: 'write' })).toEqual([]);
  });

  test('no App known: no App gaps, still the needs', () => {
    const n = permissionMatrix({
      app: null,
      installations: [],
      members: [{ name: 'a', permissions: { x: 'read' } }],
    });
    expect(n.appMissing).toEqual([]);
    expect(n.rows[0]?.app).toEqual({ level: null, gap: false });
  });
});

describe('GitHub settings URLs', () => {
  test('App permissions page: user and organisation owner', () => {
    expect(appPermissionsUrl('acme-app', 'alice', 'User')).toBe(
      'https://github.com/settings/apps/acme-app/permissions',
    );
    expect(appPermissionsUrl('acme-app', 'acme', 'Organization')).toBe(
      'https://github.com/organizations/acme/settings/apps/acme-app/permissions',
    );
    expect(() => appPermissionsUrl('../x', 'alice', 'User')).toThrow();
  });

  test('installation page: user and organisation account', () => {
    expect(installationSettingsUrl(12, 'alice', 'User')).toBe('https://github.com/settings/installations/12');
    expect(installationSettingsUrl(34, 'acme', 'Organization')).toBe(
      'https://github.com/organizations/acme/settings/installations/34',
    );
    expect(() => installationSettingsUrl(34, 'a/b', 'Organization')).toThrow();
  });
});

describe('pasted keys', () => {
  test('literal \\n becomes a line break', () => {
    const pem = normalisePem(
      '  -----BEGIN RSA PRIVATE KEY-----\\nAAAA\\nBBBB\\n-----END RSA PRIVATE KEY-----\\n ',
    );
    expect(pem).toBe('-----BEGIN RSA PRIVATE KEY-----\nAAAA\nBBBB\n-----END RSA PRIVATE KEY-----');
    expect(looksLikePem(pem)).toBe(true);
    expect(looksLikePem('not a key')).toBe(false);
  });
});

describe('MemberStatus optional GitHub fields', () => {
  const base = { contract: 1, version: '1.0.0' };
  test('kept when well-formed', () => {
    const s = MemberStatus.parse({
      ...base,
      github: {
        mode: 'app',
        source: 'octoforge',
        app_id: 7,
        missing: ['issues:write', 'statuses:read'],
        permissions_url: 'https://github.com/settings/apps/acme-app/permissions',
        install_url: 'https://github.com/apps/acme-app/installations/new',
      },
    });
    expect(s.github?.missing).toEqual(['issues:write', 'statuses:read']);
    expect(s.github?.permissions_url).toBe('https://github.com/settings/apps/acme-app/permissions');
    expect(s.github?.install_url).toBe('https://github.com/apps/acme-app/installations/new');
  });

  test('malformed values are ignored, the status still parses', () => {
    const s = MemberStatus.parse({
      ...base,
      github: {
        mode: 'app',
        source: 'env',
        missing: ['issues', 42],
        permissions_url: 'javascript:alert(1)',
        install_url: 'http://plain.example.com',
      },
    });
    expect(s.github?.mode).toBe('app');
    expect(s.github?.missing).toBeUndefined();
    expect(s.github?.permissions_url).toBeUndefined();
    expect(s.github?.install_url).toBeUndefined();
  });

  test('absent fields stay absent', () => {
    const s = MemberStatus.parse({ ...base, github: { mode: 'pat', source: 'env' } });
    expect(s.github?.missing).toBeUndefined();
  });
});
