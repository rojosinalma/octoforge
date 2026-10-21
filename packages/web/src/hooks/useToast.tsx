import { Banner } from '@primer/react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type ToastVariant = 'success' | 'info' | 'warning' | 'critical';

export interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastApi {
  toast: (title: string, opts?: { description?: string; variant?: ToastVariant; ttlMs?: number }) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const MAX_TOASTS = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const toast = useCallback<ToastApi['toast']>(
    (title, opts = {}) => {
      const id = nextId.current++;
      const item: Toast = { id, title, description: opts.description, variant: opts.variant ?? 'success' };
      setToasts((all) => [...all, item].slice(-MAX_TOASTS));
      window.setTimeout(() => dismiss(id), opts.ttlMs ?? (item.variant === 'critical' ? 8000 : 4000));
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <Banner
            key={t.id}
            variant={t.variant}
            title={t.title}
            description={t.description}
            onDismiss={() => dismiss(t.id)}
            layout="compact"
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
