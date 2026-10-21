/* managed by tailor v0.11.0 — tailor-react src/data.tsx — do not edit, run `tailor sync` */
// Data display: badge, counter, chip, state-label, status-dot, avatar, table,
// card, empty-state, timeline, relative-time — markup per core/components.json.
import {
  Children, createContext, isValidElement, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type HTMLAttributes, type ImgHTMLAttributes, type ReactElement,
  type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes, type TimeHTMLAttributes,
} from "react";
import { iconSlot } from "./actions.tsx";
import { cx, dataAttr, type Size, type Tone } from "./util.ts";
import { mark, useMounted } from "./popup.ts";

/* ── badge / counter / chip ──────────────────────────────────────────────── */

type BadgeProps = HTMLAttributes<HTMLElement> & {
  tone?: Tone;
  variant?: "tint" | "solid" | "outline";
  size?: "xs" | "sm" | "lg";
  /** `"button"` renders `<button class="t-badge">` (a clickable badge, e.g. a toggle). */
  as?: "span" | "button";
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
};

export function Badge({ tone, variant, size, as = "span", className, children, ...rest }: BadgeProps) {
  const Tag = as;
  return (
    <Tag
      className={cx("t-badge", className)}
      data-tone={dataAttr(tone)}
      data-variant={dataAttr(variant)}
      data-size={dataAttr(size)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

type CounterProps = HTMLAttributes<HTMLSpanElement> & { tone?: Tone };

export function Counter({ tone, className, children, ...rest }: CounterProps) {
  return <span className={cx("t-counter", className)} data-tone={dataAttr(tone)} {...rest}>{children}</span>;
}

type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  /** Renders a trailing × remove button with this accessible label. */
  onRemove?: () => void;
  removeLabel?: string;
};

export function Chip({ tone, onRemove, removeLabel, className, children, ...rest }: ChipProps) {
  return (
    <span className={cx("t-chip", className)} data-tone={dataAttr(tone)} {...rest}>
      {children}
      {onRemove && (
        <button type="button" className="t-chip-remove" aria-label={removeLabel} onClick={onRemove}>×</button>
      )}
    </span>
  );
}

/* ── state label / status dot ────────────────────────────────────────────── */

type StateLabelProps = HTMLAttributes<HTMLSpanElement> & {
  state: "open" | "closed" | "done" | "draft" | "warning" | "info";
  variant?: "solid";
  size?: "sm";
  /** A string is a sprite icon name; a node renders as-is. */
  icon?: ReactNode;
};

export function StateLabel({ state, variant, size, icon, className, children, ...rest }: StateLabelProps) {
  return (
    <span
      className={cx("t-state", className)}
      data-state={state}
      data-variant={dataAttr(variant)}
      data-size={dataAttr(size)}
      {...rest}
    >
      {iconSlot(icon)}
      {children}
    </span>
  );
}

type DotProps = Omit<HTMLAttributes<HTMLSpanElement>, "title"> & {
  status: "running" | "degraded" | "stopped" | "muted";
  /** Tooltip text (`data-tip`; never `title=`). */
  tip?: string;
};

export function Dot({ status, tip, className, ...rest }: DotProps) {
  return <span className={cx("t-dot", className)} data-status={status} data-tip={tip} {...rest}></span>;
}

/* ── avatar ──────────────────────────────────────────────────────────────── */

type AvatarProps = (HTMLAttributes<HTMLSpanElement> & ImgHTMLAttributes<HTMLImageElement>) & {
  size?: Size;
  shape?: "square";
  tone?: Tone;
  /** Overflow avatar in a stack (`data-more`), e.g. children "+3". */
  more?: boolean;
  /** Image avatar. */
  src?: string;
  /** Status dot bottom-right; wraps in `.t-avatar-wrap`. */
  status?: "online" | "busy" | "offline";
};

export function Avatar({ size, shape, tone, more, src, status, className, children, alt, ...rest }: AvatarProps) {
  const avatar = src !== undefined
    ? <img className={cx("t-avatar", className)} data-size={dataAttr(size, "md")} data-shape={dataAttr(shape)} src={src} alt={alt ?? ""} {...rest} />
    : (
      <span
        className={cx("t-avatar", className)}
        data-size={dataAttr(size, "md")}
        data-shape={dataAttr(shape)}
        data-tone={dataAttr(tone)}
        data-more={more ? "" : undefined}
        {...rest}
      >
        {children}
      </span>
    );
  if (!status) return avatar;
  return (
    <span className="t-avatar-wrap">
      {avatar}
      <span className="t-avatar-status" data-status={status}></span>
    </span>
  );
}

function AvatarStack({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx("t-avatar-stack", className)} {...rest}>{children}</span>;
}

/** Without `name` and `desc` the row is just its children (an avatar + a plain label, as in a table cell). */
type AvatarRowProps = HTMLAttributes<HTMLSpanElement> & { name?: ReactNode; desc?: ReactNode };

function AvatarRow({ name, desc, className, children, ...rest }: AvatarRowProps) {
  return (
    <span className={cx("t-avatar-row", className)} {...rest}>
      {children}
      {(name !== undefined || desc !== undefined) && (
        <span>
          {name !== undefined && <span className="t-avatar-name">{name}</span>}
          {desc !== undefined && <span className="t-avatar-desc">{desc}</span>}
        </span>
      )}
    </span>
  );
}

Avatar.Stack = AvatarStack;
Avatar.Row = AvatarRow;

/* ── table ───────────────────────────────────────────────────────────────── */

export type SortDir = "ascending" | "descending" | "none";
type SortState = { key: string; dir: Exclude<SortDir, "none"> };
type TableCtx = { sort: SortState | null; toggle: (key: string, current: SortDir | undefined) => void; cols: Map<string, number>; sorts: boolean };
const TableContext = createContext<TableCtx | null>(null);

type TableProps = HTMLAttributes<HTMLTableElement> & {
  variant?: "data" | "log";
  density?: "compact";
  /**
   * Client-side sorting (the React Tailor.sortable): a click on a `Table.Th sort` header flips its `aria-sort`
   * (others go to "none") and `Table.Body` re-orders its rows within each `Table.Group`, by the row's
   * `data-<key>`, else the cell's `data-sort-value`, else the cell text (numbers numerically).
   */
  sortable?: boolean;
  /** Called after every header click with the new sort (also without `sortable`, to sort data yourself). */
  onSortChange?: (key: string, dir: Exclude<SortDir, "none">) => void;
};

export function Table({ variant, density, sortable, onSortChange, className, children, ...rest }: TableProps) {
  const [sort, setSort] = useState<SortState | null>(null);
  const cols = useRef(new Map<string, number>()).current;
  const mounted = useMounted();
  const toggle = (key: string, current: SortDir | undefined) => {
    const dir = current === "ascending" ? "descending" : "ascending";
    setSort({ key, dir }); onSortChange?.(key, dir);
  };
  return (
    <TableContext value={sortable || onSortChange ? { sort, toggle, cols, sorts: !!sortable } : null}>
      <table
        className={cx("t-table", className)}
        data-variant={dataAttr(variant)}
        data-density={dataAttr(density)}
        {...mark(mounted && !!sortable, "sort")}
        {...rest}
      >
        {children}
      </table>
    </TableContext>
  );
}

function TableWrap({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("t-table-wrap", className)} {...rest}>{children}</div>;
}

type ThProps = ThHTMLAttributes<HTMLTableCellElement> & {
  /** Sort key (`data-sort`); renders the header as a sort button. */
  sort?: string;
  /** Sort state; inside a `<Table sortable>` only the initial one (the table tracks it after a click). */
  dir?: SortDir;
  onSort?: (key: string, dir: Exclude<SortDir, "none">) => void;
  /** Right-aligned numeric column. */
  num?: boolean;
  /** Icon-only / actions / shrink-to-fit columns. */
  icon?: boolean;
  actions?: boolean;
  shrink?: boolean;
};

function Th({ sort, dir, onSort, num, icon, actions, shrink, className, children, ...rest }: ThProps) {
  const ctx = useContext(TableContext);
  const ref = useRef<HTMLTableCellElement>(null);
  useEffect(() => { if (ctx && sort !== undefined && ref.current) ctx.cols.set(sort, ref.current.cellIndex); });
  const cls = cx(num && "t-col-num", icon && "t-col-icon", actions && "t-col-actions", shrink && "t-col-shrink", className) || undefined;
  if (sort === undefined) return <th className={cls} {...rest}>{children}</th>;
  const shown: SortDir | undefined = ctx?.sort ? (ctx.sort.key === sort ? ctx.sort.dir : "none") : dir;
  const next: Exclude<SortDir, "none"> = shown === "ascending" ? "descending" : "ascending";
  return (
    // the whole header cell sorts (tailor.js listens on the thead), the button gives it keyboard reach
    <th ref={ref} className={cls} aria-sort={shown} data-sort={sort} onClick={(e) => { ctx?.toggle(sort, shown); onSort?.(sort, next); rest.onClick?.(e); }} {...omit(rest, "onClick")}>
      <button type="button">
        {children} <span className="t-sort-icon"></span>
      </button>
    </th>
  );
}

const omit = <T extends object, K extends keyof T>(o: T, k: K): Omit<T, K> => { const c = { ...o }; delete c[k]; return c; };

/** Plain text of a React subtree (strings and numbers), like textContent. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/** `<tbody>`; inside a `<Table sortable>` it renders its rows in the current sort order. */
function TableBody({ children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  const ctx = useContext(TableContext);
  // rows keep their current order on ties (tailor.js sorts the rows as they stand in the DOM): remember the order
  const shown = useRef<Map<unknown, number>>(new Map());
  let rows: ReactNode = children;
  if (ctx?.sorts && ctx.sort) {
    const { key, dir } = ctx.sort, idx = ctx.cols.get(key) ?? -1;
    type G = { head: ReactNode | null; rows: ReactElement[] };
    const groups: G[] = []; let cur: G | null = null;
    for (const r of Children.toArray(children)) {
      if (isValidElement(r) && r.type === TableGroup) { cur = { head: r, rows: [] }; groups.push(cur); continue; }
      if (!cur) { cur = { head: null, rows: [] }; groups.push(cur); }
      if (isValidElement(r)) cur.rows.push(r);
    }
    const val = (r: ReactElement): string => {
      const p = r.props as Record<string, unknown>;
      if (p[`data-${key}`] !== undefined) return String(p[`data-${key}`]);
      const cells = Children.toArray(p.children as ReactNode).filter(isValidElement);
      const c = cells[idx] as ReactElement<Record<string, unknown>> | undefined;
      if (!c) return "";
      return c.props["data-sort-value"] !== undefined ? String(c.props["data-sort-value"]) : textOf(c.props.children as ReactNode).trim();
    };
    const cmp = (a: ReactElement, b: ReactElement) => {
      const x = val(a), y = val(b), nx = parseFloat(x), ny = parseFloat(y);
      const c = !isNaN(nx) && !isNaN(ny) ? nx - ny : x.localeCompare(y, undefined, { numeric: true });
      return dir === "ascending" ? c : -c;
    };
    const prev = shown.current, at = (r: ReactElement) => prev.get(r.key) ?? Infinity;
    rows = groups.flatMap((g) => [g.head, ...[...g.rows].sort((a, b) => at(a) - at(b)).sort(cmp)]);
  }
  // keys as Children.toArray gives them (the sort works on that form; rows without a sort are mapped the same way)
  const next = new Map<unknown, number>();
  (Array.isArray(rows) && ctx?.sort ? rows : Children.toArray(children)).forEach((r, i) => { if (isValidElement(r)) next.set(r.key, i); });
  useEffect(() => { shown.current = next; });
  return <tbody {...rest}>{rows}</tbody>;
}

type TdProps = TdHTMLAttributes<HTMLTableCellElement> & {
  num?: boolean;
  icon?: boolean;
  actions?: boolean;
  shrink?: boolean;
  /** Sort value of the cell (`data-sort-value`) when its text does not sort right. */
  "data-sort-value"?: string | number;
};

function Td({ num, icon, actions, shrink, className, children, ...rest }: TdProps) {
  const cls = cx(num && "t-col-num", icon && "t-col-icon", actions && "t-col-actions", shrink && "t-col-shrink", className) || undefined;
  return <td className={cls} {...rest}>{children}</td>;
}

type TableGroupProps = HTMLAttributes<HTMLTableRowElement> & { colSpan: number };

function TableGroup({ colSpan, className, children, ...rest }: TableGroupProps) {
  return (
    <tr className={cx("t-table-group", className)} {...rest}>
      <td colSpan={colSpan}>{children}</td>
    </tr>
  );
}

Table.Wrap = TableWrap;
Table.Body = TableBody;
Table.Th = Th;
Table.Td = Td;
Table.Group = TableGroup;

/* ── card ────────────────────────────────────────────────────────────────── */

const CardContext = createContext<{ collapsible: boolean }>({ collapsible: false });

type CardProps = HTMLAttributes<HTMLElement> & {
  /** Space-separated combinable variants: clickable, stat, thumb. */
  variant?: string;
  /** Render as `<details data-variant="collapsible">`; Card.Header becomes the summary. */
  collapsible?: boolean;
  open?: boolean;
  selected?: boolean;
};

export function Card({ variant, collapsible, open, selected, className, children, ...rest }: CardProps) {
  const shared = {
    className: cx("t-card", className),
    "data-variant": collapsible ? "collapsible" : dataAttr(variant),
    "aria-selected": selected,
    ...rest,
  };
  if (collapsible) {
    return (
      <CardContext value={{ collapsible: true }}>
        <details {...shared} open={open}>{children}</details>
      </CardContext>
    );
  }
  return <div {...shared}>{children}</div>;
}

function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  const { collapsible } = useContext(CardContext);
  if (collapsible) return <summary className={cx("t-card-header", className)} {...rest}>{children}</summary>;
  return <div className={cx("t-card-header", className)} {...rest}>{children}</div>;
}

function CardTitle({ className, children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cx("t-card-title", className)} {...rest}>{children}</h3>;
}

/** End slot of the header: actions/hints right of the title. */
function CardTools({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("t-card-tools", className)} {...rest}>{children}</div>;
}

function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("t-card-body", className)} {...rest}>{children}</div>;
}

type CardFooterProps = HTMLAttributes<HTMLDivElement> & { actions?: boolean };

function CardFooter({ actions, className, children, ...rest }: CardFooterProps) {
  return <div className={cx("t-card-footer", actions && "t-card-actions", className)} {...rest}>{children}</div>;
}

function CardActions({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("t-card-actions", className)} {...rest}>{children}</div>;
}

type CardThumbProps = HTMLAttributes<HTMLDivElement> & { ratio?: "square" };

function CardThumb({ ratio, className, children, ...rest }: CardThumbProps) {
  return <div className={cx("t-card-thumb", className)} data-ratio={dataAttr(ratio)} {...rest}>{children}</div>;
}

function CardMeta({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("t-card-meta", className)} {...rest}>{children}</div>;
}

Card.Header = CardHeader;
Card.Title = CardTitle;
Card.Tools = CardTools;
Card.Body = CardBody;
Card.Footer = CardFooter;
Card.Actions = CardActions;
Card.Thumb = CardThumb;
Card.Meta = CardMeta;

/** Two-column facts grid (`<dl class="t-facts">`). */
export function Facts({ className, children, ...rest }: HTMLAttributes<HTMLDListElement>) {
  return <dl className={cx("t-facts", className)} {...rest}>{children}</dl>;
}

/** Stat-card parts (card `data-variant="stat"`); `as="span"` for the inline label/value row. */
type StatPartProps = HTMLAttributes<HTMLElement> & { as?: "div" | "span" };
export function StatLabel({ as: Tag = "div", className, children, ...rest }: StatPartProps) {
  return <Tag className={cx("t-stat-label", className)} {...rest}>{children}</Tag>;
}
export function StatValue({ as: Tag = "div", className, children, ...rest }: StatPartProps) {
  return <Tag className={cx("t-stat-value", className)} {...rest}>{children}</Tag>;
}
export function StatSub({ as: Tag = "div", className, children, ...rest }: StatPartProps) {
  return <Tag className={cx("t-stat-sub", className)} {...rest}>{children}</Tag>;
}
type StatBoxProps = HTMLAttributes<HTMLDivElement> & { empty?: boolean };
export function StatBox({ empty, className, children, ...rest }: StatBoxProps) {
  return <div className={cx("t-stat-box", className)} data-empty={empty ? "" : undefined} {...rest}>{children}</div>;
}

/* ── empty state ─────────────────────────────────────────────────────────── */

type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  /** A string is a sprite icon name; a node renders as-is. */
  icon?: ReactNode;
  /** Heading (`.t-empty-title`); a compact (`size="sm"`) state often has none. */
  title?: ReactNode;
  actions?: ReactNode;
  size?: "sm";
};

export function EmptyState({ icon, title, actions, size, className, children, ...rest }: EmptyStateProps) {
  return (
    <div className={cx("t-empty", className)} data-size={dataAttr(size)} {...rest}>
      {iconSlot(icon, "t-empty-icon")}
      {title !== undefined && <h3 className="t-empty-title">{title}</h3>}
      {children}
      {actions !== undefined && <div className="t-empty-actions">{actions}</div>}
    </div>
  );
}

/* ── timeline ────────────────────────────────────────────────────────────── */

export function Timeline({ className, children, ...rest }: HTMLAttributes<HTMLOListElement>) {
  return <ol className={cx("t-timeline", className)} {...rest}>{children}</ol>;
}

type TimelineItemProps = HTMLAttributes<HTMLLIElement> & {
  tone?: Tone;
  solid?: boolean;
  /** The rail badge content (an icon/glyph). */
  badge?: ReactNode;
  condensed?: boolean;
};

function TimelineItem({ tone, solid, badge, condensed, className, children, ...rest }: TimelineItemProps) {
  return (
    <li className={cx("t-timeline-item", className)} data-density={condensed ? "condensed" : undefined} {...rest}>
      <span className="t-timeline-badge" data-tone={dataAttr(tone)} data-variant={solid ? "solid" : undefined}>
        {badge}
      </span>
      <div className="t-timeline-body">{children}</div>
    </li>
  );
}

function TimelineBreak({ className, ...rest }: HTMLAttributes<HTMLLIElement>) {
  return <li className={cx("t-timeline-break", className)} {...rest}></li>;
}

function TimelineCard({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("t-timeline-card", className)} {...rest}>{children}</div>;
}

Timeline.Item = TimelineItem;
Timeline.Break = TimelineBreak;
Timeline.Card = TimelineCard;

/* ── relative time ───────────────────────────────────────────────────────── */

/**
 * The text Tailor.relativeTime writes: "just now", "3 min ago", "2 h ago", "yesterday", "4 d ago", "in 1 h",
 * "tomorrow", then a short date ("Sep 21", with the year when it differs). Same strings as tailor.js.
 */
export function relativeTime(date: Date | string | number, now: Date | number = Date.now()): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  const nowMs = typeof now === "number" ? now : now.getTime();
  const diff = (d.getTime() - nowMs) / 1000, abs = Math.abs(diff), past = diff < 0;
  const fmt = (n: number, u: string) => (past ? `${n} ${u} ago` : `in ${n} ${u}`);
  if (abs < 45) return "just now";
  if (abs < 3600) return fmt(Math.round(abs / 60), "min");
  if (abs < 86400) return fmt(Math.round(abs / 3600), "h");
  const days = Math.round(abs / 86400);
  if (days === 1) return past ? "yesterday" : "tomorrow";
  if (days < 7) return fmt(days, "d");
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

type RelativeTimeProps = Omit<TimeHTMLAttributes<HTMLTimeElement>, "dateTime"> & {
  /** ISO 8601 string or Date. */
  datetime?: string | Date;
  /** Seconds before now (`data-ago`; negative = in the future); the time is fixed when the component mounts. */
  ago?: number;
  /** Tooltip; default the absolute local time (`toLocaleString()`), as tailor.js sets it. */
  tip?: string;
};

/**
 * `<time class="t-time" data-relative>` — the React Tailor.times. Children are the server/static fallback text
 * (an absolute date); after mount the text becomes `relativeTime()` (refreshed every minute) and `data-tip`
 * the absolute local time. With `ago` the `datetime` is filled in at mount, like tailor.js does for `data-ago`.
 */
export function RelativeTime({ datetime, ago, tip, className, children, ...rest }: RelativeTimeProps) {
  const [now, setNow] = useState<number | null>(null);
  const [base, setBase] = useState<Date | null>(null);
  useEffect(() => {
    setBase(ago !== undefined && datetime === undefined ? new Date(Date.now() - ago * 1000) : null);
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [ago, datetime instanceof Date ? datetime.getTime() : datetime]);
  const date = base ?? (datetime === undefined ? null : typeof datetime === "string" ? new Date(datetime) : datetime);
  const iso = datetime === undefined ? (base ? base.toISOString() : "") : typeof datetime === "string" ? datetime : datetime.toISOString();
  const live = now !== null && date !== null && !isNaN(date.getTime());
  return (
    <time
      className={cx("t-time", className)}
      data-relative=""
      dateTime={iso}
      data-ago={ago !== undefined ? String(ago) : undefined}
      data-tip={live ? tip ?? date.toLocaleString() : tip}
      {...rest}
    >
      {live ? relativeTime(date, now) : children}
    </time>
  );
}
