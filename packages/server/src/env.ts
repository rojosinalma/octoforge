import path from 'node:path';
import { z } from 'zod';

/**
 * Bootstrap values and secrets only; every tunable lives in the settings table.
 * Bun loads `.env` from the working directory before this runs.
 */
const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().default('./data'),
  DATABASE_URL: z
    .string()
    .regex(/^(sqlite:|postgres(ql)?:\/\/)/, 'must start with sqlite: or postgres://')
    .optional(),
  AUTH: z.enum(['none']).optional(),
  AUTH_PASSWORD: z.string().optional(),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  OCTOFORGE_TOKEN: z.string().min(32, 'must be at least 32 characters (openssl rand -hex 32)').optional(),
  PUBLIC_URL: z
    .string()
    .url()
    .regex(/^https?:\/\//, 'must be an http(s) URL')
    .optional(),
  FORGE_PG_ADMIN_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL')
    .optional(),
  OCTOFORGE_SHARED_DATA: z.string().startsWith('/', 'must be an absolute path').optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  WEB_DIST: z.string().optional(),
  MEMBERS_FILE: z.string().optional(),
});

export type AuthMode = 'password' | 'none';

export type Env = Omit<z.infer<typeof EnvSchema>, 'DATABASE_URL'> & {
  DATABASE_URL: string;
  auth: AuthMode;
  webDist: string;
  membersFile: string;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const empty = (v: string | undefined) => (v === undefined || v === '' ? undefined : v);

/**
 * Fail closed: a password is required unless `AUTH=none` says on purpose that something in front
 * (a reverse proxy with its own login) does the job.
 */
export function resolveAuth(password: string | undefined, auth: string | undefined): AuthMode {
  if (password && auth === 'none') {
    throw new ConfigError('AUTH=none and AUTH_PASSWORD are both set: keep one');
  }
  if (password) return 'password';
  if (auth === 'none') return 'none';
  throw new ConfigError(
    'AUTH_PASSWORD is not set: set it to require a login, or set AUTH=none when a proxy in front authenticates',
  );
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const raw = Object.fromEntries(Object.keys(EnvSchema.shape).map((k) => [k, empty(source[k])]));
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') || 'invalid environment',
    );
  }
  const e = parsed.data;
  const auth = resolveAuth(e.AUTH_PASSWORD, e.AUTH);
  const dataDir = path.resolve(e.DATA_DIR);
  const root = path.resolve(import.meta.dir, '../../..');
  return {
    ...e,
    DATA_DIR: dataDir,
    DATABASE_URL: e.DATABASE_URL ?? `sqlite:${path.join(dataDir, 'octoforge.db')}`,
    PUBLIC_URL: e.PUBLIC_URL?.replace(/\/+$/, ''),
    OCTOFORGE_SHARED_DATA: e.OCTOFORGE_SHARED_DATA?.replace(/\/+$/, ''),
    auth,
    webDist: path.resolve(e.WEB_DIST ?? path.join(root, 'packages/web/dist')),
    membersFile: path.resolve(e.MEMBERS_FILE ?? path.join(root, 'members.json')),
  };
}
