import { Compartment, EditorState, type Text } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type {
  RenderEngine,
  RenderOutput,
  StructuredErrors,
} from "@latex-renderer/contracts";
import {
  displayLocales,
  matchDisplayLocale,
} from "@latex-renderer/shared/locale";
import {
  formatEditorMessage,
  loadEditorCatalog,
  type EditorMessage as CatalogMessage,
} from "./messages.js";
import {
  editorChrome,
  isEditorChromeMessage,
  type EditorChromeMessage,
} from "./chrome-messages.js";
import { EditorPreview } from "./preview.js";
import { editorTools } from "./tex-support.js";

type Api = (url: string, init?: RequestInit) => Promise<unknown>;
type Draft = {
  version: number;
  entrypoint: string;
  engine: RenderEngine;
  outputs?: RenderOutput[];
  files: { path: string; sourceId: string; sourcePath: string }[];
};
type Job = {
  id: string;
  status: string;
  errorCode: string | null;
  pdfPageCount?: number | null;
};
type Preview = { jobId: string; version: number };
type PreviewActivity = {
  latest: (Preview & { status: string }) | null;
  successful: (Preview & { pageCount: number | null }) | null;
};
const settleMs = 1500;
const previewFormatPreference = "latex-renderer-editor-preview-format";
const editable = /\.(?:tex|sty|cls|bib|bst|csv|dat|txt)$/i;
const jobLabels = new Set([
  "queued",
  "validating",
  "running",
  "succeeded",
  "failed",
  "timeout",
  "rejected",
  "canceled",
  "expired",
]);
const building = new Set(["queued", "validating", "running"]);
const buildFailures = new Set(["failed", "timeout", "rejected"]);
type EditorMessage = CatalogMessage | EditorChromeMessage;
type MessageArgs = Readonly<Record<string, string | number>>;

function measureEditor(name: string, start: number) {
  const metric = `latex-renderer:editor:${name}`;
  performance.clearMeasures(metric);
  performance.measure(metric, { start, end: performance.now() });
}

function element(id: string): HTMLElement;
function element<T extends HTMLElement>(id: string, type: { new (): T }): T;
function element(
  id: string,
  type: typeof HTMLElement = HTMLElement,
): HTMLElement {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`Missing editor element: ${id}`);
  return node;
}

export async function installEditor(
  api: Api,
  accountLocale?: string,
): Promise<void> {
  const section = element("app-editor");
  const projectId = section.dataset.projectId;
  const language = element("editor-language", HTMLSelectElement);
  let locale =
    matchDisplayLocale(accountLocale ?? document.documentElement.lang) ?? "en";
  let catalog = await loadEditorCatalog(locale).catch(async () => {
    locale = "en";
    return loadEditorCatalog(locale);
  });
  let numbers = new Intl.NumberFormat(locale);
  const text = (key: EditorMessage, args?: MessageArgs) =>
    isEditorChromeMessage(key)
      ? editorChrome[locale][key]
      : formatEditorMessage(catalog, key, args, numbers);
  const translated = new Map<
    HTMLElement,
    { key: EditorMessage; args?: MessageArgs | undefined }
  >();
  const setText = (
    node: HTMLElement,
    key: EditorMessage,
    args?: MessageArgs,
  ) => {
    translated.set(node, { key, args });
    node.dataset.state = key;
    const message = text(key, args);
    if (node.textContent !== message) node.textContent = message;
  };
  const themeToggle = document.querySelector<HTMLButtonElement>(
    "[data-theme-toggle]",
  );
  const regionalWebFonts = JSON.parse(
    document.querySelector<HTMLMetaElement>('meta[name="regional-web-fonts"]')?.content ?? "{}",
  ) as Partial<Record<string, string>>;
  const displayTheme = () => {
    if (!themeToggle) return;
    const preference = document.documentElement.dataset.themePreference;
    const theme = text(
      preference === "light"
        ? "themeLight"
        : preference === "dark"
          ? "themeDark"
          : "themeSystem",
    );
    themeToggle.textContent = text("themeLabel", { theme });
    themeToggle.setAttribute("aria-label", text("themeLabelAria", { theme }));
  };
  const displayLanguage = () => {
    section.lang = locale;
    document.documentElement.lang = locale;
    const regionalFont = document.querySelector<HTMLLinkElement>("#regional-web-font");
    const href = regionalWebFonts[locale];
    if (!href) regionalFont?.remove();
    else if (regionalFont) {
      if (regionalFont.getAttribute("href") !== href) regionalFont.href = href;
    } else {
      const link = document.createElement("link");
      link.id = "regional-web-font";
      link.rel = "stylesheet";
      link.href = href;
      document.head.append(link);
    }
    document.title = `${text("title")} | LaTeX Renderer`;
    for (const node of document.querySelectorAll<HTMLElement>(
      "[data-editor-message]",
    )) {
      const key = node.dataset.editorMessage as EditorMessage;
      if (!translated.has(node)) setText(node, key);
    }
    for (const [node, value] of translated)
      node.textContent = text(value.key, value.args);
    for (const node of document.querySelectorAll<HTMLElement>(
      "[data-editor-aria]",
    ))
      node.setAttribute(
        "aria-label",
        text(node.dataset.editorAria as EditorMessage),
      );
    displayTheme();
  };
  displayLanguage();
  for (const option of displayLocales) {
    const name =
      new Intl.DisplayNames([option], { type: "language" }).of(option) ??
      option;
    language.add(new Option(name, option));
  }
  language.value = locale;
  const phrases = new Compartment();
  const base = `/app/api/v1/projects/${encodeURIComponent(projectId ?? "")}/draft`;
  const scope = "/app/api/v1/jobs";
  const files = element("editor-files", HTMLSelectElement);
  const engines = element("editor-engine", HTMLSelectElement);
  const templateField = element("editor-template-field");
  const template = element("editor-template", HTMLSelectElement);
  const auto = element("editor-auto", HTMLInputElement);
  const build = element("editor-build", HTMLButtonElement);
  const cancel = element("editor-cancel", HTMLButtonElement);
  const newFile = element("editor-new-file", HTMLButtonElement);
  const upload = element("editor-upload", HTMLInputElement);
  const renameFile = element("editor-rename-file", HTMLButtonElement);
  const removeFile = element("editor-remove-file", HTMLButtonElement);
  const entrypoint = element("editor-entrypoint", HTMLButtonElement);
  const revision = element("editor-save-revision", HTMLButtonElement);
  const fileDialog = element("editor-file-dialog", HTMLDialogElement);
  const settingsDialog = element("editor-settings-dialog", HTMLDialogElement);
  const revisionOutputs = element("editor-revision-outputs", HTMLSelectElement);
  const saveStatus = element("editor-save-status");
  const previewStatus = element("editor-preview-status");
  const previewVersion = element("editor-preview-version");
  const previewMode = element("editor-preview-mode", HTMLSelectElement);
  try {
    if (localStorage.getItem(previewFormatPreference) === "png")
      previewMode.value = "png";
  } catch {
    // A browser that restricts storage can still use either preview mode.
  }
  const zoom = element("editor-zoom", HTMLSelectElement);
  const canvas = element("editor-canvas", HTMLCanvasElement);
  const detail = element("editor-build-detail", HTMLAnchorElement);
  const errorDetail = element("editor-error-detail", HTMLAnchorElement);
  const layout = element("editor-layout");
  const splitter = element("editor-split", HTMLInputElement);
  const panels = element("editor-panels");
  const errorTab = element("editor-error-tab", HTMLButtonElement);
  const actions = element("editor-source-actions");
  const search = element("editor-search", HTMLButtonElement);
  const diagnosticsStatus = element("editor-diagnostics-status");
  const errorList = element("editor-error-list");
  const source = element("editor-source");
  const smallViewport = matchMedia("(max-width: 720px)");
  const nonce = element("app-editor-script", HTMLScriptElement).nonce;
  const preview = new EditorPreview(
    canvas,
    {
      previous: element("editor-prev", HTMLButtonElement),
      next: element("editor-next", HTMLButtonElement),
      download: element("editor-pdf", HTMLAnchorElement),
      error: element("editor-pdf-error"),
    },
    (key) => text(key),
  );
  const request = <T>(url: string, init?: RequestInit) =>
    api(url, init) as Promise<T>;
  const write = <T>(url: string, method: string, data: unknown) =>
    request<T>(url, { method, body: JSON.stringify(data) });
  const uploadContent = (path: string, version: number, content: Blob) => {
    const query = new URLSearchParams({
      path,
      version: String(version),
      size: String(content.size),
    });
    return request<Draft>(`${base}/file/content?${query}`, {
      method: "PUT",
      headers: { "Content-Type": content.type },
      body: content,
    });
  };

  const revisionId = new URLSearchParams(location.search).get("revision");
  let draft = await request<Draft | null>(base);
  if (!draft) {
    draft = await write<Draft>(base, "POST", revisionId ? { revisionId } : {});
  } else if (revisionId && window.confirm(text("confirmReplace"))) {
    draft = await write<Draft>(base + "/replace", "POST", {
      revisionId,
      version: draft.version,
    });
  }
  if (revisionId) historyReplaceEditorUrl();
  revisionOutputs.value = draft.outputs?.includes("svg") ? "svg" : "pdf";
  const supported = await request<{ engines: RenderEngine[] }>(
    "/app/api/v1/environment",
  );
  for (const engine of new Set([draft.engine, ...supported.engines]))
    engines.add(new Option(engine, engine));
  engines.value = draft.engine;
  engines.disabled = false;
  const refreshFileList = (value: Draft) =>
    files.replaceChildren(
      ...value.files.map(
        ({ path }) =>
          new Option(
            value.files.length > 1 && path === value.entrypoint
              ? text("mainFile", { path })
              : path,
            path,
          ),
      ),
    );
  refreshFileList(draft);

  let selected = "",
    timer: number | undefined;
  let savedDocument: Text | undefined;
  let editor: EditorView | undefined,
    saving = false,
    conflicted = false,
    composing = false;
  let latest: Preview | undefined, watch: AbortController | undefined;
  let diagnosticsTicket: Preview | undefined;
  let shownVersion = 0;
  let shownJobId: string | undefined;
  let lastSuccess: { ticket: Preview; pageCount: number } | undefined;
  let renderPending = false;
  let changing = false;
  let alive = true;
  const isAlive = () => alive;
  const pageController = new AbortController();
  const themeObserver = new MutationObserver(displayTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme-preference"],
  });
  pageController.signal.addEventListener(
    "abort",
    () => themeObserver.disconnect(),
    { once: true },
  );

  function showJobStatus(target: HTMLElement, status: string) {
    if (jobLabels.has(status)) setText(target, status as CatalogMessage);
    else {
      translated.delete(target);
      delete target.dataset.state;
      target.textContent = status;
    }
  }

  function showBuildStatus(status: string, jobId: string) {
    showJobStatus(previewStatus, status);
    for (const link of [detail, errorDetail]) {
      link.href = `/app/jobs/${jobId}/`;
      link.hidden = false;
    }
    if (building.has(status)) return;
    errorTab.hidden = !buildFailures.has(status);
    if (errorTab.hidden && layout.dataset.panel === "errors") showPanel("source");
  }

  language.addEventListener("change", () => {
    const selectedLocale = matchDisplayLocale(language.value);
    if (!selectedLocale) return;
    language.disabled = true;
    void (async () => {
      const next = await loadEditorCatalog(selectedLocale);
      await write("/app/api/v1/me/locale", "PATCH", { locale: selectedLocale });
      if (!isAlive()) return;
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `latex_renderer_locale=${selectedLocale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
      catalog = next;
      locale = selectedLocale;
      numbers = new Intl.NumberFormat(locale);
      displayLanguage();
      editor?.dispatch({
        effects: phrases.reconfigure(EditorState.phrases.of(catalog.phrases)),
      });
      refreshFileList(current());
      files.value = selected;
    })()
      .catch((error: unknown) => showError(error, saveStatus))
      .finally(() => {
        language.value = locale;
        language.disabled = false;
      });
  });

  function historyReplaceEditorUrl() {
    const url = new URL(location.href);
    url.searchParams.delete("revision");
    window.history.replaceState(null, "", url);
  }

  function updateTemplate() {
    templateField.hidden =
      selected !== current().entrypoint || editor?.state.doc.length !== 0;
    element("editor-template-japanese", HTMLOptionElement).hidden = ![
      "platex",
      "uplatex",
    ].includes(current().engine);
  }

  function current(): Draft {
    if (!draft) throw new Error("Draft unavailable");
    return draft;
  }

  function changed(): boolean {
    return editor !== undefined && editor.state.doc !== savedDocument;
  }

  function showVersion() {
    const stale = changed() || shownVersion !== current().version;
    if (shownVersion !== 0)
      setText(previewVersion, stale ? "stalePdf" : "currentPdf", {
        version: shownVersion,
      });
  }

  function showError(error: unknown, target: HTMLElement) {
    if ((error as { code?: string } | null)?.code === "DRAFT_VERSION_CONFLICT")
      setText(target, "conflict");
    else if (error instanceof Error) {
      translated.delete(target);
      delete target.dataset.state;
      target.textContent = error.message;
    } else setText(target, "connectionFailed");
  }

  async function save(): Promise<boolean> {
    if (saving || composing || conflicted) return false;
    if (!editor || !changed()) return true;
    const document = editor.state.doc;
    const text = editor.state.sliceDoc();
    const version = current().version;
    saving = true;
    setText(saveStatus, "saving");
    try {
      draft =
        text.length <= 8192
          ? await write<Draft>(`${base}/file`, "PUT", {
              version,
              path: selected,
              text,
            })
          : await uploadContent(
              selected,
              version,
              new Blob([text], { type: "text/plain; charset=utf-8" }),
            );
      savedDocument = document;
      if (changed()) {
        schedule();
        return false;
      }
      setText(saveStatus, "saved");
      showVersion();
      return true;
    } catch (error) {
      conflicted =
        (error as { code?: string }).code === "DRAFT_VERSION_CONFLICT";
      showError(error, saveStatus);
      return false;
    } finally {
      saving = false;
    }
  }

  async function openFile(path: string) {
    if (files.disabled && selected) return false;
    const previous = selected;
    const previousEditor = editor;
    const previousDom = previousEditor?.contentDOM;
    files.value = path;
    files.disabled = true;
    if (previousDom) previousDom.contentEditable = "false";
    try {
      if (!(await save())) return false;
      if (!editable.test(path)) {
        previousEditor?.destroy();
        editor = undefined;
        selected = path;
        setText(source, "attachment");
        return true;
      }
      const query = new URLSearchParams({
        path,
        version: String(current().version),
      });
      const value = await request<{ text: string }>(`${base}/file?${query}`);
      previousEditor?.destroy();
      selected = path;
      translated.delete(source);
      source.replaceChildren();
      editor = new EditorView({
        parent: source,
        state: EditorState.create({
          doc: value.text,
          extensions: [
            EditorView.cspNonce.of(nonce),
            phrases.of(EditorState.phrases.of(catalog.phrases)),
            EditorView.contentAttributes.of({ "aria-label": path }),
            EditorState.lineSeparator.of(
              value.text.includes("\r\n") ? "\r\n" : "\n",
            ),
            lineNumbers(),
            highlightActiveLine(),
            history(),
            EditorView.lineWrapping,
            editorTools(path),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            EditorView.domEventHandlers({
              compositionstart: () => {
                composing = true;
                clearTimeout(timer);
              },
              compositionend: () => {
                composing = false;
                schedule();
              },
            }),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged) return;
              setText(saveStatus, "unsaved");
              updateTemplate();
              showVersion();
              schedule();
            }),
          ],
        }),
      });
      savedDocument = editor.state.doc;
      setText(saveStatus, "saved");
      return true;
    } catch (error) {
      showError(error, saveStatus);
      return false;
    } finally {
      if (previousDom?.isConnected) previousDom.contentEditable = "true";
      files.value = selected || previous;
      files.disabled = false;
      actions.hidden = !editor;
      updateTemplate();
      renameFile.disabled = !selected;
      removeFile.disabled = !selected || selected === current().entrypoint;
      entrypoint.disabled =
        selected === current().entrypoint || !/\.tex$/i.test(selected);
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (!isAlive() || composing || conflicted || changing) return;
    const lastInput = performance.now();
    timer = window.setTimeout(() => {
      if (auto.checked) {
        measureEditor("input-idle", lastInput);
        void compile();
      } else void save();
    }, settleMs);
  }

  function observe(ticket: Preview) {
    watch?.abort();
    const controller = new AbortController();
    watch = controller;
    const signal = controller.signal;
    const aborted = () => signal.aborted;
    let wait = 800;
    let next: number | undefined;
    const resume = () => {
      if (document.hidden || aborted()) return;
      document.removeEventListener("visibilitychange", resume);
      void poll();
    };
    const poll = async () => {
      if (aborted()) return;
      if (document.hidden) {
        document.addEventListener("visibilitychange", resume);
        return;
      }
      try {
        const job = await request<Job>(`${scope}/${ticket.jobId}`, {
          signal,
        });
        if (aborted()) return;
        showBuildStatus(job.status, ticket.jobId);
        if (!building.has(job.status)) {
          cancel.disabled = true;
          if (job.status === "succeeded")
            setText(diagnosticsStatus, "noErrors");
          else showJobStatus(diagnosticsStatus, job.status);
          if (
            job.status === "succeeded" &&
            ticket.version >=
              Math.max(shownVersion, lastSuccess?.ticket.version ?? 0)
          ) {
            lastSuccess = { ticket, pageCount: job.pdfPageCount ?? 1 };
            await showResult(lastSuccess, signal);
          } else {
            if (job.status === "failed") void showDiagnostics(ticket);
            await reconcileSuccessfulPreview(signal);
          }
          return;
        }
        wait = Math.min(wait + 500, 3500);
      } catch (error) {
        if (aborted()) return;
        const status = (error as { status?: number } | null)?.status;
        if (status === 404 || status === 410) {
          cancel.disabled = true;
          setText(previewStatus, "expired");
          return;
        }
        if (status === 401 || status === 403) {
          cancel.disabled = true;
          showError(error, previewStatus);
          return;
        }
        setText(previewStatus, "reconnect");
        wait = Math.min(wait * 2, 10000);
      }
      next = window.setTimeout(() => void poll(), wait);
    };
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(next);
        document.removeEventListener("visibilitychange", resume);
      },
      { once: true },
    );
    void poll();
  }

  function showPanel(panel: string) {
    layout.dataset.panel = panel;
    for (const button of panels.querySelectorAll<HTMLButtonElement>("button"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.panel === panel),
      );
    if (panel === "preview") showPendingPdf();
  }

  function showPendingPdf() {
    if (lastSuccess && shownJobId !== lastSuccess.ticket.jobId)
      void showResult(lastSuccess, pageController.signal);
  }

  async function reconcileSuccessfulPreview(signal: AbortSignal) {
    try {
      const { successful } = await request<PreviewActivity>(`${base}/preview`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
      if (
        signal.aborted ||
        !successful ||
        successful.version <= (lastSuccess?.ticket.version ?? 0)
      )
        return;
      lastSuccess = {
        ticket: successful,
        pageCount: successful.pageCount ?? 1,
      };
      await showResult(lastSuccess, signal);
    } catch {
      // A terminal Job needs no further polling. Leave the displayed PDF in place.
    }
  }

  async function showDiagnostics(ticket: Preview) {
    diagnosticsTicket = ticket;
    setText(diagnosticsStatus, "loadingErrors");
    errorList.replaceChildren();
    try {
      const { errors: messages } = await request<StructuredErrors>(
        `${scope}/${ticket.jobId}/artifacts/errors.json`,
        {
          signal: AbortSignal.any([
            pageController.signal,
            AbortSignal.timeout(10000),
          ]),
        },
      );
      if (diagnosticsTicket !== ticket) return;
      for (const { file, line, message } of messages.slice(0, 200)) {
        const path = file.replace(/^\.\//, "");
        const row = document.createElement("li");
        row.textContent = message;
        if (
          line !== null &&
          line > 0 &&
          editable.test(path) &&
          current().files.some((file) => file.path === path)
        ) {
          const jump = document.createElement("button");
          jump.type = "button";
          jump.className = "secondary";
          jump.textContent = `${path}:${line}`;
          jump.addEventListener(
            "click",
            () => void jumpToError(ticket, path, line),
          );
          row.prepend(jump, " ");
        }
        errorList.append(row);
      }
      if (messages.length)
        setText(diagnosticsStatus, "errorsForDraft", {
          version: ticket.version,
        });
      else setText(diagnosticsStatus, "checkLog");
    } catch {
      if (diagnosticsTicket === ticket) setText(diagnosticsStatus, "checkLog");
    }
  }

  async function jumpToError(ticket: Preview, path: string, line: number) {
    if (ticket.version !== current().version || changed()) {
      setText(diagnosticsStatus, "staleErrors");
      return;
    }
    if (selected !== path && !(await openFile(path))) return;
    const file = editor;
    if (!file || line > file.state.doc.lines) return;
    const position = file.state.doc.line(line).from;
    showPanel("source");
    file.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    file.focus();
  }

  async function showResult(
    result: NonNullable<typeof lastSuccess>,
    signal: AbortSignal,
  ) {
    if (smallViewport.matches && layout.dataset.panel !== "preview") return;
    const job = `${scope}/${result.ticket.jobId}`;
    const pdf = job + "/artifacts/result.pdf";
    const format = previewMode.value === "png" ? "png" : "pdf";
    const started = performance.now();
    const rendered =
      format === "png"
        ? await preview.showPng(
            {
              pdf,
              pageCount: result.pageCount,
              path: (page) => `${job}/previews/page-${page}.png`,
            },
            signal,
          )
        : await preview.show(pdf, signal);
    if (rendered && !signal.aborted) {
      measureEditor(`${format}-load-and-paint`, started);
      shownVersion = result.ticket.version;
      shownJobId = result.ticket.jobId;
      showVersion();
    }
  }

  async function compile(force = false) {
    if (renderPending || composing || changing || !isAlive()) return;
    const started = performance.now();
    renderPending = true;
    let queued = false;
    try {
      if (!(await save())) return;
      if (
        !force &&
        selected === current().entrypoint &&
        editor?.state.doc.length === 0
      )
        return;
      if (!force && latest?.version === current().version) return;
      const ticket = await write<Preview>(`${base}/preview`, "POST", {
        version: current().version,
      });
      measureEditor("save-and-queue", started);
      latest = ticket;
      queued = true;
      if (!isAlive()) return;
      diagnosticsTicket = undefined;
      setText(diagnosticsStatus, "waitForResult");
      errorList.replaceChildren();
      cancel.disabled = false;
      setText(previewStatus, "queued");
      observe(ticket);
    } catch (error) {
      showError(error, previewStatus);
    } finally {
      renderPending = false;
      if (queued && changed()) schedule();
    }
  }

  files.addEventListener("change", () => void openFile(files.value));
  for (const trigger of section.querySelectorAll<HTMLButtonElement>(
    "[data-editor-dialog]",
  )) {
    const id = trigger.dataset.editorDialog;
    if (!id) continue;
    const dialog = element(id, HTMLDialogElement);
    trigger.addEventListener("click", () => dialog.showModal());
  }
  search.addEventListener("click", () => {
    if (!editor) return;
    fileDialog.close();
    openSearchPanel(editor);
  });
  splitter.addEventListener("input", () => {
    layout.style.setProperty("--editor-source-weight", `${splitter.value}fr`);
    layout.style.setProperty(
      "--editor-preview-weight",
      `${100 - splitter.valueAsNumber}fr`,
    );
  });
  panels.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const panel = event.target.dataset.panel;
    if (panel)
      showPanel(
        panel === "errors" && layout.dataset.panel === panel ? "source" : panel,
      );
  });
  actions.addEventListener("mousedown", (event) => {
    if (
      event.target instanceof HTMLButtonElement &&
      event.target.dataset.insert
    )
      event.preventDefault();
  });
  actions.addEventListener("click", (event) => {
    if (
      !(event.target instanceof HTMLButtonElement) ||
      !event.target.dataset.insert ||
      !editor ||
      composing ||
      changing ||
      files.disabled
    )
      return;
    fileDialog.close();
    editor.dispatch(editor.state.replaceSelection(event.target.dataset.insert));
    editor.focus();
  });
  template.addEventListener("change", () => {
    const file = editor;
    const choice = template.value;
    template.value = "";
    if (
      !file ||
      file.state.doc.length !== 0 ||
      selected !== current().entrypoint
    )
      return;
    let documentClass: string;
    let example: string;
    if (choice === "article" || choice === "report") {
      documentClass = `\\documentclass{${choice}}`;
      example = "Hello, LaTeX!";
    } else if (
      choice === "japanese" &&
      ["platex", "uplatex"].includes(current().engine)
    ) {
      const options =
        current().engine === "uplatex" ? "uplatex,dvipdfmx" : "dvipdfmx";
      documentClass = `\\documentclass[${options}]{jsarticle}`;
      example = "日本語の文書";
    } else return;
    file.dispatch({
      changes: {
        from: 0,
        insert: `${documentClass}\n\\begin{document}\n${example}\n\\end{document}\n`,
      },
    });
    file.focus();
  });
  const mutate = async (callback: () => Promise<void>) => {
    if (changing || files.disabled) return;
    changing = true;
    clearTimeout(timer);
    // Freeze the document while the selected file or its build settings change.
    const previous = editor;
    const dom = previous?.contentDOM;
    if (dom) dom.contentEditable = "false";
    try {
      if (await save()) await callback();
    } catch (error) {
      conflicted =
        (error as { code?: string }).code === "DRAFT_VERSION_CONFLICT";
      showError(error, saveStatus);
    } finally {
      if (dom?.isConnected) dom.contentEditable = "true";
      changing = false;
      showVersion();
      if (auto.checked) schedule();
    }
  };
  const patchFiles = async (
    data: { files: unknown[]; entrypoint?: string; engine?: string },
    path: string,
  ) => {
    draft = await write<Draft>(base, "PATCH", {
      version: current().version,
      ...data,
    });
    refreshFileList(current());
    await openFile(path);
  };
  newFile.addEventListener("click", () => {
    const path = window.prompt(text("fileName"));
    if (!path || !editable.test(path)) return;
    fileDialog.close();
    if (current().files.some((file) => file.path === path)) {
      setText(saveStatus, "existingFile");
      return;
    }
    void mutate(async () => {
      draft = await write<Draft>(`${base}/file`, "PUT", {
        version: current().version,
        path,
        text: "",
      });
      refreshFileList(current());
      await openFile(path);
    });
  });
  upload.addEventListener("change", () => {
    const file = upload.files?.item(0);
    upload.value = "";
    if (!file) return;
    const path = window.prompt(text("attachmentPath"), file.name);
    if (!path) return;
    if (
      current().files.some((item) => item.path === path) &&
      !window.confirm(text("replaceFile", { path }))
    )
      return;
    fileDialog.close();
    void mutate(async () => {
      const content = file.slice(0, file.size, "application/octet-stream");
      draft = await uploadContent(path, current().version, content);
      refreshFileList(current());
      await openFile(path);
    });
  });
  renameFile.addEventListener("click", () => {
    const from = current().files.find(({ path }) => path === selected);
    if (!from) return;
    const path = window.prompt(text("newName"), selected);
    if (!path || path === selected) return;
    fileDialog.close();
    if (current().files.some((file) => file.path === path)) {
      setText(saveStatus, "existingFile");
      return;
    }
    void mutate(async () => {
      const latest = current().files.find(({ path }) => path === from.path);
      if (!latest) return;
      await patchFiles(
        {
          ...(latest.path === current().entrypoint ? { entrypoint: path } : {}),
          files: [
            { path: latest.path, remove: true },
            { path, sourceId: latest.sourceId, sourcePath: latest.sourcePath },
          ],
        },
        path,
      );
    });
  });
  removeFile.addEventListener("click", () => {
    const path = selected;
    if (
      path === current().entrypoint ||
      !window.confirm(text("confirmDelete", { path }))
    )
      return;
    fileDialog.close();
    void mutate(() =>
      patchFiles({ files: [{ path, remove: true }] }, current().entrypoint),
    );
  });
  entrypoint.addEventListener("click", () => {
    const path = selected;
    fileDialog.close();
    void mutate(() => patchFiles({ entrypoint: path, files: [] }, path));
  });
  revision.addEventListener("click", () => {
    const displayName = window.prompt(text("revisionName"));
    if (!displayName?.trim()) return;
    settingsDialog.close();
    void mutate(async () => {
      await write(`${base}/revisions`, "POST", {
        displayName: displayName.trim(),
        version: current().version,
        outputs: revisionOutputs.value === "svg" ? ["pdf", "svg"] : ["pdf"],
      });
      setText(saveStatus, "revisionSaved");
    });
  });
  engines.addEventListener("change", () => {
    const engine = engines.value;
    engines.disabled = true;
    void mutate(async () => {
      draft = await write<Draft>(base, "PATCH", {
        version: current().version,
        engine,
        files: [],
      });
      setText(saveStatus, "engineSaved");
    }).finally(() => {
      engines.value = current().engine;
      engines.disabled = false;
      updateTemplate();
    });
  });
  auto.addEventListener("change", schedule);
  previewMode.addEventListener("change", () => {
    try {
      localStorage.setItem(previewFormatPreference, previewMode.value);
    } catch {
      // Keep the selected format for this page when storage is restricted.
    }
    if (lastSuccess) void showResult(lastSuccess, AbortSignal.timeout(12000));
  });
  smallViewport.addEventListener(
    "change",
    () => {
      if (!smallViewport.matches) showPendingPdf();
    },
    { signal: pageController.signal },
  );
  zoom.addEventListener("change", () => {
    canvas.style.width = zoom.value;
    canvas.dataset.zoomed = String(zoom.value !== "");
  });
  build.addEventListener("click", () => void compile(true));
  const cancelPreview = async () => {
    if (!latest) return;
    cancel.disabled = true;
    try {
      await write(`${scope}/${latest.jobId}/cancel`, "POST", {});
    } catch (error) {
      showError(error, previewStatus);
    }
  };
  cancel.addEventListener("click", () => void cancelPreview());
  addEventListener("beforeunload", (event) => {
    if (changed()) event.preventDefault();
  });
  addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    alive = false;
    pageController.abort();
    clearTimeout(timer);
    watch?.abort();
    editor?.destroy();
    void preview.destroy();
  });

  await openFile(current().entrypoint);
  try {
    const activity = await request<PreviewActivity>(base + "/preview", {
      signal: pageController.signal,
    });
    if (activity.successful) {
      lastSuccess = {
        ticket: activity.successful,
        pageCount: activity.successful.pageCount ?? 1,
      };
      void showResult(lastSuccess, pageController.signal);
    }
    if (activity.latest) {
      latest = activity.latest;
      showBuildStatus(activity.latest.status, latest.jobId);
      if (building.has(activity.latest.status)) {
        cancel.disabled = false;
        observe(latest);
      } else if (activity.latest.status === "failed")
        void showDiagnostics(latest);
      else if (buildFailures.has(activity.latest.status))
        showJobStatus(diagnosticsStatus, activity.latest.status);
    }
  } catch (error) {
    if (isAlive()) showError(error, previewStatus);
  }
  newFile.disabled = false;
  upload.disabled = false;
  revision.disabled = false;
  build.disabled = false;
  language.disabled = false;
  if (auto.checked) schedule();
}
