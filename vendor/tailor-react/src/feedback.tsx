/* managed by tailor v0.11.1 — tailor-react src/feedback.tsx — do not edit, run `tailor sync` */
// Feedback: tooltip, help-popover, code-block, truncate, alert, toast, dialog,
// confirm, progress, spinner — markup per core/components.json. The tailor.js
// behaviours (tooltips, help, copy, dismiss, toast, dialogs, confirm) are
// reimplemented as React state; UiProvider hosts the shared layers.
import {
  cloneElement, createContext, isValidElement, useCallback, useContext, useEffect,
  useRef, useState,
  type ButtonHTMLAttributes, type DialogHTMLAttributes, type HTMLAttributes,
  type MouseEvent, type ReactElement, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ICON_SPRITE, Icon, IconSpriteContext, iconSlot } from "./actions.tsx";
import { cx, dataAttr, type Tone } from "./util.ts";
import { mark, popup, randomId, useMounted } from "./popup.ts";

/* ── tooltip ─────────────────────────────────────────────────────────────── */

/**
 * Adds `data-tip`/`data-tip-at` to its single child element. The visible
 * tooltip is the shared `.t-tooltip` layer mounted by `UiProvider`.
 */
export function Tooltip({ tip, at, children }: { tip: string; at?: "top" | "bottom" | "left" | "right"; children: ReactElement }) {
  if (!isValidElement(children)) return children;
  return cloneElement(children as ReactElement<Record<string, unknown>>, {
    "data-tip": tip,
    "data-tip-at": at,
  });
}

/** Shared tooltip layer: one `.t-tooltip[role=tooltip]` for every `[data-tip]`. */
function TooltipLayer() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tipEl = ref.current;
    // tailor.js on the same page (mixed pages, the showcase) already draws every [data-tip]: stand down
    if (!tipEl || (window as { Tailor?: { tooltips?: unknown } }).Tailor?.tooltips) return;
    let anchor: HTMLElement | null = null;
    // a re-labelled anchor (the theme toggle after a click) repaints the open tooltip, like tailor.js refreshTip
    const relabel = new MutationObserver(() => { if (anchor) place(anchor); });
    const show = (e: Event) => {
      const t = (e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null;
      if (!t || t === anchor) return;
      anchor = t;
      relabel.disconnect(); relabel.observe(t, { attributes: true, attributeFilter: ["data-tip"] });
      place(t);
    };
    const place = (t: HTMLElement) => {
      tipEl.textContent = t.getAttribute("data-tip");
      tipEl.dataset.at = t.getAttribute("data-tip-at") ?? "top";
      const r = t.getBoundingClientRect();
      tipEl.hidden = false;
      const tr = tipEl.getBoundingClientRect();
      const at = tipEl.dataset.at;
      let top = r.top - tr.height - 6, left = r.left + r.width / 2 - tr.width / 2;
      if (at === "bottom") top = r.bottom + 6;
      if (at === "left") { top = r.top + r.height / 2 - tr.height / 2; left = r.left - tr.width - 6; }
      if (at === "right") { top = r.top + r.height / 2 - tr.height / 2; left = r.right + 6; }
      tipEl.style.top = `${Math.max(4, top + window.scrollY)}px`;
      tipEl.style.left = `${Math.max(4, left + window.scrollX)}px`;
    };
    const hide = (e: Event) => {
      if (!anchor) return;
      if (e.type === "mouseout" && anchor.contains((e as unknown as { relatedTarget: Node }).relatedTarget)) return;
      anchor = null;
      relabel.disconnect();
      tipEl.hidden = true;
    };
    document.addEventListener("mouseover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("mouseout", hide);
    document.addEventListener("focusout", hide);
    return () => {
      document.removeEventListener("mouseover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("mouseout", hide);
      document.removeEventListener("focusout", hide);
      relabel.disconnect();
    };
  }, []);
  return <div ref={ref} className="t-tooltip" role="tooltip" hidden style={{ position: "absolute" }}></div>;
}

/* ── help popover ────────────────────────────────────────────────────────── */

export type HelpProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "accent" | "info" | "danger";
  /** Accessible label of the trigger ("About heartbeat"). */
  label?: string;
  /** Trigger glyph. */
  glyph?: ReactNode;
};

/**
 * `<Ui.Help>` — the React Tailor.help: hovering the trigger 1 s shows the box (it closes when the pointer leaves
 * both); a click pins it as the current popup (one open at a time, Escape or a pointerdown outside close it,
 * `data-at`/`data-align` flip and align it like every tailor popup); a second click unpins it.
 */
export function Help({ tone, label, glyph = "i", className, children, ...rest }: HelpProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [boxId] = useState(() => randomId("t-help"));
  const mounted = useMounted();
  const btn = useRef<HTMLButtonElement>(null), box = useRef<HTMLDivElement>(null);
  const st = useRef({ open, pinned }); st.current = { open, pinned };
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const close = () => {
    setOpen(false); setPinned(false); st.current = { open: false, pinned: false };
    const b = box.current; if (b) { b.hidden = true; delete b.dataset.at; delete b.dataset.align; }
  };
  const closeHover = () => { if (!st.current.pinned) close(); };
  const pin = () => {
    setPinned(true); setOpen(true); st.current = { open: true, pinned: true };
    if (box.current && btn.current) popup.open(box.current, btn.current, close);
  };
  const unpin = () => (popup.current()?.panel === box.current ? popup.close() : close());
  useEffect(() => {
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") closeHover(); }; // hover-shown boxes; pinned ones close via the popup
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("keydown", esc); clearTimeout(timer.current); if (popup.current()?.panel === box.current) popup.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span className={cx("t-help", className)} data-tone={dataAttr(tone)} {...mark(mounted, "help")} {...rest}>
      <button
        ref={btn}
        className="t-help-btn"
        type="button"
        aria-expanded={open}
        aria-label={label}
        aria-controls={mounted ? boxId : undefined}
        onClick={() => { clearTimeout(timer.current); if (st.current.pinned) unpin(); else pin(); }}
        onMouseEnter={() => { timer.current = setTimeout(() => { if (!st.current.open) { setOpen(true); st.current.open = true; } }, 1000); }}
        onMouseLeave={() => { clearTimeout(timer.current); setTimeout(() => { if (!st.current.pinned && !box.current?.matches(":hover")) closeHover(); }, 200); }}
      >
        {glyph}
      </button>
      <div
        ref={box}
        className="t-help-box"
        hidden={!open}
        id={mounted ? boxId : undefined}
        data-pinned={pinned ? "" : undefined}
        onMouseLeave={closeHover}
      >
        {children}
      </div>
    </span>
  );
}

/* ── code block ──────────────────────────────────────────────────────────── */

type CodeProps = HTMLAttributes<HTMLDivElement> & {
  /** Tab labels (`.t-code-tabs`). With one `Code.Pre` child per tab the shown block follows the tab; with a single
   * child it stays, and `onTabChange` updates it (what tailor.js's `t:change` is for). */
  tabs?: ReactNode[];
  defaultTab?: number;
  onTabChange?: (index: number) => void;
};

export function Code({ tabs, defaultTab = 0, onTabChange, className, children, ...rest }: CodeProps) {
  const [active, setActive] = useState(defaultTab);
  const mounted = useMounted();
  const kids = Array.isArray(children) ? children : [children];
  return (
    <div className={cx("t-code", className)} {...rest}>
      {tabs && (
        <div className="t-code-tabs" role="tablist" {...mark(mounted, "code-tabs")}>
          {tabs.map((t, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === active} onClick={() => { setActive(i); onTabChange?.(i); }}>{t}</button>
          ))}
        </div>
      )}
      {tabs && kids.length > 1 ? kids[active] : children}
    </div>
  );
}

type CodePreProps = HTMLAttributes<HTMLPreElement> & {
  variant?: "shell" | "json";
  /** Render the corner copy button (the React Tailor.copy). */
  copy?: boolean;
  copyLabel?: string;
};

function CodePre({ variant, copy, copyLabel = "Copy", className, children, ...rest }: CodePreProps) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const mounted = useMounted();
  const toasts = useOptionalToasts();
  const doCopy = () => {
    const pre = ref.current;
    if (!pre) return;
    // same text as Tailor.copy: no copy button, no prompt, no leading blank, shell line continuations joined
    const clone = pre.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".t-code-copy, .t-tok-prompt").forEach((n) => n.remove());
    const txt = clone.innerText.replace(/^\s*/, "").replace(/\\\n\s*/g, "");
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject(new Error("no clipboard"))).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1200); },
      () => toasts?.toast("warning", "clipboard unavailable"),
    );
  };
  return (
    <pre ref={ref} className={cx("t-code-pre", className)} data-variant={dataAttr(variant)} {...rest}>
      {copy && (
        <button
          className="t-code-copy"
          type="button"
          aria-label={copyLabel}
          data-copied={copied ? "" : undefined}
          onClick={doCopy}
          {...mark(mounted, "copy")}
        >
          ⧉
        </button>
      )}
      {children}
    </pre>
  );
}

/** Syntax token (`t-tok-<kind>`). */
function Tok({ t, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & {
  t: "prompt" | "cmd" | "flag" | "str" | "url" | "key" | "num" | "bool";
}) {
  return <span className={cx(`t-tok-${t}`, className)} {...rest}>{children}</span>;
}

Code.Pre = CodePre;
Code.Tok = Tok;

/* ── truncate ────────────────────────────────────────────────────────────── */

type TruncateProps = Omit<HTMLAttributes<HTMLSpanElement>, "title"> & {
  /** Click-to-expand (`data-expand` + aria-expanded toggle). */
  expand?: boolean;
  /** Tooltip text (`data-tip`, the full value or "click to expand"); never `title=`. */
  tip?: string;
};

export function Truncate({ expand, tip, className, children, onClick, onKeyDown, ...rest }: TruncateProps) {
  const [expanded, setExpanded] = useState(false);
  const mounted = useMounted();
  if (!expand) {
    return <span className={cx("t-truncate", className)} data-tip={tip} onClick={onClick} onKeyDown={onKeyDown} {...rest}>{children}</span>;
  }
  // keyboard reach (tabindex + role=button, Enter / Space) comes with the behaviour, after mount
  return (
    <span
      className={cx("t-truncate", className)}
      data-expand=""
      data-tip={tip}
      aria-expanded={expanded}
      {...(mounted ? { tabIndex: 0, role: "button", "data-t-trunc": "" } : {})}
      onClick={(e) => { setExpanded((v) => !v); onClick?.(e); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((v) => !v); } onKeyDown?.(e); }}
      {...rest}
    >
      {children}
    </span>
  );
}

/* ── alert ───────────────────────────────────────────────────────────────── */

type AlertProps = HTMLAttributes<HTMLDivElement> & {
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  size?: "sm";
  /** A string is a sprite icon name; a node renders as-is. */
  icon?: ReactNode;
  actions?: ReactNode;
  /** Renders the dismiss button; called when the alert is dismissed. */
  onDismiss?: () => void;
  /** Renders the dismiss button without a callback (the alert removes itself, like `data-dismiss`). */
  dismissible?: boolean;
  dismissLabel?: string;
};

/** `role` defaults to `alert`; pass `role="status"` for info/success, `role={undefined}` for a neutral flash. */
export function Alert({ tone, size, icon, actions, onDismiss, dismissible, dismissLabel = "Dismiss", className, children, ...rest }: AlertProps) {
  const [dismissed, setDismissed] = useState(false);
  const mounted = useMounted();
  if (dismissed) return null;
  return (
    <div className={cx("t-alert", className)} data-tone={dataAttr(tone)} data-size={dataAttr(size)} role="alert" {...rest}>
      {iconSlot(icon, "t-alert-icon")}
      <div className="t-alert-body">{children}</div>
      {actions !== undefined && <div className="t-alert-actions">{actions}</div>}
      {(onDismiss || dismissible) && (
        <button
          className="t-alert-close"
          aria-label={dismissLabel}
          data-dismiss=""
          {...mark(mounted, "dismiss")}
          onClick={() => { setDismissed(true); onDismiss?.(); }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/* ── toast ───────────────────────────────────────────────────────────────── */

const TOAST_ICONS: Record<string, string> = {
  success: "bi-check-circle", warning: "bi-exclamation-triangle", danger: "bi-x-circle", info: "bi-info-circle",
};

export type ToastTone = "success" | "warning" | "danger" | "info";

type ToastProps = HTMLAttributes<HTMLDivElement> & {
  tone: ToastTone;
  leaving?: boolean;
};

/** One toast (presentational). Normally created via `useToasts()`. */
export function Toast({ tone, leaving, className, children, ...rest }: ToastProps) {
  return (
    <div className={cx("t-toast", className)} data-tone={tone} data-leaving={leaving ? "" : undefined} role="status" {...rest}>
      <Icon name={TOAST_ICONS[tone] ?? "bi-info-circle"} className="t-toast-icon" />
      <span className="t-toast-body">{children}</span>
    </div>
  );
}

/** The fixed stack region (one per page, `#t-toasts`). */
export function ToastRegion({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("t-toasts", className)} id="t-toasts" aria-live="polite" aria-atomic="false" {...rest}>
      {children}
    </div>
  );
}

Toast.Region = ToastRegion;

type ToastEntry = { id: number; tone: ToastTone; message: ReactNode; leaving: boolean };

type ToastApi = {
  /** `toast(tone, message, {timeout})` — the React Tailor.toast. */
  toast: (tone: ToastTone | "error", message: ReactNode, opts?: { timeout?: number }) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** `useToasts()` without the provider requirement: null outside a `<UiProvider>` (components that toast optionally). */
export function useOptionalToasts(): ToastApi | null {
  return useContext(ToastContext);
}

export function useToasts(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts() needs a <UiProvider> ancestor");
  return ctx;
}

/* ── dialog ──────────────────────────────────────────────────────────────── */

export type DialogProps = Omit<DialogHTMLAttributes<HTMLDialogElement>, "title"> & {
  open?: boolean;
  onClose?: (returnValue: string) => void;
  title?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  tone?: "danger";
  footer?: ReactNode;
  /** Render as a drawer (`.t-drawer`) instead of a dialog. */
  drawer?: boolean;
  closeLabel?: string;
};

/**
 * Modal dialog over `<dialog class="t-dialog">`: `open` drives
 * showModal()/close(), backdrop click and Esc call `onClose` — the React
 * Tailor.dialogs. Any button with `data-dialog-close="<value>"` inside closes it with that return value
 * (`onClose(value)`); footer buttons may also close by calling `onClose` themselves.
 */
export function Dialog({
  open, onClose, title, size, tone, footer, drawer, closeLabel = "Close",
  className, children, id, ...rest
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const mounted = useMounted();
  const titleId = id ? `${id}-title` : undefined;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);
  const onNativeClose = () => { if (open) onClose?.(ref.current?.returnValue ?? ""); };
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    const el = ref.current; if (!el) return;
    if (e.target === el) { el.close(""); return; }
    const c = (e.target as Element).closest<HTMLElement>("[data-dialog-close]");
    if (c && el.contains(c)) el.close(c.dataset.dialogClose || "");
  };
  return (
    <dialog
      ref={ref}
      className={cx(drawer ? "t-drawer" : "t-dialog", className)}
      id={id}
      data-size={dataAttr(size, "md")}
      data-tone={dataAttr(tone)}
      aria-labelledby={titleId}
      onClose={onNativeClose}
      onClick={onBackdrop}
      {...mark(mounted, "dlg")}
      {...rest}
    >
      {title !== undefined && (
        <div className="t-dialog-header">
          <h2 className="t-dialog-title" id={titleId}>{title}</h2>
          <button className="t-dialog-close" aria-label={closeLabel} data-dialog-close="">×</button>
        </div>
      )}
      <div className="t-dialog-body">{children}</div>
      {footer !== undefined && <div className="t-dialog-footer">{footer}</div>}
    </dialog>
  );
}

/* ── confirm ─────────────────────────────────────────────────────────────── */

type ConfirmState = {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  label: ReactNode;
  danger: boolean;
  resolve?: (ok: boolean) => void;
};

type ConfirmApi = {
  /** `confirm(title, body, {label, danger})` → Promise<boolean> — the React Tailor.confirm. */
  confirm: (title: ReactNode, body?: ReactNode, opts?: { label?: ReactNode; danger?: boolean }) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmApi | null>(null);

export function useConfirm(): ConfirmApi["confirm"] {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm() needs a <UiProvider> ancestor");
  return ctx.confirm;
}

/** The tailor confirm dialog (presentational; `useConfirm()` drives it). */
export function Confirm({
  open, title = "Are you sure?", label = "Confirm", danger = true, onResult, children,
}: {
  open?: boolean;
  title?: ReactNode;
  label?: ReactNode;
  danger?: boolean;
  onResult?: (ok: boolean) => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const result = useRef(false);
  const mounted = useMounted();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) { result.current = false; el.showModal(); }
    else if (!open && el.open) el.close();
  }, [open]);
  const close = (ok: boolean) => { result.current = ok; ref.current?.close(); };
  return (
    <dialog
      ref={ref}
      className="t-dialog"
      id="t-confirm"
      data-variant="confirm"
      data-tone={danger ? "danger" : "neutral"}
      aria-labelledby="t-confirm-title"
      {...mark(mounted, "dlg")}
      onClose={() => { if (open) onResult?.(result.current); }}
      onClick={(e) => { if (e.target === ref.current) close(false); }}
    >
      <div className="t-dialog-header">
        <h2 className="t-dialog-title" id="t-confirm-title"><Icon name={danger ? "bi-exclamation-triangle" : "bi-question-circle"} /><span>{title}</span></h2>
        <button className="t-dialog-close" aria-label="Close" data-dialog-close="" onClick={() => close(false)}>×</button>
      </div>
      <div className="t-dialog-body" id="t-confirm-body">{children}</div>
      <div className="t-dialog-footer">
        <button className="t-btn" data-dialog-close="" onClick={() => close(false)}>Cancel</button>
        <button className="t-btn" data-variant={danger ? "danger" : "primary"} id="t-confirm-ok" onClick={() => close(true)}>
          {label}
        </button>
      </div>
    </dialog>
  );
}

/* ── progress / spinner ──────────────────────────────────────────────────── */

type ProgressProps = HTMLAttributes<HTMLDivElement> & {
  /** 0–100; renders the single bar + progressbar aria. Omit for stacked bars. */
  value?: number;
  min?: number;
  max?: number;
  size?: "sm" | "md" | "lg";
  stacked?: boolean;
  tone?: Tone;
  /** Text inside the single bar (`data-size="lg"` bars have room for "38 %"). */
  label?: ReactNode;
};

export function Progress({ value, min = 0, max = 100, size, stacked, tone, label, className, children, ...rest }: ProgressProps) {
  return (
    <div
      className={cx("t-progress", className)}
      data-variant={stacked ? "stacked" : undefined}
      data-size={dataAttr(size, "md")}
      role={value !== undefined ? "progressbar" : undefined}
      aria-valuenow={value}
      aria-valuemin={value !== undefined ? min : undefined}
      aria-valuemax={value !== undefined ? max : undefined}
      {...rest}
    >
      {value !== undefined && (
        <div className="t-progress-bar" data-tone={dataAttr(tone)} style={{ "--t-value": `${value}%` } as never}>{label}</div>
      )}
      {children}
    </div>
  );
}

type ProgressBarProps = HTMLAttributes<HTMLDivElement> & {
  value: number;
  tone?: Tone;
  tip?: string;
};

function ProgressBar({ value, tone, tip, className, ...rest }: ProgressBarProps) {
  return (
    <div
      className={cx("t-progress-bar", className)}
      data-tone={dataAttr(tone)}
      data-tip={tip}
      style={{ "--t-value": `${value}%` } as never}
      {...rest}
    ></div>
  );
}

Progress.Bar = ProgressBar;

type SpinnerProps = HTMLAttributes<HTMLSpanElement> & {
  size?: "sm" | "md" | "lg";
  tone?: Tone;
  /** aria-label; pass `null` when adjacent text already labels it. */
  label?: string | null;
};

export function Spinner({ size, tone, label = "Loading", className, ...rest }: SpinnerProps) {
  return (
    <span
      className={cx("t-spinner", className)}
      data-size={dataAttr(size, "md")}
      data-tone={dataAttr(tone)}
      role="status"
      aria-label={label ?? undefined}
      {...rest}
    ></span>
  );
}

/* ── UiProvider ──────────────────────────────────────────────────────────── */

let toastSeq = 0;

/**
 * Mounts the shared layers (toast region, tooltip layer, confirm dialog) and
 * provides `useToasts()` / `useConfirm()`. Wrap the app once; no tailor.js.
 */
export function UiProvider({ children, sprite }: { children: ReactNode; /** Icon sprite URL for `<Ui.Icon name>` (default `/tailor/icons.svg`). */ sprite?: string }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false, title: "", body: "", label: "Confirm", danger: true,
  });

  const leave = useCallback((id: number) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 600);
  }, []);

  const toast = useCallback<ToastApi["toast"]>((tone, message, { timeout = 2500 } = {}) => {
    const id = ++toastSeq;
    setToasts((ts) => [...ts, { id, tone: tone === "error" ? "danger" : tone, message, leaving: false }]);
    if (timeout > 0) setTimeout(() => leave(id), timeout);
  }, [leave]);

  // like Tailor.toast: a page that already has the region (`#t-toasts`, e.g. from its HTML) gets the toasts in it;
  // otherwise the provider renders its own (one region per page, one id)
  const [region, setRegion] = useState<HTMLElement | null | undefined>(undefined);
  useEffect(() => { setRegion(document.getElementById("t-toasts")); }, []);
  const toastList = toasts.map((t) => (
    <Toast key={t.id} tone={t.tone} leaving={t.leaving} onClick={() => leave(t.id)}>
      {t.message}
    </Toast>
  ));

  const confirm = useCallback<ConfirmApi["confirm"]>((title, body, { label = "Confirm", danger = true } = {}) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ open: true, title, body, label, danger, resolve });
    });
  }, []);

  return (
    <IconSpriteContext value={sprite ?? ICON_SPRITE}>
    <ToastContext value={{ toast }}>
      <ConfirmContext value={{ confirm }}>
        {children}
        {typeof document !== "undefined" && createPortal(
          <>
            {region === null && <ToastRegion>{toastList}</ToastRegion>}
            <TooltipLayer />
            {confirmState.open && <Confirm
              open={confirmState.open}
              title={confirmState.title}
              label={confirmState.label}
              danger={confirmState.danger}
              onResult={(ok) => {
                confirmState.resolve?.(ok);
                setConfirmState((s) => ({ ...s, open: false, resolve: undefined }));
              }}
            >
              {confirmState.body}
            </Confirm>}
          </>,
          document.body,
        )}
        {region && createPortal(toastList, region)}
      </ConfirmContext>
    </ToastContext>
    </IconSpriteContext>
  );
}

export type { ButtonHTMLAttributes };
