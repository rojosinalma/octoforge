import { describe, expect, test } from 'bun:test';
import { SecretStore, StoreFullError } from '../src/lib/secrets';

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('SecretStore', () => {
  test('holds a secret until its TTL, then forgets it', () => {
    const c = clock();
    const s = new SecretStore(c.now);
    const e = s.put({
      kind: 'pat',
      member: 'alice-tool',
      secret: { token: 't' },
      meta: {},
      ttlMs: 1000,
      max: 5,
    });
    expect(s.get(e.id)?.secret).toEqual({ token: 't' });
    c.advance(999);
    expect(s.get(e.id)).not.toBeNull();
    c.advance(1);
    expect(s.get(e.id)).toBeNull();
    expect(s.size).toBe(0);
  });

  test('caps the number of entries; expired ones free their slot', () => {
    const c = clock();
    const s = new SecretStore(c.now);
    s.put({ kind: 'pat', member: 'a', secret: 1, meta: {}, ttlMs: 1000, max: 2 });
    s.put({ kind: 'pat', member: 'a', secret: 2, meta: {}, ttlMs: 5000, max: 2 });
    expect(() => s.put({ kind: 'pat', member: 'a', secret: 3, meta: {}, ttlMs: 1000, max: 2 })).toThrow(
      StoreFullError,
    );
    c.advance(1000);
    expect(() => s.put({ kind: 'pat', member: 'a', secret: 3, meta: {}, ttlMs: 1000, max: 2 })).not.toThrow();
  });

  test('take is one use; kinds do not mix; list never carries the secret', () => {
    const s = new SecretStore();
    const e = s.put({
      kind: 'app',
      member: 'a',
      secret: { pem: 'k' },
      meta: { slug: 'x' },
      ttlMs: 1000,
      max: 5,
    });
    expect(s.get(e.id, 'pat')).toBeNull();
    const listed = s.list({ kinds: ['app'] });
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('secret');
    expect(JSON.stringify(listed)).not.toContain('"k"');
    expect(s.take(e.id, 'app')?.secret).toEqual({ pem: 'k' });
    expect(s.take(e.id, 'app')).toBeNull();
  });

  test('clear and delete drop entries; ids are random unless given', () => {
    const s = new SecretStore();
    const a = s.put({ kind: 'pat', member: 'a', secret: 1, meta: {}, ttlMs: 1000, max: 5 });
    const b = s.put({ kind: 'state', member: 'a', secret: null, meta: {}, ttlMs: 1000, max: 5, id: 'fixed' });
    expect(a.id).toMatch(/^[0-9a-f]{32}$/);
    expect(b.id).toBe('fixed');
    expect(s.delete(a.id)).toBe(true);
    s.clear();
    expect(s.size).toBe(0);
  });
});
