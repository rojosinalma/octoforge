// The UI look (tailor skin, palette, mode) is an app setting. The pre-paint snippet in index.html and
// tailor-react's theme store paint the cached choice first; ThemeSync then applies the server copy once and
// saves every later change the user makes with the pickers.
import type { SettingsPatch } from '@octoforge/shared';
import { useEffect, useRef } from 'react';
import { useTailorTheme } from 'tailor-react';
import { useApp } from './hooks/useApp';

export function ThemeSync() {
  const { settings, settingsLoaded, updateSettings } = useApp();
  const theme = useTailorTheme();
  const applied = useRef(false);

  useEffect(() => {
    if (!settingsLoaded || applied.current) return;
    applied.current = true;
    theme.set({ skin: settings.skin, palette: settings.palette, mode: settings.mode });
  }, [settingsLoaded, settings, theme]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on a user change of the theme only.
  useEffect(() => {
    if (!applied.current) return;
    const patch: SettingsPatch = {};
    if (theme.skin !== settings.skin) patch.skin = theme.skin;
    if (theme.palette !== settings.palette) patch.palette = theme.palette;
    if (theme.choice !== settings.mode) patch.mode = theme.choice;
    if (!Object.keys(patch).length) return;
    // Skin and palette change on the Settings page, where a save is confirmed; the footer toggle stays quiet.
    void updateSettings(patch, { silent: patch.skin === undefined && patch.palette === undefined });
  }, [theme.skin, theme.palette, theme.choice]);

  return null;
}
