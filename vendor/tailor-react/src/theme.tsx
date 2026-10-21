/* managed by tailor v0.11.0 — tailor-react src/theme.tsx — do not edit, run `tailor sync` */
// Theme switcher for React pages: the React Tailor.theme (core/tailor.js) — skin × palette × mode, same
// semantics, same <html> data-* attributes, same <link id="t-skin|t-palette"> re-pointing, same localStorage keys
// and the same bubbling `t:theme` event, so React apps get every skin and palette without loading tailor.js.
//
//   import { useTailorTheme, Pickers } from "tailor-react/theme";   // or Ui.Pickers from "tailor-react"
//
// Config defaults to window.TAILOR_CONFIG (set by the vendored tailor-head.html, `tailor apply --react`).
// One state per page: a module-level store read through useSyncExternalStore; the source of truth is
// <html data-skin data-palette data-mode data-mode-choice> (what the pre-paint snippet writes first).
// When tailor.js is on the page too (window.Tailor.theme), set() delegates to it and the store follows its
// `t:theme` events, so mixed pages stay in one state. Nothing touches window at import time (SSR-safe).
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type HTMLAttributes, type KeyboardEvent,
} from "react";
import { Icon } from "./actions.tsx";
import { cx } from "./util.ts";

export type ThemeMode = "dark" | "light";
export type ModeChoice = ThemeMode | "auto";

/** What the head snippet puts in window.TAILOR_CONFIG (and what Tailor.theme.init takes). */
export type TailorThemeConfig = {
  project: string;
  /** Vendored asset root (`/tailor/`); icons default to `<base>icons.svg`. */
  base?: string;
  skins: string[];
  palettes: string[];
  /** Palette id → the modes it offers. */
  modes: Record<string, string[]>;
  labels?: { skins?: Record<string, string>; palettes?: Record<string, string>; kits?: Record<string, string> };
  defaults: { skin: string; palette: string; mode: ModeChoice; kit?: string };
  icons?: string;
  /** Renderings of the vocabulary to choose from (the showcase's Kit picker); absent on app pages. */
  kits?: string[];
};

export type TailorThemeState = {
  skin: string;
  palette: string;
  /** Resolved mode (what `data-mode` says). */
  mode: ThemeMode;
  /** What the user picked: dark, light or auto (follows prefers-color-scheme). */
  choice: ModeChoice;
  /** `<html data-kit>` when a kit is set (the showcase's Kit picker). */
  kit?: string;
};

export type TailorThemeChange = Partial<{ skin: string; palette: string; mode: ModeChoice; kit: string }>;
export type TailorThemeSetOptions = { persist?: boolean };

export type TailorTheme = TailorThemeState & {
  set: (change: TailorThemeChange, opts?: TailorThemeSetOptions) => void;
  config: TailorThemeConfig;
};

/* ── config ──────────────────────────────────────────────────────────────── */

// Same fallback as Tailor.theme's own defaults.
const FALLBACK: TailorThemeConfig = {
  project: "tailor", skins: ["none"], palettes: ["dracula"], modes: { dracula: ["dark", "light"] },
  defaults: { skin: "none", palette: "dracula", mode: "dark" },
};

type TailorJsTheme = Partial<TailorThemeConfig> & {
  set: (change: TailorThemeChange, opts?: TailorThemeSetOptions) => void;
  get: () => TailorThemeState;
};
type PageGlobals = { TAILOR_CONFIG?: Partial<TailorThemeConfig>; Tailor?: { theme?: TailorJsTheme } };

const browser = () => typeof window !== "undefined" && typeof document !== "undefined";
const page = () => window as unknown as PageGlobals;
/** tailor.js's Tailor.theme when it is on the page (the store then delegates to it). */
const tailorJs = (): TailorJsTheme | undefined => (browser() ? page().Tailor?.theme : undefined);

let explicit: Partial<TailorThemeConfig> | null = null;
let cfgCache: { src: unknown; sig: string; cfg: TailorThemeConfig } | null = null;

function normalise(src: Partial<TailorThemeConfig> | null | undefined): TailorThemeConfig {
  const c = { ...FALLBACK, ...(src ?? {}) } as TailorThemeConfig;
  c.defaults = { ...FALLBACK.defaults, ...(src?.defaults ?? {}) };
  if (c.icons === undefined && c.base) c.icons = c.base + "icons.svg";
  return c;
}

function currentConfig(): TailorThemeConfig {
  const src = tailorJs() ?? (browser() ? explicit ?? page().TAILOR_CONFIG : explicit);
  // Tailor.theme is mutated in place by init(): the signature catches that without re-normalising every read
  const sig = src ? [src.project, src.base, src.icons, src.skins?.length, src.palettes?.length, src.kits?.length].join("|") : "";
  if (!cfgCache || cfgCache.src !== src || cfgCache.sig !== sig) cfgCache = { src, sig, cfg: normalise(src) };
  return cfgCache.cfg;
}

/* ── the store ───────────────────────────────────────────────────────────── */

const key = (c: TailorThemeConfig, k: string) => `${c.project}.${k}`;
const save = (c: TailorThemeConfig, k: string, v: string) => { try { localStorage.setItem(key(c, k), v); } catch { /* storage blocked */ } };
const load = (c: TailorThemeConfig, k: string) => { try { return localStorage.getItem(key(c, k)); } catch { return null; } };
const prefersLight = () => matchMedia("(prefers-color-scheme: light)").matches;
const asMode = (m: string | undefined, d: ModeChoice): ModeChoice => (m === "dark" || m === "light" || m === "auto" ? m : d);

/** auto → prefers-color-scheme, then clamped to what the palette offers. */
function resolveMode(c: TailorThemeConfig, choice: ModeChoice, palette: string): ThemeMode {
  const modes = c.modes[palette] ?? ["dark"];
  const m = choice === "auto" ? (browser() && prefersLight() ? "light" : "dark") : choice;
  return (modes.includes(m) ? m : modes[0]) === "light" ? "light" : "dark";
}

function read(): TailorThemeState {
  const c = currentConfig(), d = document.documentElement.dataset;
  const palette = d.palette || c.defaults.palette;
  const choice = asMode(d.modeChoice || d.mode, c.defaults.mode);
  const mode = d.mode === "light" || d.mode === "dark" ? d.mode : resolveMode(c, choice, palette);
  return { skin: d.skin || c.defaults.skin, palette, mode, choice, kit: d.kit || undefined };
}

function ownSet(change: TailorThemeChange, { persist = true }: TailorThemeSetOptions = {}): void {
  const c = currentConfig(), html = document.documentElement, d = html.dataset, cur = read();
  const { skin, palette, mode, kit } = change;
  if (kit !== undefined && c.kits?.includes(kit)) { d.kit = kit; if (persist) save(c, "kit", kit); }
  if (skin !== undefined && c.skins.includes(skin)) { d.skin = skin; if (persist) save(c, "skin", skin); }
  if (palette !== undefined && c.palettes.includes(palette)) { d.palette = palette; if (persist) save(c, "palette", palette); }
  if (mode !== undefined && /^(dark|light|auto)$/.test(mode)) { d.modeChoice = mode; if (persist) save(c, "mode", mode); }
  const next = read();
  d.mode = resolveMode(c, next.choice, next.palette);
  const ls = document.getElementById("t-skin") as HTMLLinkElement | null;
  if (ls) {
    const off = next.skin === "none";
    const href = off ? "" : (ls.dataset.base ?? "") + next.skin + "/skin.css";
    if (ls.getAttribute("href") !== href) ls.setAttribute("href", href);
    ls.disabled = off;
  }
  const lp = document.getElementById("t-palette") as HTMLLinkElement | null;
  if (lp) { const href = (lp.dataset.base ?? "") + next.palette + ".css"; if (lp.getAttribute("href") !== href) lp.setAttribute("href", href); }
  const after = read();
  if (cur.skin !== after.skin || cur.palette !== after.palette || cur.mode !== after.mode || cur.kit !== after.kit)
    html.dispatchEvent(new CustomEvent("t:theme", { bubbles: true, detail: { ...after, kit: after.kit ?? c.defaults.kit ?? "tailor" } }));
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
let started = false;

function start(): void {
  if (started || !browser()) return;
  started = true;
  document.documentElement.addEventListener("t:theme", notify);
  if (tailorJs()) return; // tailor.js already resolved the first state and follows prefers-color-scheme
  const c = currentConfig(), q = new URLSearchParams(location.search);
  const pick = (k: "skin" | "palette" | "mode" | "kit") => q.get(k) || load(c, k) || c.defaults[k];
  ownSet({ skin: pick("skin"), palette: pick("palette"), mode: asMode(pick("mode") ?? undefined, c.defaults.mode), kit: c.kits ? pick("kit") ?? undefined : undefined }, { persist: false });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (read().choice === "auto") ownSet({}); });
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  start();
  return () => { listeners.delete(fn); };
}

let snap: TailorThemeState | null = null;
function getSnapshot(): TailorThemeState {
  const s = read();
  if (snap && snap.skin === s.skin && snap.palette === s.palette && snap.mode === s.mode && snap.choice === s.choice && snap.kit === s.kit) return snap;
  return (snap = s);
}

let serverSnap: { cfg: TailorThemeConfig; s: TailorThemeState } | null = null;
function getServerSnapshot(): TailorThemeState {
  const c = currentConfig();
  if (serverSnap?.cfg !== c) serverSnap = { cfg: c, s: { skin: c.defaults.skin, palette: c.defaults.palette, mode: resolveMode(c, c.defaults.mode, c.defaults.palette), choice: c.defaults.mode, kit: c.defaults.kit } };
  return serverSnap.s;
}

/** Change the theme from anywhere (event handlers, non-React code). Delegates to tailor.js when it is loaded. */
export function setTailorTheme(change: TailorThemeChange, opts?: TailorThemeSetOptions): void {
  if (!browser()) return;
  const T = tailorJs();
  if (T) T.set(change, opts); else { start(); ownSet(change, opts); }
  notify();
}

/** True when tailor.js's Tailor.theme drives the page (the React store follows it). */
export const themeDelegated = (): boolean => tailorJs() !== undefined;

/**
 * `useTailorTheme(config?)` → `{ skin, palette, mode, choice, kit?, set, config }`.
 * Config defaults to `window.TAILOR_CONFIG`; the first config passed wins (one theme per page).
 */
export function useTailorTheme(config?: Partial<TailorThemeConfig>): TailorTheme {
  if (config && !explicit) explicit = config;
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const cfg = currentConfig();
  return useMemo(() => ({ ...state, set: setTailorTheme, config: cfg }), [state, cfg]);
}

/** Picker options for one part: every id the config offers, sorted by label; the "none" skin last as "No skin". */
export function themeOptions(c: TailorThemeConfig, what: "skin" | "palette"): Array<[string, string]> {
  const labels = (what === "skin" ? c.labels?.skins : c.labels?.palettes) ?? {};
  const ids = (what === "skin" ? c.skins : c.palettes).filter((id) => id !== "none");
  const rows = ids.map((id): [string, string] => [id, labels[id] || id]).sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }));
  if (what === "skin" && c.skins.includes("none")) rows.push(["none", "No skin"]);
  return rows;
}

/** The sun/moon toggle's target mode and label ("Switch to light mode", "Dark only" when the palette has one mode). */
export function modeToggle(t: Pick<TailorThemeState, "mode" | "palette">, c: TailorThemeConfig): { to: ThemeMode; enabled: boolean; label: string } {
  const to: ThemeMode = t.mode === "light" ? "dark" : "light";
  const enabled = (c.modes[t.palette] ?? ["dark"]).includes(to);
  return { to, enabled, label: enabled ? `Switch to ${to} mode` : `${t.mode === "light" ? "Light" : "Dark"} only` };
}

/* ── drawn select (private): the markup Tailor.selects draws over a native <select> ── */

const useIsoLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

type DrawnSelectProps = { label: string; size: "xs" | "sm"; value: string; options: Array<[string, string]>; onChange: (v: string) => void; disabled?: boolean };

function DrawnSelect({ label, size, value, options, onChange, disabled }: DrawnSelectProps) {
  const listId = `t-sel-${useId().replace(/[^\w-]/g, "")}-list`;
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null), list = useRef<HTMLUListElement>(null);
  const typed = useRef({ s: "", at: 0 });
  const index = options.findIndex(([v]) => v === value);
  const items = () => [...(list.current?.querySelectorAll<HTMLButtonElement>("[role=option]:not(:disabled)") ?? [])];
  const close = (focus = false) => { setOpen(false); if (focus) btn.current?.focus(); };
  const pick = (i: number) => { const o = options[i]; if (o && o[0] !== value) onChange(o[0]); close(true); };

  // place like T.popup: above the trigger when it does not fit below, hung off the right edge near it
  useIsoLayoutEffect(() => {
    const l = list.current, b = btn.current;
    if (!l || !b) return;
    if (!open) { delete l.dataset.at; delete l.dataset.align; return; }
    const r = b.getBoundingClientRect(), h = l.offsetHeight, w = l.offsetWidth;
    l.dataset.at = r.bottom + h + 8 > innerHeight && r.top - h - 8 > 0 ? "top" : "bottom";
    if (r.left + w > innerWidth - 8) l.dataset.align = "end"; else delete l.dataset.align;
    (items().find((x) => x.getAttribute("aria-selected") === "true") ?? items()[0])?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!list.current?.contains(t) && !btn.current?.contains(t)) close(); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") close(true); };
    document.addEventListener("pointerdown", down); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", esc); };
  }, [open]);

  const typeAhead = (k: string, from: number) => {
    const now = Date.now(), t = typed.current; t.s = now - t.at < 600 ? t.s + k : k; t.at = now;
    const start = t.s.length > 1 ? from : from + 1;
    for (let n = 0; n < options.length; n++) { const i = (start + n + options.length) % options.length; if (options[i]![1].toLowerCase().startsWith(t.s.toLowerCase())) return i; }
    return -1;
  };
  const onBtnKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (e.altKey) setOpen(true); else { const i = Math.min(Math.max(index + (e.key === "ArrowDown" ? 1 : -1), 0), options.length - 1); if (i !== index) onChange(options[i]![0]); } }
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); setOpen(true); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { const i = typeAhead(e.key, index); if (i >= 0 && i !== index) onChange(options[i]![0]); }
  };
  const onListKey = (e: KeyboardEvent) => {
    const its = items(), i = its.indexOf(document.activeElement as HTMLButtonElement);
    const go = (j: number) => { its[j]?.focus(); btn.current?.setAttribute("aria-activedescendant", its[j]?.id ?? ""); };
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); go((i + (e.key === "ArrowDown" ? 1 : -1) + its.length) % its.length); }
    else if (e.key === "Home" || e.key === "End") { e.preventDefault(); go(e.key === "Home" ? 0 : its.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (i >= 0) pick(Number(its[i]!.dataset.index)); }
    else if (e.key === "Tab") close();
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { const k = typeAhead(e.key, i >= 0 ? Number(its[i]!.dataset.index) : -1); if (k >= 0) go(its.findIndex((x) => Number(x.dataset.index) === k)); }
  };

  return (
    <span className="t-select-wrap">
      <button
        ref={btn} type="button" className="t-select t-select-btn" data-size={size}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={label} disabled={disabled}
        onClick={() => setOpen(!open)} onKeyDown={onBtnKey}
      >
        {options[index]?.[1] ?? "\u00a0"}
      </button>
      <ul ref={list} className="t-menu-list t-select-list" role="listbox" id={listId} tabIndex={-1} hidden={!open} onKeyDown={onListKey}>
        {options.map(([v, l], i) => (
          <li key={v}>
            <button type="button" className="t-menu-item" role="option" id={`${listId}-${i}`} data-index={i} aria-selected={v === value} onClick={() => pick(i)}>{l}</button>
          </li>
        ))}
      </ul>
    </span>
  );
}

/* ── pickers ─────────────────────────────────────────────────────────────── */

export type PickerPart = "skin" | "palette" | "mode";

export type PickersProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  /** Which controls (default all three); the order is fixed: skin, palette, then the mode toggle last. */
  parts?: PickerPart[];
  /** `xs` inside a `.t-footer` (the footer is --t-footer-h tall), `sm` elsewhere (default). */
  size?: "xs" | "sm";
  /** Theme config; defaults to window.TAILOR_CONFIG. */
  config?: Partial<TailorThemeConfig>;
};

/**
 * `<Ui.Pickers>` — the markup Tailor.theme.renderPickers + paintPickers produce: `.t-pickers` with drawn skin
 * and palette selects (only when there is a choice) and the sun/moon mode toggle last. Icons come from the
 * `<Ui.Provider sprite>` sprite (`bi-sun` / `bi-moon-stars`, always in a `tailor apply` sprite). The tailor.js
 * hooks (`data-tailor-picker`, `data-tailor-mode-toggle`) are left out so tailor.js never repaints them.
 */
export function Pickers({ parts = ["skin", "palette", "mode"], size = "sm", config, className, ...rest }: PickersProps) {
  return (
    <div className={cx("t-pickers", className)} {...rest}>
      <PickerControls parts={parts} size={size} config={config} />
    </div>
  );
}

/** The controls of `<Ui.Pickers>` without the `.t-pickers` box (`Footer.Pickers` fills its own box with them). */
export function PickerControls({ parts = ["skin", "palette", "mode"], size = "sm", config }: Pick<PickersProps, "parts" | "size" | "config">) {
  const t = useTailorTheme(config), c = t.config;
  const m = modeToggle(t, c);
  return (
    <>
      {parts.includes("skin") && c.skins.filter((s) => s !== "none").length > 1 && (
        <DrawnSelect label="Skin" size={size} value={t.skin} options={themeOptions(c, "skin")} onChange={(skin) => t.set({ skin })} />
      )}
      {parts.includes("palette") && c.palettes.length > 1 && (
        <DrawnSelect label="Palette" size={size} value={t.palette} options={themeOptions(c, "palette")} onChange={(palette) => t.set({ palette })} />
      )}
      {parts.includes("mode") && (
        <button
          type="button" className="t-btn" data-variant="ghost" data-size={size} data-icon="only"
          aria-label={m.label} data-tip={m.label} data-mode-to={m.to} disabled={!m.enabled}
          onClick={() => t.set({ mode: m.to })}
        >
          <Icon name={m.to === "light" ? "bi-sun" : "bi-moon-stars"} />
        </button>
      )}
    </>
  );
}
