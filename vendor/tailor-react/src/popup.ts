/* managed by tailor v0.11.1 — tailor-react src/popup.ts — do not edit, run `tailor sync` */
// Runtime helpers shared by the drawn controls (select, menu, pinned help, pickers): the React twin of
// Tailor.popup (one popup open at a time; Escape or a pointerdown outside closes it; flips above the trigger when
// it does not fit below, hangs off the right edge near it), a mounted flag for the two-phase render, and the
// native-value setter that lets drawn parts drive React-controlled inputs.
//
// Two-phase render: the server (and the first client render) emit the canonical markup of core/components.json;
// the parts tailor.js draws at upgrade (select button + list, number steppers, ids and aria links) are added
// after mount, exactly as tailor.js adds them. No hydration mismatch, and check-parity compares the first pass.
import { useEffect, useState } from "react";

export type PopupEntry = { panel: HTMLElement; trigger: HTMLElement; close: () => void };
type PopupApi = {
  open: (panel: HTMLElement, trigger: HTMLElement, close: () => void) => void;
  close: () => void;
  current: () => PopupEntry | null;
};

let current: PopupEntry | null = null;
let wired = false;

/** tailor.js's Tailor.popup when it is on the page: one registry for both, so HTML and React popups stay one-at-a-time. */
const tailorJs = (): PopupApi | undefined =>
  typeof window !== "undefined" ? (window as unknown as { Tailor?: { popup?: PopupApi } }).Tailor?.popup : undefined;

function wire(): void {
  if (wired || typeof document === "undefined") return;
  wired = true;
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as Node;
    if (current && !current.panel.contains(t) && !current.trigger.contains(t)) own.close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && current) { const t = current.trigger; own.close(); t.focus(); }
  });
}

const own: PopupApi = {
  open(panel, trigger, close) {
    wire();
    if (current && current.panel !== panel) current.close();
    current = { panel, trigger, close };
    panel.hidden = false;
    delete panel.dataset.align;
    const r = trigger.getBoundingClientRect(), h = panel.offsetHeight, w = panel.offsetWidth;
    panel.dataset.at = r.bottom + h + 8 > innerHeight && r.top - h - 8 > 0 ? "top" : "bottom";
    if (r.left + w > innerWidth - 8) panel.dataset.align = "end";
  },
  close() { if (current) { const o = current; current = null; o.close(); } },
  current: () => current,
};

/** The popup registry: Tailor.popup when tailor.js is loaded, else the React-side twin. */
export const popup: PopupApi = {
  open: (panel, trigger, close) => (tailorJs() ?? own).open(panel, trigger, close),
  close: () => (tailorJs() ?? own).close(),
  current: () => (tailorJs() ?? own).current(),
};

/** false on the server and the first client render, true after mount. */
export function useMounted(): boolean {
  const [m, set] = useState(false);
  useEffect(() => { set(true); }, []);
  return m;
}

/**
 * tailor.js's idempotency marker (`data-t-<key>`, what Tailor.upgrade sets on an element it wired), added after
 * mount: the DOM matches an upgraded HTML page, and a tailor.js on the same page never wires the element twice.
 */
export const mark = (mounted: boolean, key: string): Record<string, string> => (mounted ? { [`data-t-${key}`]: "" } : {});

/** Merge refs (callback or object) into one callback ref. */
export function mergeRefs<T>(...refs: Array<unknown>): (el: T | null) => void {
  return (el) => {
    for (const r of refs) {
      if (typeof r === "function") r(el);
      else if (r && typeof r === "object") (r as { current: T | null }).current = el;
    }
  };
}

/** A short random id suffix like tailor.js uses (`t-sel-xxxxxx`), stable per component via useState. */
export const randomId = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Set an input's value the way a user would: through the native setter (so React's value tracker sees the change
 * and a controlled input's onChange fires), then fire `input` and, unless `inputOnly`, `change` (both bubbling).
 */
export function fireValue(el: HTMLInputElement | HTMLTextAreaElement, value: string, inputOnly = false): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  if (!inputOnly) el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Pick option `index` on a native select and fire `input` + `change` (React's onChange follows `change`). */
export function fireSelect(sel: HTMLSelectElement, index: number): void {
  sel.selectedIndex = index;
  sel.dispatchEvent(new Event("input", { bubbles: true }));
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}
