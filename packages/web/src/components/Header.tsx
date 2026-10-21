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
      <rect width="32" height="32" rx="6" fill="var(--t-accent)" />
      <g
        transform="translate(4 4)"
        fill="none"
        stroke="var(--t-on-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* lucide:anvil, the same glyph as public/favicon.svg */}
        <path d="M7 10H6a4 4 0 0 1-4-4a1 1 0 0 1 1-1h4m0 0a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1a7 7 0 0 1-7 7H8a1 1 0 0 1-1-1zm2 7v5m6-5v5M5 20a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1" />
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
