import type { ReactNode } from 'react';
import { Ui } from 'tailor-react';
import { Footer } from './Footer';
import { Header } from './Header';

/** The app shell (navbar, scrolling main, footer) with the page header. `side` adds a sidebar column. */
export function Page({
  title,
  actions,
  lead,
  side,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  lead?: ReactNode;
  side?: ReactNode;
  children: ReactNode;
}) {
  return (
    // The markup of Ui.AppShell; Header and Footer render the slot elements themselves.
    <div className="t-shell">
      <Header />
      {side !== undefined && <aside className="t-shell-side">{side}</aside>}
      <main className="t-shell-main t-page">
        <Ui.Page.Header>
          <Ui.Page.Title>{title}</Ui.Page.Title>
          {lead && <Ui.Page.Lead>{lead}</Ui.Page.Lead>}
          {actions && <Ui.Page.Actions>{actions}</Ui.Page.Actions>}
        </Ui.Page.Header>
        <Ui.Stack gap="5" className="page-body">
          {children}
        </Ui.Stack>
      </main>
      <Footer />
    </div>
  );
}

export function Section({ title, id, children }: { title: ReactNode; id?: string; children: ReactNode }) {
  return (
    // The markup of Ui.Section, which takes a string title only; here the title may carry an icon.
    <section className="t-section" id={id}>
      <h2 className="t-section-title">{title}</h2>
      <div className="t-section-body t-stack">{children}</div>
    </section>
  );
}

/** Up/down dot with an accessible label (tooltip, never a native one). */
export function StatusDot({ up, label }: { up: boolean | null; label: string }) {
  return (
    <Ui.Dot
      status={up === null ? 'muted' : up ? 'running' : 'stopped'}
      tip={label}
      role="img"
      aria-label={label}
    />
  );
}

/** A sprite icon from the vendored tailor set (`bi-*`). */
export function Icon({ name, label }: { name: string; label?: string }) {
  return <Ui.Icon name={`bi-${name}`} label={label} />;
}

/** A link styled as a button (`a.t-btn`): opens a page or an outside URL. */
export function LinkButton({
  href,
  icon,
  variant,
  size,
  external,
  onClick,
  children,
}: {
  href: string;
  icon?: string;
  variant?: 'primary' | 'ghost';
  size?: 'xs' | 'sm';
  external?: boolean;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}) {
  return (
    <a
      className="t-btn"
      href={href}
      data-variant={variant}
      data-size={size}
      onClick={onClick}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      {icon && <Icon name={icon} />}
      {children}
    </a>
  );
}

/** Small loading line: spinner plus text. */
export function Loading({ children = 'Loading…' }: { children?: ReactNode }) {
  return (
    <span className="t-muted">
      <Ui.Spinner size="sm" label={null} /> {children}
    </span>
  );
}
