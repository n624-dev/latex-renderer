import {
  displayLocales,
  type DisplayLocale,
} from "@latex-renderer/shared/locale";

function synchronizeDisplayLocale(
  saved: DisplayLocale | null | undefined,
  persist: (language: DisplayLocale) => Promise<unknown>,
  showError: (error: unknown) => void,
): false | DisplayLocale | undefined {
  const url = new URL(location.href);
  const language = displayLocales.find(
    (item) => item === document.documentElement.lang,
  );
  let saving = false;
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    ".language-picker a[lang]",
  )) {
    link.onclick = (event) => {
      const choice = displayLocales.find((item) => item === link.lang);
      if (
        !choice ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      if (saving || (choice === language && choice === saved)) return;
      saving = true;
      void persist(choice)
        .then(() => {
          const next = new URL(location.href);
          next.searchParams.set("locale", choice);
          location.assign(next);
        })
        .catch(showError)
        .finally(() => {
          saving = false;
        });
    };
  }
  if (language && url.searchParams.get("locale") === language) {
    url.searchParams.delete("locale");
    history.replaceState(null, "", url);
    return language;
  }
  if (saved && saved !== language && displayLocales.includes(saved)) {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `latex_renderer_locale=${saved}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    url.searchParams.set("locale", saved);
    location.replace(url);
    return false;
  }
  return undefined;
}

export { synchronizeDisplayLocale };
