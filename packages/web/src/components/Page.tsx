import { Heading } from '@primer/react';
import type { ReactNode } from 'react';
import { Footer } from './Footer';
import { Header } from './Header';

export function Page({
  title,
  actions,
  lead,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <Header />
      <main className="page">
        <div className="page-head">
          <div className="page-head-text">
            <Heading as="h1" className="page-title">
              {title}
            </Heading>
            {lead && <p className="page-lead fg-muted">{lead}</p>}
          </div>
          {actions && <div className="page-actions">{actions}</div>}
        </div>
        {children}
      </main>
      <Footer />
    </div>
  );
}

export function Section({
  title,
  actions,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Up/down dot with an accessible label. */
export function StatusDot({ up, label }: { up: boolean | null; label: string }) {
  return (
    <span
      className={`status-dot ${up === null ? 'status-dot-unknown' : up ? 'status-dot-up' : 'status-dot-down'}`}
      role="img"
      aria-label={label}
    />
  );
}
