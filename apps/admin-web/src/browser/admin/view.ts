import type { DisplayLocale } from "@latex-renderer/shared/locale";
import type { AdminMessage } from "../../admin-messages.js";
import type { createControls } from "./controls.js";

export interface AdminIdentity {
  role: "admin" | "owner";
  userId?: string;
  displayName?: string;
  displayLocale?: DisplayLocale | null;
}

export interface AdminInput {
  adminMessage: (
    key: AdminMessage,
    values?: Readonly<Record<string, string | number>>,
  ) => string;
  out: HTMLElement;
  err: HTMLElement;
  ok: HTMLElement;
  me: AdminIdentity;
  request: (path: string, options?: RequestInit) => Promise<unknown>;
}

export interface AdminView
  extends AdminInput, ReturnType<typeof createControls> {}

export function required<T>(value: T | null | undefined, name: string): T {
  if (value == null) throw new Error("Missing admin UI " + name);
  return value;
}

// Like querySelector, the selector's element type is supplied by the caller.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function requireElement<E extends Element>(
  root: ParentNode,
  selector: string,
): E {
  return required(root.querySelector<E>(selector), "element " + selector);
}

export function formText(
  form: FormData,
  name: string,
  fallback?: string,
): string {
  const value = form.get(name);
  // Preserve coercion of missing fields and FormData entries from text controls.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(fallback === undefined ? value : value || fallback);
}
