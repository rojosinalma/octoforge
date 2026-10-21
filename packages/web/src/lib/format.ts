const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return rtf.format(Math.round(diff), 'second');
  if (abs < 2700) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 79_200) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86_400), 'day');
}

export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** `https://alice.example.com:8443/` → `alice.example.com:8443`. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function sourceLabel(source: string | undefined | null): string {
  if (source === 'octoforge') return 'from Octoforge';
  if (source === 'env') return 'from .env';
  return 'not set';
}

/** Where the address GitHub uses came from (see resolvePublicUrl). */
export function publicUrlSourceLabel(source: 'instance' | 'member' | 'base'): string {
  if (source === 'instance') return 'instance setting';
  if (source === 'member') return 'reported by the member';
  return 'base URL';
}
