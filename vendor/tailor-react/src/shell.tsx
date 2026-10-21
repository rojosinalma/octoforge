/* managed by tailor v0.11.0 — tailor-react src/shell.tsx — do not edit, run `tailor sync` */
// App shell & layout: app-shell, navbar, sidebar, footer, page, section,
// toolbar, grid, stack, split — markup per core/components.json.
import {
  cloneElement, isValidElement,
  type AnchorHTMLAttributes, type HTMLAttributes, type LiHTMLAttributes, type ReactElement, type ReactNode,
} from "react";
import { cx, dataAttr } from "./util.ts";
import { mark, useMounted } from "./popup.ts";
import { PickerControls, type PickerPart, type TailorThemeConfig } from "./theme.tsx";

/* ── app-shell ───────────────────────────────────────────────────────────── */

export type AppShellProps = HTMLAttributes<HTMLDivElement> & {
  /** Navbar content, rendered inside `<header class="t-navbar t-shell-nav">`; a `<Ui.Navbar>` element is used as
   * that header itself (it gets `t-shell-nav`). */
  nav?: ReactNode;
  /** Sidebar slot content (usually a `<Sidebar>`); rendered inside `<aside class="t-shell-side">`. */
  side?: ReactNode;
  /** Footer content, rendered inside `<footer class="t-footer t-shell-foot">`; a `<Ui.Footer>` element is used as
   * that footer itself (it gets `t-shell-foot`). */
  foot?: ReactNode;
  /** `data-sidebar` state. */
  sidebar?: "none" | "collapsed";
};

export function AppShell({ nav, side, foot, sidebar, className, children, ...rest }: AppShellProps) {
  return (
    <div className={cx("t-shell", className)} data-sidebar={dataAttr(sidebar)} {...rest}>
      {nav !== undefined && (slotOf(nav, Navbar, "t-shell-nav") ?? <header className="t-navbar t-shell-nav">{nav}</header>)}
      {side !== undefined && <aside className="t-shell-side">{side}</aside>}
      <main className="t-shell-main t-page">{children}</main>
      {foot !== undefined && (slotOf(foot, Footer, "t-shell-foot") ?? <footer className="t-footer t-shell-foot">{foot}</footer>)}
    </div>
  );
}

/** A slot given as the component's own element (`<Ui.Navbar>` for `nav`): that element with the slot class added. */
function slotOf(node: ReactNode, type: unknown, cls: string): ReactNode | null {
  if (!isValidElement(node) || node.type !== type) return null;
  const el = node as ReactElement<{ className?: string }>;
  return cloneElement(el, { className: cx(el.props.className, cls) });
}

/* ── navbar ──────────────────────────────────────────────────────────────── */

export function Navbar({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return <header className={cx("t-navbar", className)} {...rest}>{children}</header>;
}

function NavbarBrand({ className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={cx("t-navbar-brand", className)} {...rest}>{children}</a>;
}

function NavbarNav({ className, children, ...rest }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cx("t-navbar-nav", className)} {...rest}>{children}</ul>;
}

type NavbarLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { current?: boolean };

function NavbarLink({ current, className, children, ...rest }: NavbarLinkProps) {
  return (
    <li>
      <a className={cx("t-navbar-link", className)} aria-current={current ? "page" : undefined} {...rest}>
        {children}
      </a>
    </li>
  );
}

function NavbarSep({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx("t-navbar-sep", className)} {...rest}></span>;
}

function NavbarEnd({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("t-navbar-end", className)} {...rest}>{children}</div>;
}

Navbar.Brand = NavbarBrand;
Navbar.Nav = NavbarNav;
Navbar.Link = NavbarLink;
Navbar.Sep = NavbarSep;
Navbar.End = NavbarEnd;

/* ── sidebar ─────────────────────────────────────────────────────────────── */

type SidebarProps = HTMLAttributes<HTMLElement> & { label?: string };

export function Sidebar({ label = "Sections", className, children, ...rest }: SidebarProps) {
  return (
    <nav className={cx("t-sidebar", className)} aria-label={label} {...rest}>
      <ul>{children}</ul>
    </nav>
  );
}

function SidebarGroup({ className, children, ...rest }: LiHTMLAttributes<HTMLLIElement>) {
  return <li className={cx("t-sidebar-group", className)} {...rest}>{children}</li>;
}

type SidebarItemProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  current?: boolean;
  /** Leading slot (an icon, a status dot…). */
  icon?: ReactNode;
  /** Trailing slot (a counter, a badge…). */
  trail?: ReactNode;
};

function SidebarItem({ current, icon, trail, className, children, ...rest }: SidebarItemProps) {
  return (
    <li>
      <a className={cx("t-sidebar-item", className)} aria-current={current ? "page" : undefined} {...rest}>
        {icon}
        <span className="t-sidebar-item-name">{children}</span>
        {trail}
      </a>
    </li>
  );
}

type SidebarCollapsibleProps = HTMLAttributes<HTMLElement> & {
  open?: boolean;
  icon?: ReactNode;
  trail?: ReactNode;
  /** The summary row label. */
  label: ReactNode;
};

function SidebarCollapsible({ open, icon, trail, label, children }: SidebarCollapsibleProps) {
  return (
    <li>
      <details open={open}>
        <summary className="t-sidebar-item">
          {icon}
          <span className="t-sidebar-item-name">{label}</span>
          {trail}
          <span className="t-sidebar-chevron"></span>
        </summary>
        <ul className="t-sidebar-nested">{children}</ul>
      </details>
    </li>
  );
}

function SidebarDivider({ className, ...rest }: LiHTMLAttributes<HTMLLIElement>) {
  return <li className={cx("t-sidebar-divider", className)} {...rest}></li>;
}

Sidebar.Group = SidebarGroup;
Sidebar.Item = SidebarItem;
Sidebar.Collapsible = SidebarCollapsible;
Sidebar.Divider = SidebarDivider;

/* ── footer ──────────────────────────────────────────────────────────────── */

export function Footer({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return <footer className={cx("t-footer", className)} {...rest}>{children}</footer>;
}

type FooterRepoProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "title"> & {
  /** Accessible name and tooltip (`aria-label` + `data-tip`; never `title=`). */
  label?: string;
};

function FooterRepo({ label, className, children, ...rest }: FooterRepoProps) {
  return <a className={cx("t-footer-repo", className)} data-tip={label} aria-label={label} {...rest}>{children}</a>;
}

function FooterEnd({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("t-footer-end", className)} {...rest}>{children}</div>;
}

type FooterPickersProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  /** Which controls (`data-tailor-pickers="mode"` …); default skin, palette and the mode toggle. */
  parts?: PickerPart[];
  /** Control size; `xs` in a footer (default), like Tailor.theme.renderPickers. */
  size?: "xs" | "sm";
  config?: Partial<TailorThemeConfig>;
};

/**
 * The footer switcher: renders the canonical `<div data-tailor-pickers>` host, and after mount fills it the way
 * Tailor.theme.renderPickers does (`.t-pickers`: skin and palette selects, the sun/moon toggle last) through the
 * React theme store (`Ui.Pickers`), without tailor.js.
 */
function FooterPickers({ parts, size = "xs", config, className, ...rest }: FooterPickersProps) {
  const mounted = useMounted();
  return (
    <div
      className={cx(mounted && "t-pickers", className) || undefined}
      data-tailor-pickers={parts ? parts.join(" ") : ""}
      {...mark(mounted, "pickers")}
      {...rest}
    >
      {mounted && <PickerControls parts={parts} size={size} config={config} />}
    </div>
  );
}

function FooterVersion({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx("t-footer-version", className)} {...rest}>{children}</span>;
}

Footer.Repo = FooterRepo;
Footer.End = FooterEnd;
Footer.Pickers = FooterPickers;
Footer.Version = FooterVersion;

/* ── page ────────────────────────────────────────────────────────────────── */

/** `<main class="t-page">`; `as="div"` for a page block that is not the document's main landmark. */
export function Page({ as: Tag = "main", className, children, ...rest }: HTMLAttributes<HTMLElement> & { as?: "main" | "div" }) {
  return <Tag className={cx("t-page", className)} {...rest}>{children}</Tag>;
}

function PageHeader({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return <header className={cx("t-page-header", className)} {...rest}>{children}</header>;
}

function PageBack({ className, children = "←", ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={cx("t-page-back", className)} {...rest}>{children}</a>;
}

function PageTitle({ className, children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h1 className={cx("t-page-title", className)} {...rest}>{children}</h1>;
}

function PageLead({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx("t-page-lead", className)} {...rest}>{children}</span>;
}

function PageActions({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("t-page-actions", className)} {...rest}>{children}</div>;
}

Page.Header = PageHeader;
Page.Back = PageBack;
Page.Title = PageTitle;
Page.Lead = PageLead;
Page.Actions = PageActions;

/* ── section ─────────────────────────────────────────────────────────────── */

type SectionProps = HTMLAttributes<HTMLElement> & { title: ReactNode; /** Extra class on `.t-section-body`. */ bodyClassName?: string };

export function Section({ title, bodyClassName, className, children, ...rest }: SectionProps) {
  return (
    <section className={cx("t-section", className)} {...rest}>
      <h2 className="t-section-title">{title}</h2>
      <div className={cx("t-section-body", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ── toolbar ─────────────────────────────────────────────────────────────── */

type ToolbarProps = HTMLAttributes<HTMLDivElement> & {
  label?: string;
  align?: "start" | "center" | "end";
  gap?: "1" | "2" | "3" | "4";
};

export function Toolbar({ label, align, gap, className, children, ...rest }: ToolbarProps) {
  return (
    <div
      className={cx("t-toolbar", className)}
      role="toolbar"
      aria-label={label}
      data-align={dataAttr(align)}
      data-gap={dataAttr(gap)}
      {...rest}
    >
      {children}
    </div>
  );
}

function ToolbarSpacer({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx("t-toolbar-spacer", className)} {...rest}></span>;
}

Toolbar.Spacer = ToolbarSpacer;

/* ── grid / stack / cluster / split ──────────────────────────────────────── */

type GridProps = HTMLAttributes<HTMLDivElement> & {
  /** `12` is the form grid: children carry `data-span`. */
  cols?: "auto" | "1" | "2" | "3" | "4" | "6" | "12";
  min?: "xs" | "sm" | "md" | "lg";
  gap?: "1" | "2" | "3" | "4" | "5";
  align?: "start" | "center" | "end";
};

export function Grid({ cols, min, gap, align, className, children, ...rest }: GridProps) {
  return (
    <div
      className={cx("t-grid", className)}
      data-cols={dataAttr(cols)}
      data-min={dataAttr(min)}
      data-gap={dataAttr(gap)}
      data-align={dataAttr(align)}
      {...rest}
    >
      {children}
    </div>
  );
}

type FlowProps = HTMLAttributes<HTMLDivElement> & {
  gap?: "0" | "1" | "2" | "3" | "4" | "5" | "6";
  align?: "start" | "center" | "end" | "stretch" | "baseline";
};

export function Stack({ gap, align, className, children, ...rest }: FlowProps) {
  return (
    <div className={cx("t-stack", className)} data-gap={dataAttr(gap)} data-align={dataAttr(align)} {...rest}>
      {children}
    </div>
  );
}

export function Cluster({ gap, align, className, children, ...rest }: FlowProps) {
  return (
    <div className={cx("t-cluster", className)} data-gap={dataAttr(gap)} data-align={dataAttr(align)} {...rest}>
      {children}
    </div>
  );
}

type SplitProps = HTMLAttributes<HTMLDivElement> & { fill?: "viewport" };

export function Split({ fill, className, children, ...rest }: SplitProps) {
  return (
    <div className={cx("t-split", className)} data-fill={dataAttr(fill)} {...rest}>
      {children}
    </div>
  );
}

function SplitSide({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("t-split-side", className)} {...rest}>{children}</div>;
}

function SplitPane({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("t-split-pane", className)} {...rest}>{children}</div>;
}

Split.Side = SplitSide;
Split.Pane = SplitPane;
