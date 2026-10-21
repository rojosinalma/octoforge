export type Level = 'debug' | 'info' | 'warn' | 'error';
export type Fields = Record<string, unknown>;
export type Logger = Record<Level, (message: string, fields?: Fields) => void>;

const ORDER: Record<Level | 'silent', number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
let threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? ORDER.info;

/** Set the level at boot (from LOG_LEVEL); tests use `silent`. */
export function configureLog(level: string): void {
  threshold = ORDER[level as Level] ?? ORDER.info;
}

/** Field names whose value never reaches a log line, whatever a caller passes. */
const SECRET_KEY = /token|password|secret|pem|private|authorization|cookie|credential/i;

function render(fields: Fields | undefined): string {
  if (!fields) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (SECRET_KEY.test(k)) {
      parts.push(`${k}=[redacted]`);
      continue;
    }
    const s = typeof v === 'string' ? v : v instanceof Error ? v.message : JSON.stringify(v);
    parts.push(`${k}=${/[\s"=]/.test(s) ? JSON.stringify(s) : s}`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/** Stdout logger with a `[subsystem]` prefix: `<time> INFO  [github] message key=value`. */
export function log(subsystem: string): Logger {
  const write = (level: Level, message: string, fields?: Fields) => {
    if (ORDER[level] < threshold) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${subsystem}] ${message}${render(fields)}\n`;
    if (level === 'error' || level === 'warn') process.stderr.write(line);
    else process.stdout.write(line);
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
