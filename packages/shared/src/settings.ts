import { z } from 'zod';

export const Theme = z.enum([
  'auto',
  'light',
  'light_high_contrast',
  'light_colorblind',
  'dark',
  'dark_dimmed',
  'dark_high_contrast',
  'dark_colorblind',
]);
export type Theme = z.infer<typeof Theme>;

/** Every tunable lives here (settings table), read at use time; env holds bootstrap values and secrets only. */
export const Settings = z.object({
  /** Minutes a created credential or generated password stays in memory before it is dropped. */
  secretTtlMin: z.number().int().min(1).max(120).default(15),
  /** Pending credentials held in memory at once. */
  secretStoreMax: z.number().int().min(1).max(200).default(20),
  /** Timeout for every call to a member instance or to GitHub. */
  requestTimeoutMs: z.number().int().min(500).max(60_000).default(8000),
  /** Timeout for a database adoption call (the member copies its rows meanwhile). */
  adoptTimeoutSec: z.number().int().min(10).max(3600).default(300),
  /** How long a manifest read from GitHub is reused before it is fetched again. */
  manifestCacheMin: z.number().int().min(0).max(1440).default(10),
  /** Seconds between automatic refreshes of the index page. */
  indexRefreshSec: z.number().int().min(10).max(3600).default(30),
  /** Delivery and adoption log rows older than this are deleted. */
  logKeepDays: z.number().int().min(1).max(3650).default(180),
  /** Rows per page on the log page. */
  logPageSize: z.number().int().min(10).max(500).default(100),
  /** Days a fine-grained token lives; 0 = no expiry. Pre-filled on GitHub's form. */
  patExpiresDays: z.number().int().min(0).max(366).default(90),
  /** Host (and :port) members use to reach Postgres; empty = the host of FORGE_PG_ADMIN_URL. */
  pgMemberHost: z.string().max(253).default(''),
  /** Organisation offered as owner of new Apps and tokens next to the personal account; empty = none. */
  githubOrg: z
    .string()
    .regex(/^([A-Za-z0-9][A-Za-z0-9-]{0,38})?$/)
    .default(''),
  /** Minutes between two pushes of the sibling list to every instance (it is also sent on every instance change). */
  siblingsResendMin: z.number().int().min(5).max(1440).default(60),
  theme: Theme.default('auto'),
});
export type Settings = z.infer<typeof Settings>;

/**
 * Partial update. Built from the shape with defaults removed: zod 4's `.partial()` would still
 * fill every absent key with its default, turning a one-key PUT into a reset of everything else.
 */
export const SettingsPatch = z
  .object(
    Object.fromEntries(
      Object.entries(Settings.shape).map(([key, schema]) => [
        key,
        (schema as z.ZodDefault<z.ZodTypeAny>).removeDefault().optional(),
      ]),
    ) as { [K in keyof Settings]: z.ZodOptional<z.ZodType<Settings[K]>> },
  )
  .strict();
export type SettingsPatch = z.infer<typeof SettingsPatch>;
export const DEFAULT_SETTINGS: Settings = Settings.parse({});
