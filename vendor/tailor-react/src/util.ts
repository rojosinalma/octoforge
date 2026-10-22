/* managed by tailor v0.11.1 — tailor-react src/util.ts — do not edit, run `tailor sync` */
import type { HTMLAttributes, ReactNode } from "react";

/** The fixed tone vocabulary (core/components.json → tones). */
export type Tone =
  | "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "text"
  | "red" | "orange" | "yellow" | "green" | "cyan" | "purple" | "pink";

export type Size = "xs" | "sm" | "md" | "lg" | "xl";

/** Join class names, dropping falsy entries. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * `undefined` when the value is absent or the default (md sizes are never
 * written, per core/conventions.md §2), else the value — ready for a
 * `data-*` attribute.
 */
export function dataAttr<T extends string>(value: T | undefined, omit?: T): T | undefined {
  if (value === undefined || value === omit) return undefined;
  return value;
}

/** Common pass-through props every tailor component accepts. */
export type BaseProps<E extends HTMLElement = HTMLElement> = HTMLAttributes<E> & {
  children?: ReactNode;
};
