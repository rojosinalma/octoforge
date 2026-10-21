import type { EnvKey, Manifest } from './manifest';

export type EnvValues = Partial<Record<EnvKey, string>>;

/** One `.env` value: bare when safe, else double-quoted with `\n` for line breaks (dotenv style). */
export function envValue(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]*$/.test(value)) return value;
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
  return `"${escaped}"`;
}

/**
 * The copyable `.env` block for a member, built from the variable names in its manifest. Values the
 * manifest names no variable for are listed as comments, so nothing is silently dropped.
 */
export function buildEnvBlock(manifest: Pick<Manifest, 'name' | 'env'>, values: EnvValues): string {
  const lines = [`# ${manifest.name}: paste into its .env and restart it`];
  for (const [key, value] of Object.entries(values) as [EnvKey, string | undefined][]) {
    if (value === undefined || value === '') continue;
    const name = manifest.env[key];
    if (name) lines.push(`${name}=${envValue(value)}`);
    else lines.push(`# ${key}: the manifest names no variable for this value`);
  }
  return `${lines.join('\n')}\n`;
}
