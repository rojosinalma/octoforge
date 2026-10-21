import type { Capabilities, Settings, SettingsPatch } from '@octoforge/shared';
import { DEFAULT_SETTINGS } from '@octoforge/shared';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { type ApiError, api } from '../api';
import { useToast } from './useToast';

export interface AppState {
  settings: Settings;
  settingsLoaded: boolean;
  /** Optimistic patch; reverts and toasts on failure. Resolves true on success. */
  updateSettings: (patch: SettingsPatch, opts?: { silent?: boolean }) => Promise<boolean>;
  capabilities: Capabilities | null;
  authRequired: boolean;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({
  authRequired,
  onLoggedOut,
  children,
}: {
  authRequired: boolean;
  onLoggedOut: () => void;
  children: ReactNode;
}) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .settings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setSettingsLoaded(true);
      })
      .catch((e: ApiError) => {
        if (!cancelled) toast('Could not load settings', { description: e.message, variant: 'critical' });
      });
    api
      .capabilities()
      .then((c) => !cancelled && setCapabilities(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const updateSettings = useCallback<AppState['updateSettings']>(
    async (patch, opts = {}) => {
      let previous: Settings = DEFAULT_SETTINGS;
      setSettings((s) => {
        previous = s;
        return { ...s, ...patch };
      });
      try {
        const r = await api.patchSettings(patch);
        setSettings(r.settings);
        if (!opts.silent) toast('Settings saved');
        return true;
      } catch (e) {
        setSettings(previous);
        toast('Settings not saved', { description: (e as Error).message, variant: 'critical' });
        return false;
      }
    },
    [toast],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      onLoggedOut();
    }
  }, [onLoggedOut]);

  const value = useMemo<AppState>(
    () => ({ settings, settingsLoaded, updateSettings, capabilities, authRequired, logout }),
    [settings, settingsLoaded, updateSettings, capabilities, authRequired, logout],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside AppProvider');
  return ctx;
}
