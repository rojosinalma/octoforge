import { useCallback, useMemo } from 'react';
import { useToasts } from 'tailor-react';

export type ToastVariant = 'success' | 'info' | 'warning' | 'critical';

const TONE = { success: 'success', info: 'info', warning: 'warning', critical: 'danger' } as const;

interface ToastApi {
  toast: (title: string, opts?: { description?: string; variant?: ToastVariant; ttlMs?: number }) => void;
}

/** One outcome toast: a bold title and, when given, the reason under it. Wraps tailor-react's toasts. */
export function useToast(): ToastApi {
  const { toast: show } = useToasts();
  const toast = useCallback<ToastApi['toast']>(
    (title, opts = {}) => {
      const message = opts.description ? (
        <>
          <strong>{title}</strong>
          <br />
          {opts.description}
        </>
      ) : (
        title
      );
      show(TONE[opts.variant ?? 'success'], message, opts.ttlMs ? { timeout: opts.ttlMs } : undefined);
    },
    [show],
  );
  return useMemo(() => ({ toast }), [toast]);
}
