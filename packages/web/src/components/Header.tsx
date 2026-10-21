import { Ui } from 'tailor-react';
import { useApp } from '../hooks/useApp';
import { linkClick, useRoute } from '../router';

const NAV = [
  { path: '/', label: 'Members' },
  { path: '/github-app', label: 'GitHub App' },
  { path: '/database', label: 'Database' },
  { path: '/log', label: 'Log' },
  { path: '/settings', label: 'Settings' },
] as const;

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" width={size} height={size} className="wordmark-mark">
      <rect x="1" y="1" width="30" height="30" rx="7" fill="var(--t-accent)" />
      <g
        fill="none"
        stroke="var(--t-on-accent)"
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
  const { authRequired, logout } = useApp();
  const route = useRoute();
  const active = (p: string) =>
    p === '/' ? route.path === '/' || route.path.startsWith('/members/') : route.path === p;

  return (
    <Ui.Navbar className="t-shell-nav" aria-label="Octoforge">
      <Ui.Navbar.Brand href="/" onClick={linkClick('/')} className="wordmark" aria-label="Octoforge home">
        <Logo />
        <span>Octoforge</span>
      </Ui.Navbar.Brand>
      <Ui.Navbar.Nav aria-label="Main">
        {NAV.map((n) => (
          <Ui.Navbar.Link key={n.path} href={n.path} onClick={linkClick(n.path)} current={active(n.path)}>
            {n.label}
          </Ui.Navbar.Link>
        ))}
      </Ui.Navbar.Nav>
      {authRequired && <Ui.Navbar.Sep />}
      {authRequired && (
        <Ui.Navbar.End>
          <Ui.Button variant="ghost" size="sm" type="button" onClick={() => void logout()}>
            <Ui.Icon name="bi-box-arrow-right" /> Sign out
          </Ui.Button>
        </Ui.Navbar.End>
      )}
    </Ui.Navbar>
  );
}
