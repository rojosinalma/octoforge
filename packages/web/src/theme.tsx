// Theme wiring for Primer React 38 + Primer Primitives 11. Each primitives CSS file is scoped to
// [data-color-mode][data-light-theme|data-dark-theme] attributes; the active theme is chosen by the
// attributes on <html> (so the page background follows) and by the ThemeProvider props.
import '@primer/primitives/dist/css/primitives.css';
import '@primer/primitives/dist/css/functional/themes/light.css';
import '@primer/primitives/dist/css/functional/themes/light-colorblind.css';
import '@primer/primitives/dist/css/functional/themes/light-high-contrast.css';
import '@primer/primitives/dist/css/functional/themes/dark.css';
import '@primer/primitives/dist/css/functional/themes/dark-dimmed.css';
import '@primer/primitives/dist/css/functional/themes/dark-colorblind.css';
import '@primer/primitives/dist/css/functional/themes/dark-high-contrast.css';

import { Theme } from '@octoforge/shared';
import { BaseStyles } from '@primer/react';
import { ThemeProvider, type ThemeProviderProps } from '@primer/react/next';
import { type ReactNode, useEffect } from 'react';

export const THEME_STORAGE_KEY = 'octoforge.theme';

export const THEME_LABELS: Record<Theme, string> = {
  auto: 'Sync with system',
  light: 'Light',
  light_high_contrast: 'Light high contrast',
  light_colorblind: 'Light colorblind',
  dark: 'Dark',
  dark_dimmed: 'Dark dimmed',
  dark_high_contrast: 'Dark high contrast',
  dark_colorblind: 'Dark colorblind',
};

export const THEMES: Theme[] = Theme.options;

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as string[]).includes(value);
}

export function themeProviderProps(
  theme: Theme,
): Pick<ThemeProviderProps, 'colorMode' | 'dayScheme' | 'nightScheme'> {
  if (theme === 'auto') return { colorMode: 'auto', dayScheme: 'light', nightScheme: 'dark' };
  if (theme.startsWith('dark')) return { colorMode: 'dark', dayScheme: 'light', nightScheme: theme };
  return { colorMode: 'light', dayScheme: theme, nightScheme: 'dark' };
}

export function applyThemeToDocument(theme: Theme): void {
  const props = themeProviderProps(theme);
  const html = document.documentElement;
  html.setAttribute('data-color-mode', props.colorMode ?? 'auto');
  html.setAttribute('data-light-theme', props.dayScheme ?? 'light');
  html.setAttribute('data-dark-theme', props.nightScheme ?? 'dark');
}

export function readCachedTheme(): Theme {
  try {
    const cached = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(cached) ? cached : 'auto';
  } catch {
    return 'auto';
  }
}

function cacheTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable; the server copy wins on the next load.
  }
}

export function ThemeRoot({ theme, children }: { theme: Theme; children: ReactNode }) {
  useEffect(() => {
    applyThemeToDocument(theme);
    cacheTheme(theme);
  }, [theme]);
  return (
    <ThemeProvider {...themeProviderProps(theme)}>
      <BaseStyles className="app-root">{children}</BaseStyles>
    </ThemeProvider>
  );
}
