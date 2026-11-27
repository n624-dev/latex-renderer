import type { DisplayLocale } from "@latex-renderer/shared/locale";
import { matchDisplayLocale } from "@latex-renderer/shared/locale";
import type { AdminMessage } from "../../admin-messages.js";
import { synchronizeDisplayLocale } from "../../browser-locale.js";
import { createControls } from "./controls.js";
import { createDashboard } from "./dashboard.js";
import { createJobs } from "./jobs.js";
import { createKeys } from "./keys.js";
import { createSystem } from "./system.js";
import { createTex } from "./tex.js";
import { createUpdates } from "./updates.js";
import { createUsers } from "./users.js";

type AdminCatalog = Readonly<Record<AdminMessage, string>>;
type Identity = {
  role: "admin" | "owner";
  displayName?: string;
  displayLocale?: DisplayLocale | null;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function messageFrom(value: unknown, fallback: string): string {
  const error = asRecord(asRecord(value)?.error);
  const code = typeof error?.code === "string" ? "[" + error.code + "] " : "";
  return (
    code +
    (typeof error?.message === "string" && error.message
      ? error.message
      : fallback)
  );
}

export function installAdmin(catalog: AdminCatalog): void {
  const adminMessage = (
    key: AdminMessage,
    values: Readonly<Record<string, string | number>> = {},
  ) =>
    catalog[key].replaceAll(
      /\{([a-zA-Z][a-zA-Z0-9]*)\}/g,
      (match, name: string) =>
        Object.hasOwn(values, name) ? String(values[name]) : match,
    );
  const out = document.querySelector<HTMLElement>("#content");
  const err = document.querySelector<HTMLElement>("#error");
  const ok = document.querySelector<HTMLElement>("#success");
  const identity = document.querySelector<HTMLElement>("#identity");
  const updated = document.querySelector<HTMLElement>("#updated");
  if (!out || !err || !ok || !identity || !updated) return;

  const me: Identity = { role: "admin" };
  let csrfToken = "";

  const showError = (error: unknown) => {
    err.textContent = error instanceof Error ? error.message : String(error);
  };

  async function request(
    path: string,
    options: RequestInit = {},
  ): Promise<unknown> {
    const method = options.method ?? "GET";
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    headers.set("Accept-Language", document.documentElement.lang || "en");
    if (method !== "GET" && method !== "HEAD") {
      if (!csrfToken)
        throw new Error(adminMessage("reloadThePageToRefreshYour"));
      headers.set("X-CSRF-Token", csrfToken);
    }
    const response = await fetch("/admin/api/v1" + path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      method,
      headers,
    });
    const text = await response.text();
    let value: unknown = null;
    if (text) {
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error(adminMessage("theServerReturnedAnInvalidResponse"));
      }
    }
    if (!response.ok)
      throw new Error(messageFrom(value, `HTTP ${response.status}`));
    return value;
  }

  const input = { adminMessage, out, err, ok, me, request };
  const controls = createControls({ ...input, refreshPage: () => load() });
  const context = { ...input, ...controls };
  const jobs = createJobs(context);
  const pages: Readonly<Record<string, () => Promise<void>>> = {
    dashboard: createDashboard({
      ...context,
      locale: document.documentElement.lang || "en",
      jobLabel: jobs.jobLabel,
    }).dashboard,
    ...createUsers(context),
    ...createKeys(context),
    jobs: jobs.jobs,
    sources: jobs.sources,
    tex: createTex(context).texEnvironment,
    ...createUpdates(context),
    ...createSystem(context),
  };

  const load = async () => {
    err.textContent = "";
    try {
      const response = await fetch("/auth/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) {
        location.replace(
          "/login/?return_to=" +
            encodeURIComponent(location.pathname + location.search),
        );
        return;
      }
      const session: unknown = await response.json();
      const token = asRecord(session)?.csrfToken;
      if (!response.ok || typeof token !== "string" || !token)
        throw new Error(messageFrom(session, adminMessage("couldNotSignIn")));
      csrfToken = token;
      const person = asRecord(await request("/me"));
      if (person?.role !== "admin" && person?.role !== "owner")
        throw new Error(adminMessage("theServerReturnedAnInvalidResponse"));
      me.role = person.role;
      me.displayName =
        typeof person.displayName === "string" ? person.displayName : "";
      me.displayLocale =
        typeof person.displayLocale === "string"
          ? (matchDisplayLocale(person.displayLocale) ?? null)
          : null;
      const locale = synchronizeDisplayLocale(
        me.displayLocale,
        (language) =>
          fetch("/app/api/v1/me/locale", {
            method: "PATCH",
            credentials: "same-origin",
            headers: {
              "X-CSRF-Token": csrfToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ locale: language }),
          }).then((response) => {
            if (!response.ok)
              throw new Error(adminMessage("reloadThePageToRefreshYour"));
          }),
        showError,
      );
      if (locale === false) return;
      const role = adminMessage(
        me.role === "owner" ? "owner" : "administrator",
      );
      identity.textContent = me.displayName
        ? `${me.displayName} / ${role}`
        : role;
      const page = document.body.dataset.page ?? "dashboard";
      const render = Object.hasOwn(pages, page) ? pages[page] : pages.dashboard;
      await render?.();
      updated.textContent =
        adminMessage("refresh") +
        " " +
        new Date().toLocaleTimeString(document.documentElement.lang || "en");
    } catch (error) {
      showError(error);
    }
  };

  const stop = () => {
    controls.stopManagerWatch();
    controls.closeAdminDialog();
  };
  addEventListener("pagehide", stop);
  try {
    sessionStorage.removeItem("issued-key");
  } catch {
    // Storage may be unavailable in embedded web views.
  }
  document.querySelector("#logout")?.addEventListener("click", () => {
    stop();
    void fetch("/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": csrfToken },
    })
      .then(() => location.replace("/login/"))
      .catch(showError);
  });
  document.querySelector("#refresh")?.addEventListener("click", () => {
    ok.textContent = "";
    controls.closeAdminDialog();
    void load();
  });
  void load();
}
