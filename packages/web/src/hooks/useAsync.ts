import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';

export interface AsyncState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (updater: T | null | ((prev: T | null) => T | null)) => void;
}

/** Minimal fetch hook: runs `fn` when `key` changes, exposes reload and local mutation. */
export function useAsync<T>(
  fn: () => Promise<T>,
  key: string,
  opts: { enabled?: boolean } = {},
): AsyncState<T> {
  const enabled = opts.enabled ?? true;
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const run = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const result = await fnRef.current();
      if (id !== seq.current) return;
      setDataState(result);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof ApiError ? e : new ApiError((e as Error).message, 'system', 0));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the refetch trigger by design.
  useEffect(() => {
    if (!enabled) return;
    void run();
  }, [run, key, enabled]);

  const setData = useCallback((updater: T | null | ((prev: T | null) => T | null)) => {
    setDataState((prev) =>
      typeof updater === 'function' ? (updater as (p: T | null) => T | null)(prev) : updater,
    );
  }, []);

  return { data, error, loading, reload: run, setData };
}

/** Re-runs `fn` every `ms` while mounted (and once immediately); pauses when the tab is hidden. */
export function useInterval(fn: () => void, ms: number | null): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const tick = () => {
      if (document.visibilityState === 'visible') ref.current();
    };
    const id = window.setInterval(tick, ms);
    return () => window.clearInterval(id);
  }, [ms]);
}
