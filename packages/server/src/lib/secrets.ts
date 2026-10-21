import { randomBytes } from 'node:crypto';

/**
 * In-memory holding area for secrets between creation and delivery: a GitHub App's key and webhook
 * secret, a pasted token, a generated role password, the `state` of a manifest flow. Nothing here is ever written to disk, logged
 * or returned by the API; entries expire after their TTL and `take` removes them on delivery.
 */
/** `shared`: the key of the one GitHub App every member uses. */
export type SecretKind = 'app' | 'pat' | 'state' | 'db' | 'shared';

export interface SecretEntry<T = unknown, M = Record<string, unknown>> {
  id: string;
  kind: SecretKind;
  member: string;
  createdAt: number;
  expiresAt: number;
  /** Non-secret facts shown in the UI (App slug, token login, …). */
  meta: M;
  secret: T;
}

export class StoreFullError extends Error {
  constructor(max: number) {
    super(`${max} credentials are already waiting in memory: deliver or discard one first`);
    this.name = 'StoreFullError';
  }
}

export interface PutInput<T, M> {
  kind: SecretKind;
  member: string;
  secret: T;
  meta: M;
  ttlMs: number;
  max: number;
  /** Explicit id (the manifest `state`); random otherwise. */
  id?: string;
}

export class SecretStore {
  private readonly entries = new Map<string, SecretEntry>();
  constructor(private readonly now: () => number = Date.now) {}

  get size(): number {
    this.purge();
    return this.entries.size;
  }

  put<T, M extends Record<string, unknown>>(input: PutInput<T, M>): SecretEntry<T, M> {
    this.purge();
    if (this.entries.size >= input.max) throw new StoreFullError(input.max);
    const now = this.now();
    const entry: SecretEntry<T, M> = {
      id: input.id ?? randomBytes(16).toString('hex'),
      kind: input.kind,
      member: input.member,
      createdAt: now,
      expiresAt: now + input.ttlMs,
      meta: input.meta,
      secret: input.secret,
    };
    this.entries.set(entry.id, entry as SecretEntry);
    return entry;
  }

  /** The live entry, or null when unknown, expired or of another kind. */
  get<T = unknown, M = Record<string, unknown>>(id: string, kind?: SecretKind): SecretEntry<T, M> | null {
    const e = this.entries.get(id);
    if (!e) return null;
    if (e.expiresAt <= this.now()) {
      this.entries.delete(id);
      return null;
    }
    if (kind && e.kind !== kind) return null;
    return e as SecretEntry<T, M>;
  }

  /** Returns the entry and forgets it: one use only. */
  take<T = unknown, M = Record<string, unknown>>(id: string, kind?: SecretKind): SecretEntry<T, M> | null {
    const e = this.get<T, M>(id, kind);
    if (e) this.entries.delete(id);
    return e;
  }

  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  /** Entries without their secret, newest first. */
  list(filter: { member?: string; kinds?: SecretKind[] } = {}): Omit<SecretEntry, 'secret'>[] {
    this.purge();
    return [...this.entries.values()]
      .filter(
        (e) =>
          (!filter.member || e.member === filter.member) && (!filter.kinds || filter.kinds.includes(e.kind)),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ secret: _secret, ...rest }) => rest);
  }

  /** Drops expired entries; returns how many went. */
  purge(): number {
    const now = this.now();
    let n = 0;
    for (const [id, e] of this.entries) {
      if (e.expiresAt <= now) {
        this.entries.delete(id);
        n++;
      }
    }
    return n;
  }

  clear(): void {
    this.entries.clear();
  }
}
