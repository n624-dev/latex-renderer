import {
  matchDisplayLocale,
  resolveDisplayLocale,
} from "@latex-renderer/shared/locale";
import { siteCopy } from "./site-copy.js";

type SiteCopy = ReturnType<typeof siteCopy>;
type Theme = "system" | "light" | "dark";

const themeKey = "latex-renderer-theme";
const localeCookie = "latex_renderer_locale";

function navigateToPreferredLocale(): boolean {
  const entry = document.querySelector<HTMLMetaElement>(
    'meta[name="public-locale-entry"]',
  )?.content;
  if (entry !== location.pathname) return false;
  const saved = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(localeCookie + "="))
    ?.split("=")[1];
  const selected =
    new URL(location.href).searchParams.get("locale") || undefined;
  const locale = resolveDisplayLocale({
    selected,
    saved,
    preferred: navigator.languages,
  });
  if (locale === document.documentElement.lang) return false;
  location.replace("/" + locale + entry + location.hash);
  return true;
}

function preferredTheme(): Theme {
  try {
    const stored = localStorage.getItem(themeKey);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage can be disabled in an embedded browser.
  }
  return "system";
}

function applyTheme(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = theme;
}

function installTheme(initial: Theme, text: SiteCopy): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    "[data-theme-toggle]",
  );
  let theme = initial;
  const sync = () => {
    const label =
      theme === "light"
        ? text("themeLight", "ライト")
        : theme === "dark"
          ? text("themeDark", "ダーク")
          : text("themeSystem", "システム");
    for (const button of buttons) {
      button.textContent = text("themeLabel", "表示: {theme}").replace(
        "{theme}",
        label,
      );
      button.setAttribute(
        "aria-label",
        text("themeAria", "表示テーマを変更。現在は{theme}").replace(
          "{theme}",
          label,
        ),
      );
    }
  };
  sync();
  for (const button of buttons) {
    button.addEventListener("click", () => {
      theme =
        theme === "system" ? "light" : theme === "light" ? "dark" : "system";
      try {
        localStorage.setItem(themeKey, theme);
      } catch {
        // The theme still applies to the current page.
      }
      applyTheme(theme);
      sync();
    });
  }
}

function revealFragment(): void {
  let id: string;
  try {
    id = decodeURIComponent(location.hash.slice(1));
  } catch {
    return;
  }
  const target = id && document.getElementById(id);
  if (!target) return;
  for (
    let parent = target.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  target.scrollIntoView({ block: "start" });
}

function installLogout(text: SiteCopy): void {
  const defaults = {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  } as const;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-session-logout]",
  )) {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      button.disabled = true;
      void (async () => {
        const session = await fetch("/auth/session", defaults);
        if (session.status === 401) {
          location.replace("/login/");
          return;
        }
        if (!session.ok)
          throw new Error(text("sessionError", "セッションを確認できません。"));
        const value = (await session.json()) as { csrfToken?: unknown } | null;
        if (typeof value?.csrfToken !== "string" || !value.csrfToken)
          throw new Error(
            text("sessionReload", "セッションを再読み込みしてください。"),
          );
        const response = await fetch("/auth/logout", {
          ...defaults,
          method: "POST",
          headers: { "X-CSRF-Token": value.csrfToken },
        });
        if (!response.ok)
          throw new Error(text("signOutError", "ログアウトできませんでした。"));
        location.replace("/login/");
      })().catch((error: unknown) => {
        const message = document.querySelector("#session-error");
        if (message) {
          message.textContent =
            error instanceof Error
              ? error.message
              : text("signOutError", "ログアウトできませんでした。");
        }
        button.disabled = false;
      });
    });
  }
}

function installCodeCopy(text: SiteCopy): void {
  for (const table of document.querySelectorAll<HTMLElement>(
    ".docs-content .table-wrap",
  )) {
    table.tabIndex = 0;
    table.setAttribute("role", "region");
    table.setAttribute("aria-label", text("table", "表"));
  }
  for (const pre of document.querySelectorAll<HTMLElement>(
    ".docs-content pre",
  )) {
    pre.tabIndex = 0;
    pre.setAttribute("role", "region");
    pre.setAttribute("aria-label", text("codeExample", "コード例"));
    const block = document.createElement("div");
    block.className = "code-block";
    const toolbar = document.createElement("div");
    toolbar.className = "code-toolbar";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    const copy = text("copy", "コピー");
    button.textContent = copy;
    let restore: number | undefined;
    button.addEventListener("click", () => {
      void (async () => {
        try {
          await navigator.clipboard.writeText(
            pre.querySelector("code")?.textContent ?? "",
          );
          button.textContent = text("copied", "コピー済み");
        } catch {
          button.textContent = text("copyError", "コピーできませんでした");
        }
        window.clearTimeout(restore);
        restore = window.setTimeout(() => {
          button.textContent = copy;
        }, 1500);
      })();
    });
    pre.before(block);
    toolbar.append(button);
    block.append(toolbar, pre);
  }
}

interface SearchArticle {
  title: string;
  description: string;
  category: string;
  url: string;
  headings: { text: string }[];
  text: string;
}

function installDocsSearch(text: SiteCopy): void {
  const search = document.querySelector<HTMLInputElement>("#docs-search");
  const results = document.querySelector("#docs-search-results");
  if (!search || !results) return;
  let indexPromise: Promise<SearchArticle[]> | undefined;
  let searchGeneration = 0;
  const normalize = (value: string) =>
    value
      .normalize("NFKC")
      .trim()
      .toLocaleLowerCase(document.documentElement.lang || "en");
  const loadIndex = () =>
    (indexPromise ??= fetch(
      search.dataset.indexUrl || "/assets/docs-search.json",
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Search index unavailable");
        return (await response.json()) as SearchArticle[];
      })
      .catch((error: unknown) => {
        indexPromise = undefined;
        throw error;
      }));
  search.addEventListener("input", () => {
    const generation = ++searchGeneration;
    const query = normalize(search.value);
    results.replaceChildren();
    if (query.length < 2) return;
    const words = query.split(/\s+/);
    void loadIndex()
      .then((index) => {
        if (generation !== searchGeneration) return;
        const matches = index
          .flatMap((item) => {
            const title = normalize(item.title);
            const headings = normalize(
              item.headings.map((heading) => heading.text).join(" "),
            );
            const content = normalize(
              [
                title,
                item.description,
                item.category,
                headings,
                item.text,
              ].join(" "),
            );
            if (!words.every((word) => content.includes(word))) return [];
            const rank = words.every((word) => title.includes(word))
              ? 2
              : words.every((word) => headings.includes(word))
                ? 1
                : 0;
            return [{ item, rank }];
          })
          .sort((left, right) => right.rank - left.rank)
          .slice(0, 8);
        const list = document.createElement("ul");
        for (const { item } of matches) {
          if (
            !item.url.startsWith("/") ||
            item.url.startsWith("//") ||
            item.url.includes("\\")
          )
            continue;
          const entry = document.createElement("li");
          const link = document.createElement("a");
          link.href = item.url;
          link.textContent = item.title + " — " + item.description;
          entry.append(link);
          list.append(entry);
        }
        if (list.childElementCount === 0)
          results.textContent = text(
            "noMatches",
            "一致するページはありません。",
          );
        else results.append(list);
      })
      .catch(() => {
        if (generation === searchGeneration) {
          results.textContent = text(
            "searchError",
            "ガイド内の検索に失敗しました。入力し直すと再試行できます。",
          );
        }
      });
  });
}

if (!navigateToPreferredLocale()) {
  const theme = preferredTheme();
  applyTheme(theme);
  document.addEventListener("DOMContentLoaded", () => {
    const text = siteCopy();
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      ".language-picker a[lang]",
    )) {
      link.addEventListener("click", () => {
        if (matchDisplayLocale(link.lang) !== link.lang) return;
        const secure = location.protocol === "https:" ? "; Secure" : "";
        document.cookie =
          localeCookie +
          "=" +
          link.lang +
          "; Path=/; Max-Age=31536000; SameSite=Lax" +
          secure;
      });
    }
    revealFragment();
    window.addEventListener("hashchange", revealFragment);
    const docsMenu = document.querySelector<HTMLDetailsElement>(".docs-menu");
    if (docsMenu) {
      const narrow = window.matchMedia("(max-width: 820px)");
      const sync = () => {
        docsMenu.open = !narrow.matches;
      };
      sync();
      narrow.addEventListener("change", sync);
    }
    installTheme(theme, text);
    installLogout(text);
    installCodeCopy(text);
    installDocsSearch(text);
  });
}
