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
  /** Optimistic patch without toasts (settings rows show their own); reverts on failure. */
  saveSettings: (patch: SettingsPatch) => Promise<{ ok: boolean; message: string }>;
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

  const saveSettings = useCallback<AppState['saveSettings']>(async (patch) => {
    let previous: Settings = DEFAULT_SETTINGS;
    setSettings((s) => {
      previous = s;
      return { ...s, ...patch };
    });
    try {
      const r = await api.patchSettings(patch);
      setSettings(r.settings);
      return { ok: true, message: 'Saved' };
    } catch (e) {
      setSettings(previous);
      return { ok: false, message: (e as Error).message || 'Save failed' };
    }
  }, []);

  const updateSettings = useCallback<AppState['updateSettings']>(
    async (patch, opts = {}) => {
      const r = await saveSettings(patch);
      if (r.ok && !opts.silent) toast('Settings saved');
      if (!r.ok) toast('Settings not saved', { description: r.message, variant: 'critical' });
      return r.ok;
    },
    [saveSettings, toast],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      onLoggedOut();
    }
  }, [onLoggedOut]);

  const value = useMemo<AppState>(
    () => ({ settings, settingsLoaded, updateSettings, saveSettings, capabilities, authRequired, logout }),
    [settings, settingsLoaded, updateSettings, saveSettings, capabilities, authRequired, logout],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside AppProvider');
  return ctx;
}
