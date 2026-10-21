import { describe, expect, test } from 'bun:test';
import {
  appCreateUrl,
  appInstallUrl,
  buildAppManifest,
  buildEnvBlock,
  classicTokenUrl,
  fineGrainedTokenUrl,
  missingScopes,
  parseScopes,
  resolvePublicUrl,
  tokenType,
} from '../src';

const manifest = {
  name: 'alice-tool',
  title: 'Alice tool',
  description: 'Does things.',
  github: {
    app: {
      permissions: { actions: 'write', metadata: 'read' } as const,
      events: ['workflow_job'],
      webhook_path: '/webhooks/github',
      setup_path: '/',
    },
  },
};

describe('buildAppManifest', () => {
  const input = {
    manifest,
    name: 'Alice tool',
    homepage: 'https://github.com/alice/alice-tool',
    publicUrl: 'https://tool.example.com/',
    callbackUrl: 'https://forge.example.com/github/callback',
  };

  test('adds name, URLs and hook to the member spec', () => {
    const m = buildAppManifest(input);
    expect(m).toEqual({
      name: 'Alice tool',
      url: 'https://github.com/alice/alice-tool',
      description: 'Does things.',
      public: false,
      default_permissions: { actions: 'write', metadata: 'read' },
      default_events: ['workflow_job'],
      hook_attributes: { url: 'https://tool.example.com/webhooks/github', active: true },
      redirect_url: 'https://forge.example.com/github/callback',
      setup_url: 'https://tool.example.com/',
      setup_on_update: false,
      request_oauth_on_install: false,
    });
  });

  test('no webhook path: no hook and no events', () => {
    const m = buildAppManifest({
      ...input,
      manifest: { ...manifest, github: { app: { permissions: { metadata: 'read' }, events: [] } } },
    });
    expect(m.hook_attributes).toBeUndefined();
    expect(m.default_events).toEqual([]);
    expect(m.setup_url).toBeUndefined();
  });

  test('refuses events without a webhook path, a long name and a member without an App', () => {
    expect(() =>
      buildAppManifest({
        ...input,
        manifest: { ...manifest, github: { app: { permissions: {}, events: ['push'] } } },
      }),
    ).toThrow('webhook_path');
    expect(() => buildAppManifest({ ...input, name: 'x'.repeat(35) })).toThrow('34');
    expect(() => buildAppManifest({ ...input, manifest: { ...manifest, github: {} } })).toThrow(
      'does not support',
    );
  });

  test('webhook and setup page use the public URL, not the base URL', () => {
    const m = buildAppManifest({ ...input, publicUrl: 'https://alice-tool.example.com' });
    expect(m.hook_attributes?.url).toBe('https://alice-tool.example.com/webhooks/github');
    expect(m.setup_url).toBe('https://alice-tool.example.com/');
  });

  test('form targets for a personal account and an organisation', () => {
    expect(appCreateUrl('s1')).toBe('https://github.com/settings/apps/new?state=s1');
    expect(appCreateUrl('s1', 'my-org')).toBe(
      'https://github.com/organizations/my-org/settings/apps/new?state=s1',
    );
    expect(() => appCreateUrl('s1', '../evil')).toThrow();
    expect(appInstallUrl('https://github.com/apps/alice-tool/')).toBe(
      'https://github.com/apps/alice-tool/installations/new',
    );
  });
});

describe('token URLs', () => {
  test('classic: scopes and description', () => {
    expect(classicTokenUrl({ classic_scopes: ['repo', 'read:org'] }, 'Alice tool via Octoforge')).toBe(
      'https://github.com/settings/tokens/new?scopes=repo,read%3Aorg&description=Alice%20tool%20via%20Octoforge',
    );
  });

  test('fine-grained: name, description, expiry, owner and one param per permission', () => {
    const url = new URL(
      fineGrainedTokenUrl({
        pat: { fine_grained: { issues: 'read', pull_requests: 'write' } },
        name: 'Alice tool',
        description: 'via Octoforge',
        expiresInDays: 90,
        targetName: 'my-org',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://github.com/settings/personal-access-tokens/new');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      name: 'Alice tool',
      description: 'via Octoforge',
      target_name: 'my-org',
      expires_in: '90',
      issues: 'read',
      pull_requests: 'write',
    });
  });

  test('fine-grained: 0 days = no expiry, names cut at 40, bad owner refused', () => {
    const url = new URL(
      fineGrainedTokenUrl({
        pat: { fine_grained: {} },
        name: 'n'.repeat(50),
        description: '',
        expiresInDays: 0,
      }),
    );
    expect(url.searchParams.get('expires_in')).toBe('none');
    expect(url.searchParams.get('name')).toHaveLength(40);
    expect(url.searchParams.has('target_name')).toBe(false);
    expect(() =>
      fineGrainedTokenUrl({
        pat: { fine_grained: {} },
        name: 'x',
        description: '',
        expiresInDays: 1,
        targetName: 'a b',
      }),
    ).toThrow();
  });

  test('scope checks follow GitHub hierarchy', () => {
    expect(parseScopes('repo, workflow ,read:org')).toEqual(['repo', 'workflow', 'read:org']);
    expect(parseScopes(null)).toEqual([]);
    expect(missingScopes(['repo', 'workflow'], ['repo'])).toEqual(['workflow']);
    expect(missingScopes(['public_repo', 'read:org'], ['repo', 'admin:org'])).toEqual([]);
    expect(tokenType('github_pat_abc')).toBe('fine_grained');
    expect(tokenType('ghp_abc')).toBe('classic');
    expect(tokenType('gho_abc')).toBe('other');
  });
});

describe('buildEnvBlock', () => {
  test('uses the manifest names and quotes multi-line values', () => {
    const block = buildEnvBlock(
      { name: 'alice-tool', env: { app_id: 'GITHUB_APP_ID', app_private_key: 'GITHUB_APP_PRIVATE_KEY' } },
      {
        app_id: '42',
        app_private_key: '-----BEGIN KEY-----\nabc\n-----END KEY-----\n',
        app_webhook_secret: 'w',
      },
    );
    expect(block).toBe(
      [
        '# alice-tool: paste into its .env and restart it',
        'GITHUB_APP_ID=42',
        'GITHUB_APP_PRIVATE_KEY="-----BEGIN KEY-----\\nabc\\n-----END KEY-----\\n"',
        '# app_webhook_secret: the manifest names no variable for this value',
        '',
      ].join('\n'),
    );
  });
});

describe('resolvePublicUrl', () => {
  const inst = { baseUrl: 'http://alice-tool:8080', publicUrl: null };

  test('the instance setting wins over the member report and the base URL', () => {
    expect(
      resolvePublicUrl({ ...inst, publicUrl: 'https://alice.example.com/' }, 'https://other.example.com'),
    ).toEqual({ url: 'https://alice.example.com', source: 'instance' });
  });

  test('without a setting, the URL the member reports', () => {
    expect(resolvePublicUrl(inst, 'https://reported.example.com/')).toEqual({
      url: 'https://reported.example.com',
      source: 'member',
    });
  });

  test('without either, the base URL', () => {
    expect(resolvePublicUrl(inst)).toEqual({ url: 'http://alice-tool:8080', source: 'base' });
    expect(resolvePublicUrl(inst, null)).toEqual({ url: 'http://alice-tool:8080', source: 'base' });
  });
});
