/* managed by tailor v0.11.1 — tailor-react src/actions.tsx — do not edit, run `tailor sync` */
// Actions & navigation: button, button-group, segmented, menu, tabs,
// breadcrumb, pagination, list — markup per core/components.json; the
// tailor.js behaviours (filters, tabs, menus, listbox) are reimplemented as
// React state + the aria conventions from core/conventions.md §4.
import {
  createContext, useContext, useEffect, useId, useRef, useState,
  type AnchorHTMLAttributes, type AriaAttributes, type ButtonHTMLAttributes, type CSSProperties,
  type HTMLAttributes, type KeyboardEvent, type ReactNode,
} from "react";
import { cx, dataAttr, type Size, type Tone } from "./util.ts";
import { mark, popup, useMounted } from "./popup.ts";

/* ── icon slot ───────────────────────────────────────────────────────────── */

export type IconProps = AriaAttributes & {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** Sprite symbol id (`<set>-<name>`, e.g. `bi-grid`); renders the `<svg><use>` form of conventions §2. */
  name?: string;
  /** Sprite URL; defaults to the tailor apply output. */
  sprite?: string;
  /** Accessible name: renders `role="img"` + `<title>`; without it the icon is `aria-hidden`. */
  label?: string;
  size?: "xs" | "sm" | "lg" | "xl";
};

export const ICON_SPRITE = "/tailor/icons.svg";
/** Sprite URL for every `<Icon name>` below it (set by `<UiProvider sprite>`); default = the `tailor apply` output. */
export const IconSpriteContext = createContext(ICON_SPRITE);

/**
 * The `.t-icon` slot. `<Icon name="bi-grid" />` renders a sprite icon
 * (`<svg class="t-icon" aria-hidden="true"><use href="/tailor/icons.svg#bi-grid"/></svg>`);
 * children only (a Unicode glyph or inline svg) keeps the `<span class="t-icon">` form.
 */
export function Icon({ name, sprite, label, size, className, children, ...rest }: IconProps) {
  const ctxSprite = useContext(IconSpriteContext);
  sprite ??= ctxSprite;
  if (name === undefined) {
    return <span className={cx("t-icon", className)} data-size={dataAttr(size)} {...rest}>{children}</span>;
  }
  const a11y = label !== undefined ? { role: "img" } : { "aria-hidden": true as const };
  return (
    <svg className={cx("t-icon", className)} data-size={dataAttr(size)} {...a11y} {...rest}>
      {label !== undefined && <title>{label}</title>}
      <use href={`${sprite}#${name}`} />
    </svg>
  );
}

/** Icon slot content: a string is a sprite symbol id, a node renders as-is. */
export function iconSlot(icon: ReactNode, className?: string): ReactNode {
  return typeof icon === "string" ? <Icon name={icon} className={className} /> : icon;
}

/* ── button ──────────────────────────────────────────────────────────────── */

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "warning" | "ghost" | "link";
  tone?: Tone;
  size?: "xs" | "sm" | "md" | "lg";
  /** Icon-only button (`data-icon="only"`); pair with `aria-label`. */
  iconOnly?: boolean;
  /** `aria-busy` loading state (also disables the button). */
  busy?: boolean;
  /** `aria-pressed` toggle state. */
  pressed?: boolean;
  /** Tooltip text (`data-tip`), shown by the UiProvider tooltip layer. */
  tip?: string;
  tipAt?: "top" | "bottom" | "left" | "right";
};

export function Button({
  variant, tone, size, iconOnly, busy, pressed, tip, tipAt, className, children, disabled, ...rest
}: ButtonProps) {
  return (
    <button
      className={cx("t-btn", className)}
      data-variant={dataAttr(variant)}
      data-tone={dataAttr(tone)}
      data-size={dataAttr(size, "md")}
      data-icon={iconOnly ? "only" : undefined}
      data-tip={tip}
      data-tip-at={tipAt}
      aria-busy={busy || undefined}
      aria-pressed={pressed}
      disabled={busy ? true : disabled}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── button-group / quick filter ─────────────────────────────────────────── */

export type ButtonGroupProps = HTMLAttributes<HTMLDivElement> & {
  label?: string;
  /** Quick-filter mode (`data-role="filter"`): single-select aria-pressed. */
  filter?: boolean;
  size?: "sm" | "md" | "lg";
  /** Filter mode: the options, rendered as buttons. */
  options?: Array<{ value: string; label: ReactNode }>;
  /** Filter mode: controlled selected value. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
};

export function ButtonGroup({
  label, filter, size, options, value, defaultValue, onChange, className, children, ...rest
}: ButtonGroupProps) {
  const [internal, setInternal] = useState(defaultValue ?? options?.[0]?.value);
  const selected = value !== undefined ? value : internal;
  const mounted = useMounted();
  return (
    <div
      className={cx("t-btn-group", className)}
      role="group"
      data-role={filter ? "filter" : undefined}
      aria-label={label}
      {...mark(mounted && !!filter, "filter")}
      {...rest}
    >
      {options
        ? options.map((o) => (
            <Button
              key={o.value}
              size={size ?? "sm"}
              pressed={filter ? selected === o.value : undefined}
              onClick={() => { setInternal(o.value); onChange?.(o.value); }}
            >
              {o.label}
            </Button>
          ))
        : children}
    </div>
  );
}

/* ── segmented control ───────────────────────────────────────────────────── */

export type SegmentedProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> & {
  label?: string;
  /** Radio group name; defaults to a generated id. */
  name?: string;
  size?: "sm" | "md";
  /** `tip` puts a `data-tip` on the item (icon-only segments). */
  options: Array<{ value: string; label: ReactNode; disabled?: boolean; tip?: string }>;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
};

export function Segmented({
  label, name, size, options, value, defaultValue, onChange, className, ...rest
}: SegmentedProps) {
  const autoName = useId();
  const groupName = name ?? autoName;
  const controlled = value !== undefined;
  return (
    <div
      className={cx("t-segmented", className)}
      role="group"
      aria-label={label}
      data-size={dataAttr(size, "md")}
      {...rest}
    >
      {options.map((o) => (
        <label key={o.value} className="t-segmented-item" data-tip={o.tip}>
          <input
            className="t-segmented-input"
            type="radio"
            name={groupName}
            disabled={o.disabled}
            {...(controlled
              ? { checked: value === o.value, onChange: () => onChange?.(o.value) }
              : { defaultChecked: defaultValue === o.value, onChange: () => onChange?.(o.value) })}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

/* ── menu (dropdown) ─────────────────────────────────────────────────────── */

export type MenuProps = HTMLAttributes<HTMLDetailsElement> & {
  /** The trigger content, rendered as `<summary class="t-btn">`. */
  trigger: ReactNode;
  align?: "start" | "end";
  open?: boolean;
  summaryClassName?: string;
  /** Button variant of the trigger (`data-variant` on the summary). */
  variant?: "primary" | "secondary" | "danger" | "warning" | "ghost";
};

/**
 * `<Ui.Menu>` over `<details class="t-menu">` — the React Tailor.menus: the open list is the current popup (one at
 * a time; Escape or a pointerdown outside closes it; `data-at` flips it above the trigger near the bottom edge,
 * `data-align="end"` hangs it off the right edge near it); a plain item click closes the menu, a checkbox item
 * toggles and keeps it open.
 */
export function Menu({ trigger, align, open, summaryClassName, variant, className, children, onToggle, onClick, ...rest }: MenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const mounted = useMounted();
  useEffect(() => () => { const l = ref.current?.querySelector<HTMLElement>(".t-menu-list"); if (l && popup.current()?.panel === l) popup.close(); }, []);
  const sync = (m: HTMLDetailsElement) => {
    const list = m.querySelector<HTMLElement>(".t-menu-list"), summary = m.querySelector<HTMLElement>("summary");
    if (!list || !summary) return;
    const mine = popup.current()?.panel === list;
    if (m.open) { if (!mine) popup.open(list, summary, () => { m.open = false; }); }
    else { delete list.dataset.at; delete list.dataset.align; if (mine) popup.close(); }
  };
  return (
    <details
      ref={ref}
      className={cx("t-menu", className)}
      data-align={dataAttr(align)}
      open={open}
      {...mark(mounted, "menu")}
      onToggle={(e) => { sync(e.currentTarget); onToggle?.(e); }}
      onClick={(e) => {
        const m = e.currentTarget, t = e.target as Element;
        const it = t.closest(".t-menu-item");
        if (it && it.getAttribute("role") !== "menuitemcheckbox" && m.contains(it)) m.removeAttribute("open");
        // the summary toggles `open` right after this click, the toggle event comes a task later: register the
        // popup as soon as the state is known, so an immediate outside pointerdown already closes it
        else if (t.closest("summary")?.parentElement === m) queueMicrotask(() => sync(m));
        onClick?.(e);
      }}
      {...rest}
    >
      <summary className={cx("t-btn", summaryClassName)} data-variant={dataAttr(variant)}>{trigger}</summary>
      <ul className="t-menu-list" role="menu">{children}</ul>
    </details>
  );
}

export type MenuItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "defaultChecked"> & {
  /** Render as `role="menuitemcheckbox"` with this checked state (controlled; pair with `onCheckedChange`). */
  checked?: boolean;
  /** Checkbox item, uncontrolled: starts with this state and toggles on click (like tailor.js). */
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  tone?: Tone;
  onSelect?: () => void;
};

function MenuItem({ checked, defaultChecked, onCheckedChange, tone, onSelect, className, children, onClick, ...rest }: MenuItemProps) {
  const [internal, setInternal] = useState(defaultChecked ?? false);
  const isCheck = checked !== undefined || defaultChecked !== undefined;
  const on = checked ?? internal;
  return (
    <li>
      <button
        className={cx("t-menu-item", className)}
        role={isCheck ? "menuitemcheckbox" : "menuitem"}
        aria-checked={isCheck ? on : undefined}
        data-tone={dataAttr(tone)}
        onClick={(e) => {
          if (isCheck) { if (checked === undefined) setInternal(!on); onCheckedChange?.(!on); }
          onSelect?.(); onClick?.(e);
        }}
        {...rest}
      >
        {children}
      </button>
    </li>
  );
}

function MenuHeader({ className, children, ...rest }: HTMLAttributes<HTMLLIElement>) {
  return <li className={cx("t-menu-header", className)} {...rest}>{children}</li>;
}

function MenuDivider({ className, ...rest }: HTMLAttributes<HTMLLIElement>) {
  return <li className={cx("t-menu-divider", className)} {...rest}></li>;
}

function MenuDesc({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx("t-menu-desc", className)} {...rest}>{children}</span>;
}

/** Trailing shortcut (`span.t-menu-kbd`, as in the showcase demo). */
function MenuKbd({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return <span className={cx("t-menu-kbd", className)} {...rest}>{children}</span>;
}

Menu.Item = MenuItem;
Menu.Header = MenuHeader;
Menu.Divider = MenuDivider;
Menu.Desc = MenuDesc;
Menu.Kbd = MenuKbd;

/* ── tabs ────────────────────────────────────────────────────────────────── */

export type TabsProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> & {
  variant?: "underline" | "boxed";
  /** Tab definitions; ids follow the tailor pattern `t-<value>` / `p-<value>`. */
  tabs: Array<{ value: string; label: ReactNode; disabled?: boolean }>;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** One panel per tab, keyed by tab value; a tab without a panel (a disabled one) gets no `aria-controls`/id. */
  panels: Record<string, ReactNode>;
  /** Extra class on every panel (e.g. `t-muted`). */
  panelClassName?: string;
};

export function Tabs({ variant, tabs, value, defaultValue, onChange, panels, panelClassName, className, ...rest }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue ?? tabs[0]?.value);
  const mounted = useMounted();
  const active = value !== undefined ? value : internal;
  const listRef = useRef<HTMLDivElement>(null);

  const select = (v: string, focus = false) => {
    setInternal(v);
    onChange?.(v);
    if (focus) listRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[tabs.findIndex((t) => t.value === v)]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = tabs.filter((t) => !t.disabled);
    const i = enabled.findIndex((t) => t.value === active);
    const next: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: enabled.length - 1 };
    const step = next[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const t = enabled[(step + enabled.length) % enabled.length];
    if (t) select(t.value, true);
  };

  return (
    <div className={cx("t-tabs", className)} data-variant={dataAttr(variant)} {...mark(mounted, "tabs")} {...rest}>
      <div className="t-tabs-list" role="tablist" ref={listRef} onKeyDown={onKeyDown}>
        {tabs.map((t) => {
          const selected = t.value === active, panel = panels[t.value] !== undefined;
          return (
            <button
              key={t.value}
              className="t-tab"
              role="tab"
              aria-selected={selected}
              aria-controls={panel ? `p-${t.value}` : undefined}
              id={panel ? `t-${t.value}` : undefined}
              tabIndex={selected ? undefined : -1}
              disabled={t.disabled}
              onClick={() => select(t.value)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {tabs.filter((t) => panels[t.value] !== undefined).map((t) => (
        <div
          key={t.value}
          className={cx("t-tab-panel", panelClassName)}
          role="tabpanel"
          id={`p-${t.value}`}
          aria-labelledby={`t-${t.value}`}
          hidden={t.value !== active}
        >
          {panels[t.value]}
        </div>
      ))}
    </div>
  );
}

/* ── breadcrumb ──────────────────────────────────────────────────────────── */

export function Breadcrumb({ className, children, "aria-label": ariaLabel = "Breadcrumb", ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <nav className={cx("t-breadcrumb", className)} aria-label={ariaLabel} {...rest}>
      <ol>{children}</ol>
    </nav>
  );
}

type BreadcrumbItemProps = AnchorHTMLAttributes<HTMLAnchorElement> & { current?: boolean };

function BreadcrumbItem({ current, children, ...rest }: BreadcrumbItemProps) {
  if (current) return <li aria-current="page">{children}</li>;
  return <li><a {...rest}>{children}</a></li>;
}

Breadcrumb.Item = BreadcrumbItem;

/* ── pagination ──────────────────────────────────────────────────────────── */

type PaginationProps = HTMLAttributes<HTMLElement> & { size?: "sm" | "md" };

export function Pagination({ size, className, children, "aria-label": ariaLabel = "Pagination", ...rest }: PaginationProps) {
  return (
    <nav className={cx("t-pagination", className)} aria-label={ariaLabel} data-size={dataAttr(size, "md")} {...rest}>
      <ul>{children}</ul>
    </nav>
  );
}

type PageLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { current?: boolean; disabled?: boolean };

function PageLink({ current, disabled, className, children, ...rest }: PageLinkProps) {
  return (
    <li>
      <a
        className={cx("t-page-link", className)}
        aria-current={current ? "page" : undefined}
        aria-disabled={disabled || undefined}
        {...rest}
      >
        {children}
      </a>
    </li>
  );
}

Pagination.Link = PageLink;

/* ── selectable list (listbox) ───────────────────────────────────────────── */

export type ListProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & {
  label?: string;
  multi?: boolean;
  size?: "sm" | "md";
  /** Controlled selection (item values). */
  selected?: string[];
  defaultSelected?: string[];
  onChange?: (selected: string[]) => void;
};

export function List({
  label, multi, size, selected, defaultSelected, onChange, className, children, ...rest
}: ListProps) {
  const [internal, setInternal] = useState<string[]>(defaultSelected ?? []);
  const current = selected !== undefined ? selected : internal;
  const toggle = (v: string) => {
    const next = multi
      ? current.includes(v) ? current.filter((x) => x !== v) : [...current, v]
      : [v];
    setInternal(next);
    onChange?.(next);
  };
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role=option]:not(:disabled)") ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const n = e.key === "ArrowDown" ? i + 1 : i - 1;
    const t = items[(n + items.length) % items.length];
    if (t) { e.preventDefault(); t.focus(); }
  };
  return (
    <ListContext value={{ current, toggle }}>
      <div
        ref={ref}
        className={cx("t-list", className)}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multi ? "true" : undefined}
        data-size={dataAttr(size, "md")}
        onKeyDown={onKeyDown}
        {...mark(mounted, "list")}
        {...rest}
      >
        {children}
      </div>
    </ListContext>
  );
}

const ListContext = createContext<{ current: string[]; toggle: (v: string) => void } | null>(null);

export type ListItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "name"> & {
  /** Selection value; when given, selection state comes from the List. */
  value?: string;
  selected?: boolean;
  /** Leading slot: a string is a sprite icon name rendered as `t-icon t-list-lead`, a node as-is. */
  lead?: ReactNode;
  name: ReactNode;
  desc?: ReactNode;
  /** Trailing slot: a string renders as `t-list-trail`, a node as-is. */
  trail?: ReactNode;
};

function ListItem({ value, selected, lead, name, desc, trail, className, onClick, ...rest }: ListItemProps) {
  const ctx = useContext(ListContext);
  const isSelected = selected ?? (value !== undefined && ctx !== null ? ctx.current.includes(value) : false);
  return (
    <button
      className={cx("t-list-item", className)}
      role="option"
      aria-selected={isSelected}
      onClick={(e) => { if (value !== undefined) ctx?.toggle(value); onClick?.(e); }}
      {...rest}
    >
      {iconSlot(lead, "t-list-lead")}
      <span className="t-list-body">
        <span className="t-list-name">{name}</span>
        {desc !== undefined && <span className="t-list-desc">{desc}</span>}
      </span>
      {typeof trail === "string" ? <span className="t-list-trail">{trail}</span> : trail}
    </button>
  );
}

function ListGroup({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("t-list-group", className)} {...rest}>{children}</div>;
}

function ListDivider({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("t-list-divider", className)} {...rest}></div>;
}

List.Item = ListItem;
List.Group = ListGroup;
List.Divider = ListDivider;

export type { Size as ButtonSize };
