import type { Theme } from '@octoforge/shared';
import { PaintbrushIcon, PersonIcon, SignOutIcon } from '@primer/octicons-react';
import { ActionList, ActionMenu, Header as PrimerHeader } from '@primer/react';
import { useApp } from '../hooks/useApp';
import { linkClick, useRoute } from '../router';
import { THEME_LABELS, THEMES } from '../theme';

const NAV = [
  { path: '/', label: 'Members' },
  { path: '/database', label: 'Database' },
  { path: '/log', label: 'Log' },
  { path: '/settings', label: 'Settings' },
] as const;

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" width={size} height={size} className="wordmark-mark">
      <rect x="1" y="1" width="30" height="30" rx="7" fill="var(--bgColor-done-emphasis)" />
      <g
        fill="none"
        stroke="var(--fgColor-onEmphasis)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 13h13l3-3h3v5h-3l-2 2v2H9z" />
        <path d="M13 19v4M17 19v4M10 24h10" />
      </g>
    </svg>
  );
}

export function Header() {
  const { settings, updateSettings, authRequired, logout } = useApp();
  const route = useRoute();
  const active = (p: string) =>
    p === '/' ? route.path === '/' || route.path.startsWith('/members/') : route.path === p;

  return (
    <PrimerHeader className="app-header" aria-label="Octoforge">
      <PrimerHeader.Item>
        <PrimerHeader.Link href="/" onClick={linkClick('/')} className="wordmark" aria-label="Octoforge home">
          <Logo />
          <span>Octoforge</span>
        </PrimerHeader.Link>
      </PrimerHeader.Item>
      <PrimerHeader.Item full>
        <nav className="app-nav" aria-label="Main">
          {NAV.map((n) => (
            <a
              key={n.path}
              href={n.path}
              onClick={linkClick(n.path)}
              className={`app-nav-link${active(n.path) ? ' app-nav-link-active' : ''}`}
              aria-current={active(n.path) ? 'page' : undefined}
            >
              {n.label}
            </a>
          ))}
        </nav>
      </PrimerHeader.Item>
      <PrimerHeader.Item>
        <ActionMenu>
          <ActionMenu.Anchor>
            <button type="button" className="avatar-button" aria-label="Account menu">
              <PersonIcon size={20} />
            </button>
          </ActionMenu.Anchor>
          <ActionMenu.Overlay width="medium" align="end">
            <ActionList>
              <ActionList.Group selectionVariant="single">
                <ActionList.GroupHeading>
                  <PaintbrushIcon /> Theme
                </ActionList.GroupHeading>
                {THEMES.map((t: Theme) => (
                  <ActionList.Item
                    key={t}
                    selected={settings.theme === t}
                    onSelect={() => void updateSettings({ theme: t }, { silent: true })}
                  >
                    {THEME_LABELS[t]}
                  </ActionList.Item>
                ))}
              </ActionList.Group>
              {authRequired && (
                <>
                  <ActionList.Divider />
                  <ActionList.Item onSelect={() => void logout()}>
                    <ActionList.LeadingVisual>
                      <SignOutIcon />
                    </ActionList.LeadingVisual>
                    Sign out
                  </ActionList.Item>
                </>
              )}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      </PrimerHeader.Item>
    </PrimerHeader>
  );
}
