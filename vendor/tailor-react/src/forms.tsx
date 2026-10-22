/* managed by tailor v0.11.1 — tailor-react src/forms.tsx — do not edit, run `tailor sync` */
// Forms: field, check, duration-input, settings-row (+ the drawn select, number steppers and Ui.Form) — markup per
// core/components.json. The tailor.js behaviours are reimplemented in React (tailor.js is not loaded):
// Tailor.selects (drawn select), Tailor.numbers (− / + steppers), T.duration, Tailor.settingsAutoSave (state,
// toast, revert on failure) and Tailor.forms (drawn validation). Drawn parts are added after mount (popup.ts).
import {
  cloneElement, createContext, isValidElement, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
  type FieldsetHTMLAttributes, type FormHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes,
  type KeyboardEvent, type LabelHTMLAttributes, type PointerEvent, type ReactElement, type ReactNode, type Ref,
  type RefObject, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { cx, dataAttr } from "./util.ts";
import { Icon } from "./actions.tsx";
import { Help, useOptionalToasts, type HelpProps } from "./feedback.tsx";
import { fireSelect, fireValue, mark, mergeRefs, popup, randomId, useMounted } from "./popup.ts";

const useIsoLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

/* ── field parts ─────────────────────────────────────────────────────────── */

export function Label({ className, children, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cx("t-label", className)} {...rest}>{children}</label>;
}

/* ── input group: hosts number steppers (Tailor.numbers reuses an enclosing .t-input-group) ── */

const GroupContext = createContext<((on: boolean) => void) | null>(null);

export function InputGroup({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const [num, setNum] = useState(false);
  return (
    <GroupContext value={setNum}>
      <div className={cx("t-input-group", num && "t-number", className)} {...rest}>{children}</div>
    </GroupContext>
  );
}

export function InputAddon({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx("t-input-addon", className)} {...rest}>{children}</span>;
}

/* ── input (+ number steppers) ───────────────────────────────────────────── */

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: "sm" | "md";
  /** The native `size` attribute (visible width in characters); `size` is the tailor control size. */
  htmlSize?: number;
  ref?: Ref<HTMLInputElement>;
  /** `type="number"`: `"none"` keeps the bare input (no − / + steppers). */
  "data-steppers"?: "none";
};

export function Input({ size, htmlSize, className, ref, ...rest }: InputProps) {
  const mounted = useMounted();
  const group = useContext(GroupContext);
  const own = useRef<HTMLInputElement>(null);
  const steppers = rest.type === "number" && rest["data-steppers"] !== "none";
  const input = (
    <input
      ref={mergeRefs(own, ref)}
      className={cx("t-input", className)}
      data-size={dataAttr(size, "md")}
      size={htmlSize}
      {...rest}
      {...mark(mounted && steppers, "number")}
    />
  );
  if (!steppers || !mounted) return input;
  return <Steppers input={own} group={group} size={size}>{input}</Steppers>;
}

const num = (s: string, d: number) => { const n = parseFloat(s); return isNaN(n) ? d : n; };

/** The − / + buttons Tailor.numbers draws around a number input (hold to repeat). */
function Steppers({ input, group, size, children }: {
  input: RefObject<HTMLInputElement | null>; group: ((on: boolean) => void) | null; size?: "sm" | "md"; children: ReactNode;
}) {
  const [off, setOff] = useState({ minus: false, plus: false });
  const timers = useRef<{ hold?: ReturnType<typeof setTimeout>; repeat?: ReturnType<typeof setInterval> }>({});
  const bounds = (el: HTMLInputElement) => ({ min: num(el.min, -Infinity), max: num(el.max, Infinity), step: el.step === "any" ? 1 : num(el.step, 1) || 1 });
  const paint = () => {
    const el = input.current; if (!el) return;
    const { min, max } = bounds(el), v = num(el.value, NaN), dis = el.disabled || el.readOnly;
    const next = { minus: dis || (!isNaN(v) && v <= min), plus: dis || (!isNaN(v) && v >= max) };
    setOff((p) => (p.minus === next.minus && p.plus === next.plus ? p : next));
  };
  useIsoLayoutEffect(paint);
  useEffect(() => {
    const el = input.current; if (!el) return;
    el.addEventListener("input", paint); el.addEventListener("change", paint);
    return () => { el.removeEventListener("input", paint); el.removeEventListener("change", paint); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { group?.(true); return () => group?.(false); }, [group]);
  const step = (dir: number) => {
    const el = input.current; if (!el) return;
    const { min, max, step } = bounds(el); let v = num(el.value, NaN);
    if (isNaN(v)) v = Math.min(Math.max(0, min), max); else v += dir * step;
    v = Math.min(Math.max(v, min), max);
    const dec = Math.max((String(step).split(".")[1] || "").length, (el.value.split(".")[1] || "").length);
    const next = v.toFixed(dec); if (next === el.value) return paint();
    fireValue(el, next); paint();
  };
  const stop = () => { clearTimeout(timers.current.hold); clearInterval(timers.current.repeat); timers.current = {}; };
  const button = (dir: 1 | -1) => (
    <button
      type="button" className="t-btn t-number-step" data-variant="ghost" data-icon="only" data-step={String(dir)} tabIndex={-1}
      aria-label={dir > 0 ? "Increase" : "Decrease"} disabled={dir > 0 ? off.plus : off.minus}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        const b = e.currentTarget; if (e.button !== 0 || b.disabled) return;
        e.preventDefault(); step(dir);
        timers.current.hold = setTimeout(() => { timers.current.repeat = setInterval(() => (b.disabled ? stop() : step(dir)), 60); }, 400);
      }}
      onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
    >
      <Icon name={dir > 0 ? "bi-plus-lg" : "bi-dash-lg"} />
    </button>
  );
  const parts = <>{button(-1)}{children}{button(1)}</>;
  return group ? parts : <div className="t-input-group t-number" data-size={dataAttr(size, "md")}>{parts}</div>;
}

/* ── select (drawn: Tailor.selects) ──────────────────────────────────────── */

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  size?: "sm" | "md";
  ref?: Ref<HTMLSelectElement>;
  /** Keep the browser control (no drawn button + list). `multiple` selects always stay native. */
  "data-native"?: "" | true;
  /** Button text while no option (or the empty-value option) is selected. */
  "data-placeholder"?: string;
  "data-width"?: "auto";
};

/**
 * `<Ui.Select>` — renders the native `<select class="t-select">` (forms and `.value` keep working, the server
 * markup is the canonical one); after mount it is wrapped like Tailor.selects does: `span.t-select-wrap` with the
 * hidden native select, a `button.t-select.t-select-btn` and the `ul.t-select-list[role=listbox]` popup.
 */
export function Select({ size, className, children, ref, ...rest }: SelectProps) {
  const mounted = useMounted();
  const own = useRef<HTMLSelectElement>(null);
  const native = rest.multiple || rest["data-native"] !== undefined;
  const drawn = mounted && !native;
  const select = (
    <select
      ref={mergeRefs(own, ref)}
      className={cx("t-select", className)}
      data-size={dataAttr(size, "md")}
      {...rest}
      {...(drawn ? { tabIndex: -1, "aria-hidden": true, "data-t-select": "", "data-t-select-native": "" } : {})}
    >
      {children}
    </select>
  );
  if (!drawn) return select;
  return <DrawnSelect sel={own} size={size} props={rest}>{select}</DrawnSelect>;
}

type Row = { kind: "header"; label: string } | { kind: "option"; i: number; text: string; selected: boolean; disabled: boolean };
type View = { label: string; placeholder: boolean; disabled: boolean; rows: Row[] };

function readView(sel: HTMLSelectElement): View {
  const cur = sel.selectedOptions[0], ph = sel.dataset.placeholder;
  const rows: Row[] = []; let group: Element | null = null;
  [...sel.options].forEach((o, i) => {
    if (o.parentElement?.tagName === "OPTGROUP" && o.parentElement !== group) { group = o.parentElement; rows.push({ kind: "header", label: (group as HTMLOptGroupElement).label }); }
    rows.push({ kind: "option", i, text: o.textContent ?? "", selected: o.selected, disabled: o.disabled });
  });
  return { label: cur ? cur.textContent ?? "" : ph || "\u00a0", placeholder: !cur || (cur.value === "" && !!ph), disabled: sel.disabled, rows };
}

function DrawnSelect({ sel, size, props, children }: { sel: RefObject<HTMLSelectElement | null>; size?: string; props: Record<string, unknown>; children: ReactNode }) {
  const [fallback] = useState(() => randomId("t-sel"));
  const id = (props.id as string | undefined) || fallback, listId = `${id}-list`;
  const [view, setView] = useState<View>({ label: "\u00a0", placeholder: false, disabled: false, rows: [] });
  const [open, setOpen] = useState(false);
  const [labelledBy, setLabelledBy] = useState<string | undefined>(undefined);
  const btn = useRef<HTMLButtonElement>(null), list = useRef<HTMLUListElement>(null);
  const typed = useRef({ s: "", at: 0 });

  const sync = () => { const s = sel.current; if (!s) return; const v = readView(s); setView((p) => (JSON.stringify(p) === JSON.stringify(v) ? p : v)); };
  useIsoLayoutEffect(sync);
  useEffect(() => {
    const s = sel.current; if (!s) return;
    s.addEventListener("change", sync);
    const mo = new MutationObserver(sync);
    mo.observe(s, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "selected", "label"] });
    // a <label for=id> names the button (tailor.js gives the label an id when it has none)
    const lbl = s.id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(s.id)}"]`) : null;
    if (lbl) setLabelledBy(lbl.id || (lbl.id = `${id}-label`));
    return () => { s.removeEventListener("change", sync); mo.disconnect(); if (popup.current()?.panel === list.current) popup.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => { setOpen(false); btn.current?.removeAttribute("aria-activedescendant"); };
  const items = () => [...(list.current?.querySelectorAll<HTMLButtonElement>("[role=option]:not(:disabled)") ?? [])];
  useIsoLayoutEffect(() => {
    if (!open || !list.current || !btn.current) return;
    popup.open(list.current, btn.current, close);
    (items().find((b) => b.getAttribute("aria-selected") === "true") ?? items()[0])?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const doOpen = () => { if (!sel.current?.disabled) { sync(); setOpen(true); } };
  const pick = (i: number) => {
    const s = sel.current; if (!s) return;
    if (s.selectedIndex !== i) fireSelect(s, i);
    popup.close(); btn.current?.focus(); sync();
  };
  const options = () => [...(sel.current?.options ?? [])];
  const step = (d: number) => {
    const all = options(), os = all.filter((o) => !o.disabled), i = os.indexOf(sel.current!.selectedOptions[0]!);
    const n = os[Math.min(Math.max(i + d, 0), os.length - 1)]; if (n) pick(all.indexOf(n));
  };
  const typeAhead = (key: string, from: number) => {
    const now = Date.now(), t = typed.current; t.s = now - t.at < 600 ? t.s + key : key; t.at = now;
    const os = options(), start = t.s.length > 1 ? from : from + 1;
    for (let k = 0; k < os.length; k++) { const o = os[(start + k) % os.length]!; if (!o.disabled && (o.textContent ?? "").trim().toLowerCase().startsWith(t.s.toLowerCase())) return os.indexOf(o); }
    return -1;
  };
  const onBtnKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (e.altKey) doOpen(); else step(e.key === "ArrowDown" ? 1 : -1); }
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); doOpen(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { const i = typeAhead(e.key, sel.current?.selectedIndex ?? -1); if (i >= 0) pick(i); }
  };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const its = items(), i = its.indexOf(document.activeElement as HTMLButtonElement);
    const go = (j: number) => { its[j]?.focus(); btn.current?.setAttribute("aria-activedescendant", its[j]?.id ?? ""); };
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); go((i + (e.key === "ArrowDown" ? 1 : -1) + its.length) % its.length); }
    else if (e.key === "Home" || e.key === "End") { e.preventDefault(); go(e.key === "Home" ? 0 : its.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (i >= 0) pick(Number(its[i]!.dataset.index)); }
    else if (e.key === "Tab") popup.close();
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const k = typeAhead(e.key, i >= 0 ? Number(its[i]!.dataset.index) : -1);
      const j = its.findIndex((b) => Number(b.dataset.index) === k); if (j >= 0) go(j);
    }
  };

  const copy: Record<string, unknown> = {};
  for (const a of ["data-tip", "data-tip-at", "aria-label", "aria-describedby", "aria-invalid"]) if (props[a] !== undefined) copy[a] = props[a];
  return (
    <span className="t-select-wrap" data-width={props["data-width"] as string | undefined}>
      {children}
      <button
        ref={btn} type="button" className={cx("t-select", "t-select-btn", view.placeholder && "t-select-placeholder")}
        aria-haspopup="listbox" aria-expanded={open} data-size={dataAttr(size, "md")} {...copy}
        aria-controls={listId} aria-labelledby={labelledBy} disabled={view.disabled}
        onClick={() => (open ? popup.close() : doOpen())} onKeyDown={onBtnKey}
      >
        {view.label}
      </button>
      <ul ref={list} className="t-menu-list t-select-list" role="listbox" hidden={!open} tabIndex={-1} id={listId} onKeyDown={onListKey}>
        {view.rows.map((r, n) => r.kind === "header"
          ? <li key={`h${n}`} className="t-menu-header">{r.label}</li>
          : (
            <li key={r.i}>
              <button
                type="button" className="t-menu-item" role="option" id={`${listId}-${r.i}`} data-index={r.i}
                aria-selected={r.selected} disabled={r.disabled || undefined}
                onClick={() => { if (!r.disabled) pick(r.i); }}
              >
                {r.text}
              </button>
            </li>
          ))}
      </ul>
    </span>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("t-textarea", className)} {...rest} />;
}

/* ── form (Tailor.forms: drawn validation, no native bubbles) ────────────── */

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const FormContext = createContext<Record<string, string> | null>(null);

export type FormProps = FormHTMLAttributes<HTMLFormElement> & {
  /** `"live"` also validates a control on blur (`data-validate="live"`). */
  validate?: "live";
  /** Keep the browser's own validation bubbles (`data-native-validation`): Ui.Form then only renders the form. */
  nativeValidation?: boolean;
  /** Called with the invalid controls when a submit is stopped (Tailor.validate's `t:invalid`). */
  onInvalidSubmit?: (controls: Control[]) => void;
};

/**
 * `<Ui.Form>` — the React Tailor.forms: `novalidate`; on submit every control runs `checkValidity()`, invalid ones
 * get `aria-invalid` and their `validationMessage` in the `.t-feedback[data-tone=danger]` of their `Ui.Field`, the
 * first invalid one takes focus and `onSubmit` is not called. Fixing a control clears its message.
 */
export function Form({ validate, nativeValidation, onInvalidSubmit, onSubmit, onInput, onChange, onBlur, className, children, ...rest }: FormProps) {
  const mounted = useMounted();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const controls = (form: HTMLFormElement) =>
    ([...form.elements] as unknown as Control[]).filter((c) => "willValidate" in c && c.willValidate && c.type !== "hidden");
  const paint = (c: Control, ok: boolean) => {
    if (ok) c.removeAttribute("aria-invalid"); else c.setAttribute("aria-invalid", "true");
    if (!c.id) return;
    setErrors((p) => {
      if (ok) { if (!(c.id in p)) return p; const n = { ...p }; delete n[c.id]; return n; }
      return p[c.id] === c.validationMessage ? p : { ...p, [c.id]: c.validationMessage };
    });
  };
  const check = (c: Control) => { const ok = c.checkValidity(); paint(c, ok); return ok; };
  const clear = (t: EventTarget) => { const c = t as Control; if (c.getAttribute?.("aria-invalid") === "true" && c.checkValidity?.()) paint(c, true); };
  if (nativeValidation) return <form className={cx("t-form", className)} data-native-validation="" onSubmit={onSubmit} onInput={onInput} onChange={onChange} onBlur={onBlur} {...rest}>{children}</form>;
  return (
    <FormContext value={errors}>
      <form
        className={cx("t-form", className)}
        data-validate={validate}
        noValidate
        {...mark(mounted, "form")}
        onSubmit={(e) => {
          const bad = controls(e.currentTarget).filter((c) => !check(c));
          if (bad.length) { e.preventDefault(); bad[0]!.focus(); onInvalidSubmit?.(bad); return; }
          onSubmit?.(e);
        }}
        onInput={(e) => { clear(e.target); onInput?.(e); }}
        onChange={(e) => { clear(e.target); onChange?.(e); }}
        onBlur={(e) => {
          const c = e.target as unknown as Control;
          if (validate === "live" && c.willValidate && c.form === (e.currentTarget as unknown) && (c.value !== "" || c.getAttribute("aria-invalid") === "true")) check(c);
          onBlur?.(e);
        }}
        {...rest}
      >
        {children}
      </form>
    </FormContext>
  );
}

/* ── field ───────────────────────────────────────────────────────────────── */

export type FieldProps = HTMLAttributes<HTMLDivElement> & {
  label: ReactNode;
  /** Control id; set on the control child and the label's `for`. */
  id?: string;
  /** Caption under the control (`.t-hint`). */
  hint?: ReactNode;
  /** Validation error: renders `.t-feedback[data-tone=danger]` and marks the control `aria-invalid`. */
  error?: ReactNode;
  /** Success feedback (`.t-feedback[data-tone=success]`), linked with `aria-describedby`. */
  success?: ReactNode;
  children: ReactNode;
};

/**
 * `<Ui.Field label hint error>` — wraps one control (Ui.Input/Select/Textarea
 * or an InputGroup). When the single child is an element, Field injects `id`
 * and, with feedback, `aria-describedby` pointing at it (+ `aria-invalid` on error).
 * Inside a `<Ui.Form>`, a failed validation shows the control's message right under it.
 */
export function Field({ label, id, hint, error, success, className, children, ...rest }: FieldProps) {
  const autoId = useId();
  const formErrors = useContext(FormContext);
  let controlId = id ?? autoId;
  let control = children;
  let injectable = false;
  if (isValidElement(children)) {
    const child = children as ReactElement<Record<string, unknown>>;
    // Only bare controls get the id/aria injection; wrappers (InputGroup…) carry their own ids on the inner control.
    injectable = child.type === Input || child.type === Select || child.type === Textarea;
    if (injectable && typeof child.props.id === "string") controlId = child.props.id;
  }
  const feedbackId = `${controlId}-fb`;
  const formError = error === undefined ? formErrors?.[controlId] : undefined;
  const danger = error ?? formError;
  if (injectable) {
    const child = children as ReactElement<Record<string, unknown>>;
    const extra: Record<string, unknown> = { id: controlId };
    if (danger !== undefined || success !== undefined) extra["aria-describedby"] = child.props["aria-describedby"] ?? feedbackId;
    if (danger !== undefined) extra["aria-invalid"] = "true";
    control = cloneElement(child, extra);
  }
  return (
    <div className={cx("t-field", className)} {...rest}>
      <Label htmlFor={controlId}>{label}</Label>
      {control}
      {formError !== undefined && <p className="t-feedback" id={feedbackId} data-tone="danger">{formError}</p>}
      {hint !== undefined && <p className="t-hint">{hint}</p>}
      {error !== undefined && <p className="t-feedback" id={feedbackId} data-tone="danger">{error}</p>}
      {success !== undefined && <p className="t-feedback" id={danger === undefined ? feedbackId : undefined} data-tone="success">{success}</p>}
    </div>
  );
}

/* ── check (checkbox, radio, switch) ─────────────────────────────────────── */

export type CheckProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  type?: "checkbox" | "radio";
  /** Switch appearance + `role="switch"`. */
  switch?: boolean;
  label: ReactNode;
  desc?: ReactNode;
};

export function Check({ type = "checkbox", switch: isSwitch, label, desc, className, ...rest }: CheckProps) {
  return (
    <label className={cx("t-check", className)} data-variant={isSwitch ? "switch" : undefined}>
      <input className="t-check-input" type={type} role={isSwitch ? "switch" : undefined} {...rest} />
      <span className="t-check-label">
        {label}
        {desc !== undefined && <span className="t-check-desc">{desc}</span>}
      </span>
    </label>
  );
}

type CheckGroupProps = FieldsetHTMLAttributes<HTMLFieldSetElement> & { legend: ReactNode };

export function CheckGroup({ legend, className, children, ...rest }: CheckGroupProps) {
  return (
    <fieldset className={cx("t-check-group", className)} {...rest}>
      <legend className="t-label">{legend}</legend>
      {children}
    </fieldset>
  );
}

Check.Group = CheckGroup;

/* ── duration input ──────────────────────────────────────────────────────── */

const UNITS = [
  { factor: 1, label: "s" },
  { factor: 60, label: "min" },
  { factor: 3600, label: "h" },
] as const;

/** T.duration.set: the largest unit that divides the value (0 → h, like tailor.js). */
function splitSeconds(seconds: number): { num: string; unit: number } {
  const n = Number(seconds) || 0;
  const unit = [3600, 60, 1].find((u) => n % u === 0) ?? 1;
  return { num: String(n / unit), unit };
}

export type DurationInputProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> & {
  /** `data-setting` key for settings-row autosave. */
  setting?: string;
  /** Value in seconds. Shown in the largest unit that divides it; later changes of the prop are followed. */
  value?: number;
  /** Initial value in seconds (uncontrolled). */
  defaultValue?: number;
  onChange?: (seconds: number) => void;
  id?: string;
  label?: string;
  size?: "sm" | "md";
};

/**
 * Number + unit pair editing a seconds value (`.t-input-group.t-duration`). Keeps its own state, so typing and the
 * steppers work with or without `onChange`; after mount it gets the − / + steppers and the drawn unit select.
 */
export function DurationInput({ setting, value, defaultValue, onChange, id, label, size, className, ...rest }: DurationInputProps) {
  const mounted = useMounted();
  const [numbered, setNumbered] = useState(false);
  const initial = value ?? defaultValue;
  const [st, setSt] = useState(() => (initial !== undefined ? splitSeconds(initial) : { num: "", unit: 1 }));
  const seconds = (s: { num: string; unit: number }) => Math.max(0, Math.round((Number(s.num) || 0) * s.unit));
  // the number is uncontrolled (no value attribute, like the canonical markup and tailor.js's T.duration.set);
  // the state is written into the DOM property when it differs
  const numRef = useRef<HTMLInputElement>(null);
  useIsoLayoutEffect(() => { const el = numRef.current; if (el && el.value !== st.num) el.value = st.num; });
  useEffect(() => {
    if (value !== undefined) setSt((s) => (seconds(s) === value ? s : splitSeconds(value)));
  }, [value]);
  const update = (patch: Partial<{ num: string; unit: number }>) => {
    setSt((s) => { const n = { ...s, ...patch }; onChange?.(seconds(n)); return n; });
  };
  return (
    <div
      className={cx("t-input-group", "t-duration", numbered && "t-number", className)}
      data-size={dataAttr(size, "md")}
      data-setting={setting}
      data-value={initial !== undefined ? String(initial) : undefined}
      {...mark(mounted && initial !== undefined, "duration")}
      {...rest}
    >
      <GroupContext value={setNumbered}>
        <Input ref={numRef} type="number" min="0" step="1" id={id} aria-label={label} onChange={(e) => update({ num: e.target.value })} />
        <Select aria-label="unit" value={String(st.unit)} onChange={(e) => update({ unit: Number(e.target.value) })}>
          {UNITS.map((u) => <option key={u.factor} value={String(u.factor)}>{u.label}</option>)}
        </Select>
      </GroupContext>
    </div>
  );
}

/* ── settings row ────────────────────────────────────────────────────────── */

export type SaveResult = { ok: boolean; message?: string };
/** Autosave callback: (setting key, value as text: `"true"`/`"false"` for switches, seconds for durations). */
export type SaveFn = (key: string, value: string) => SaveResult | Promise<SaveResult>;

const SettingsContext = createContext<SaveFn | null>(null);

export type SettingsProps = HTMLAttributes<HTMLDivElement> & {
  /** Autosave for every row below (the React `Tailor.settingsAutoSave(root, save)`); a row's own `save` wins. */
  save?: SaveFn;
};

export function Settings({ save, className, children, ...rest }: SettingsProps) {
  const mounted = useMounted();
  return (
    <SettingsContext value={save ?? null}>
      <div className={cx("t-settings", className)} {...mark(mounted && !!save, "settings")} {...rest}>{children}</div>
    </SettingsContext>
  );
}

export type SettingsRowProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & {
  /** Row label; `htmlFor` should match the control's id. */
  label: ReactNode;
  htmlFor?: string;
  /** Optional help popover next to the label. */
  help?: HelpProps;
  /** The setting key; injected as `data-setting` on the control child. */
  setting?: string;
  /** Autosave callback, called with (key, value) on the control's change event. */
  save?: SaveFn;
  children: ReactNode;
};

const settingValue = (el: HTMLElement): string => {
  if (el.classList.contains("t-duration")) {
    const i = el.querySelector("input"), s = el.querySelector("select");
    return String(Math.round((Number(i?.value) || 0) * Number(s?.value ?? 1)));
  }
  const c = el as HTMLInputElement;
  return c.type === "checkbox" ? String(c.checked) : c.value;
};

function settingRevert(el: HTMLElement, last: string): void {
  if (el.classList.contains("t-duration")) {
    const { num, unit } = splitSeconds(Number(last));
    const s = el.querySelector("select"), i = el.querySelector("input");
    if (s) { const k = [...s.options].findIndex((o) => Number(o.value) === unit); if (k >= 0 && k !== s.selectedIndex) fireSelect(s, k); }
    if (i) fireValue(i, num, true);
  } else if (el instanceof HTMLSelectElement) {
    const k = [...el.options].findIndex((o) => o.value === last); if (k >= 0) fireSelect(el, k);
  } else if (el instanceof HTMLInputElement && el.type === "checkbox") {
    if (el.checked !== (last === "true")) el.click();
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    fireValue(el, last, true);
  }
}

/**
 * One settings row (`.t-setting`): label cell, control cell, live state cell — the React
 * Tailor.settingsAutoSave. With `save` (own or from `<Ui.Settings save>`), every native `change` of a
 * `[data-setting]` control in the row saves: `data-state="saving"`, then `saved` or `failed`, a toast with the
 * result message ("Saved" / "Save failed" by default), and on failure the control goes back to its last saved value.
 */
export function SettingsRow({
  label, htmlFor, help, setting, save, className, children, ...rest
}: SettingsRowProps) {
  const ctxSave = useContext(SettingsContext);
  const toasts = useOptionalToasts();
  const [state, setState] = useState<"" | "saving" | "saved" | "failed">("");
  const row = useRef<HTMLDivElement>(null);
  const latest = useRef({ save: save ?? ctxSave, toasts });
  latest.current = { save: save ?? ctxSave, toasts };

  // after the drawn parts are in (children re-render with this row's mount flush), like settingsAutoSave on load:
  // every control remembers its saved value in data-last
  const mounted = useMounted();
  useEffect(() => {
    const el = row.current; if (!el || !mounted) return;
    el.querySelectorAll<HTMLElement>("[data-setting]").forEach((c) => { c.dataset.last = settingValue(c); });
    let reverting = false;
    const onChange = async (e: Event) => {
      const { save: fn } = latest.current;
      if (reverting || !fn) return;
      const c = (e.target as Element).closest<HTMLElement>("[data-setting]"); if (!c || !el.contains(c)) return;
      const key = c.dataset.setting!, value = settingValue(c);
      setState("saving");
      const res: SaveResult = await Promise.resolve().then(() => fn(key, value)).catch((err: Error) => ({ ok: false, message: err.message }));
      setState(res.ok ? "saved" : "failed");
      latest.current.toasts?.toast(res.ok ? "success" : "danger", res.message || (res.ok ? "Saved" : "Save failed"));
      // the control may have been re-rendered meanwhile: look it up again by key
      const now = el.querySelector<HTMLElement>(`[data-setting="${CSS.escape(key)}"]`) ?? c;
      if (res.ok) now.dataset.last = value;
      else { reverting = true; try { settingRevert(now, now.dataset.last ?? value); } finally { reverting = false; } }
    };
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [mounted]);

  let control = children;
  if (setting !== undefined && isValidElement(children)) {
    const child = children as ReactElement<Record<string, unknown>>;
    control = cloneElement(child, { "data-setting": setting });
  }

  return (
    <div ref={row} className={cx("t-setting", className)} data-state={state || undefined} {...rest}>
      <div className="t-setting-label">
        <label htmlFor={htmlFor}>{label}</label>
        {help && <Help {...help} />}
      </div>
      <div className="t-setting-control">{control}</div>
      <span className="t-setting-state" aria-live="polite"></span>
    </div>
  );
}

Settings.Row = SettingsRow;
