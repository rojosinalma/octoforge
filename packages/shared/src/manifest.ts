import { z } from 'zod';

/** Contract versions this build of Octoforge understands (docs/members.md). */
export const SUPPORTED_CONTRACTS = [1] as const;

/** Lower-case repository-style name; also used as container, image, role and schema name. */
export const MemberName = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,62}$/, 'lower-case letters, digits and dashes, starting with a letter');
export type MemberName = z.infer<typeof MemberName>;

/** A path on a running instance (`/health`, `/favicon.svg`). */
const InstancePath = z.string().startsWith('/', 'must start with /');

export const AccessLevel = z.enum(['read', 'write', 'admin']);
export type AccessLevel = z.infer<typeof AccessLevel>;

const Permissions = z.record(z.string().regex(/^[a-z_]+$/), AccessLevel);

export const AppSpec = z.object({
  permissions: Permissions.default({}),
  events: z.array(z.string().regex(/^[a-z_]+$/)).default([]),
  webhook_path: InstancePath.optional(),
  setup_path: InstancePath.optional(),
});
export type AppSpec = z.infer<typeof AppSpec>;

export const PatSpec = z.object({
  classic_scopes: z.array(z.string().min(1)).default([]),
  fine_grained: Permissions.default({}),
  user_identity: z.boolean().default(false),
});
export type PatSpec = z.infer<typeof PatSpec>;

export const AuthMode = z.enum(['app', 'pat']);
export type AuthMode = z.infer<typeof AuthMode>;

export const Engine = z.enum(['sqlite', 'postgres']);
export type Engine = z.infer<typeof Engine>;

/** Keys of `env`: what each variable carries. Unknown keys are kept, Octoforge ignores them. */
export const ENV_KEYS = [
  'github_token',
  'app_id',
  'app_private_key',
  'app_installation_id',
  'app_webhook_secret',
  'database_url',
  'database_schema',
] as const;
export type EnvKey = (typeof ENV_KEYS)[number];

const EnvName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/, 'an environment variable name');

export const Manifest = z
  .object({
    contract: z.number().int(),
    name: MemberName,
    title: z.string().min(1).max(80),
    description: z.string().max(400).default(''),
    icon: InstancePath.optional(),
    health: InstancePath.default('/health'),
    github: z
      .object({
        auth: z.array(AuthMode).min(1),
        app: AppSpec.optional(),
        pat: PatSpec.optional(),
      })
      .optional(),
    database: z
      .object({
        engines: z.array(Engine).min(1),
        schema: z.boolean().default(false),
      })
      .optional(),
    env: z.record(z.string(), EnvName).default({}),
  })
  .superRefine((m, ctx) => {
    if (!(SUPPORTED_CONTRACTS as readonly number[]).includes(m.contract)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contract'],
        message: `contract ${m.contract} is not supported (known: ${SUPPORTED_CONTRACTS.join(', ')})`,
      });
    }
    if (m.github?.auth.includes('app') && !m.github.app) {
      ctx.addIssue({
        code: 'custom',
        path: ['github', 'app'],
        message: 'auth lists "app" but app is missing',
      });
    }
    if (m.github?.auth.includes('pat') && !m.github.pat) {
      ctx.addIssue({
        code: 'custom',
        path: ['github', 'pat'],
        message: 'auth lists "pat" but pat is missing',
      });
    }
  });
export type Manifest = z.infer<typeof Manifest>;

export type ManifestParse = { ok: true; manifest: Manifest } | { ok: false; error: string };

/** Parses a member manifest; the error is one readable line naming each bad field. */
export function parseManifest(input: unknown): ManifestParse {
  const r = Manifest.safeParse(input);
  if (r.success) return { ok: true, manifest: r.data };
  return {
    ok: false,
    error: r.error.issues.map((i) => `${i.path.join('.') || 'manifest'}: ${i.message}`).join('; '),
  };
}

/** `GET /api/octoforge/status` answer of a member (credentials never appear in it). */
export const Source = z.enum(['env', 'octoforge', 'none']);
export const MemberStatus = z.object({
  contract: z.number().int(),
  version: z.string().default(''),
  github: z
    .object({
      mode: z.string().nullable().default(null),
      source: Source.default('none'),
      app_id: z.union([z.number(), z.string()]).nullable().optional(),
      login: z.string().nullable().optional(),
    })
    .nullable()
    .default(null),
  database: z
    .object({
      engine: z.string(),
      schema: z.string().nullable().optional(),
      source: Source.default('env'),
    })
    .nullable()
    .default(null),
});
export type MemberStatus = z.infer<typeof MemberStatus>;
