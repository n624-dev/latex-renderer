import type { DisplayLocale } from "@latex-renderer/shared/locale";
import { appLabels } from "./app-messages.js";
import { editorChrome, type EditorChromeMessage } from "./editor/chrome-messages.js";
import { escapeHtml, siteLanguagePicker, siteMessageMetadata } from "./templates-shared.js";

function appHeader(page: string, locale: DisplayLocale): string {
  const t = appLabels(locale);
  const links = [
  ["render", t("convertToPdf"), "/app/", "appRender"],
  ["history", t("history"), "/app/history/", "appHistory"],
  ["projects", t("projects"), "/app/projects/", "appProjects"],
  ["environment", t("renderingEnvironment"), "/app/environment/", "appEnvironment"],
] as const;
  return `<header class="site-header"><strong><a href="/app/">LaTeX Renderer</a></strong><nav class="admin-nav" aria-label="${escapeHtml(t("applicationNavigation"))}" data-editor-aria="appNavigation">${links.map(([id, label, url, key]) => `<a href="${url}" data-editor-message="${key}"${id === page ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a>`).join("")}</nav><div class="header-meta">${siteLanguagePicker(locale, (choice) => `?locale=${choice}`)}<a id="admin-link" class="button secondary" href="/admin/" data-editor-message="appAdmin" hidden>${escapeHtml(t("administration"))}</a><button type="button" class="secondary" data-theme-toggle>${escapeHtml(t("themeSystem"))}</button><button id="app-logout" type="button" class="secondary" data-editor-message="appLogout">${escapeHtml(t("signOut"))}</button></div></header>`;
}

function shell(
  page: string,
  title: string,
  content: string,
  locale: DisplayLocale,
  nonce?: string,
  editorVersion?: string,
): string {
  const t = appLabels(locale);
  const editorAssets = editorVersion
    ? `/app/assets/editor/${editorVersion}/`
    : undefined;
  const editorNonce =
    nonce === undefined
      ? ""
      : ` id="app-editor-script" nonce="${escapeHtml(nonce)}"${editorAssets ? ` data-editor-entrypoint="${editorAssets}editor.js"` : ""}`;
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">${siteMessageMetadata(locale, page === "editor")}<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)} | LaTeX Renderer</title><link rel="stylesheet" href="${editorAssets ? editorAssets + "styles.css" : "/app/assets/styles.css"}"><script data-cfasync="false" src="/app/assets/site.js"></script></head><body data-app-page="${escapeHtml(page)}"><a class="skip-link" href="#main-content" data-editor-message="skipContent">${escapeHtml(t("skipToContent"))}</a>${page === "editor" ? "" : appHeader(page, locale)}<main id="main-content"><p id="app-error" role="alert"></p><p id="app-status" role="status" aria-live="polite"></p>${content}</main><script${editorNonce} data-cfasync="false" type="module" src="/app/assets/app.js?locale=${locale}"></script></body></html>`;
}

export function appRenderPage(locale: DisplayLocale = "ja"): string {
  const t = appLabels(locale);
  return shell(
    "render",
    t("convertToPdf"),
    `<div class="hero render-hero"><h1>${escapeHtml(t("convertLatexToPdf"))}</h1></div><section><form id="app-render-form" class="stack"><label class="file-picker drop-zone" id="app-drop-zone" for="app-files"><strong>${escapeHtml(t("dropATexOrZipFile"))}</strong><span>${escapeHtml(t("orClickToSelectFilesMax"))}</span><input id="app-files" type="file" accept=".zip,.tex,application/zip" multiple required></label><div id="app-entrypoints" class="stack" hidden></div><details id="app-render-options"><summary>${escapeHtml(t("destinationAndOutputOptions"))}</summary><label>${escapeHtml(t("destination"))}<select id="app-project-select"><option value="">${escapeHtml(t("newProject"))}</option></select></label><label id="app-project-name-field">${escapeHtml(t("newProjectName"))}<input id="app-project-name" maxlength="200" placeholder="${escapeHtml(t("autoFilledFromFileName"))}"></label><label>${escapeHtml(t("engine"))}<select id="app-render-engine"><option value="lualatex">LuaLaTeX</option></select></label><label><input id="app-render-svg" type="checkbox"> ${escapeHtml(t("alsoExportMathAndTikzAs"))}</label><p id="app-render-engine-notice" hidden>${escapeHtml(t("svgOutputIsUnverifiedForThis"))}</p></details><div class="actions"><button id="app-render-start" type="submit" disabled>${escapeHtml(t("convertToPdf"))}</button></div></form></section><section id="app-render-results" hidden><h2>${escapeHtml(t("conversionStatus"))}</h2><div id="app-render-items" class="stack"></div></section><section><h2>${escapeHtml(t("recentConversions"))}</h2><div id="app-recent-jobs">${escapeHtml(t("loading"))}</div><a href="/app/history/">${escapeHtml(t("allConversionHistory"))}</a></section>`,
    locale,
  );
}

export function appHistoryPage(locale: DisplayLocale = "ja"): string {
  const t = appLabels(locale);
  return shell(
    "history",
    t("conversionHistory"),
    `<div class="hero"><h1>${escapeHtml(t("conversionHistory"))}</h1></div><section><div id="app-history">${escapeHtml(t("loading"))}</div></section>`,
    locale,
  );
}

export function appProjectsPage(locale: DisplayLocale = "ja"): string {
  const t = appLabels(locale);
  return shell(
    "projects",
    t("projects"),
    `<div class="hero"><h1>${escapeHtml(t("projects"))}</h1></div><section><form id="app-project-create" class="inline-form"><label>${escapeHtml(t("newProjectName"))}<input name="displayName" maxlength="200" required></label><button type="submit">${escapeHtml(t("create"))}</button></form></section><section><div id="app-projects">${escapeHtml(t("loading"))}</div></section>`,
    locale,
  );
}

export function appProjectPage(locale: DisplayLocale = "ja"): string {
  const t = appLabels(locale);
  return shell(
    "projects",
    t("projectDetails"),
    `<div id="app-project-detail">${escapeHtml(t("loading"))}</div>`,
    locale,
  );
}

function editorDialog(
  id: string,
  heading: EditorChromeMessage,
  locale: DisplayLocale,
  content: string,
): string {
  const chrome = editorChrome[locale];
  return `<dialog id="${id}" class="editor-dialog" aria-labelledby="${id}-title">
    <div class="editor-dialog-heading">
      <h2 id="${id}-title" data-editor-message="${heading}">${escapeHtml(chrome[heading])}</h2>
      <form method="dialog"><button class="editor-icon ghost" type="submit" aria-label="${escapeHtml(chrome.close)}" data-editor-aria="close">×</button></form>
    </div>
    ${content}
  </dialog>`;
}

export function appProjectEditorPage(
  projectId: string,
  nonce: string,
  editorVersion?: string,
  locale: DisplayLocale = "ja",
): string {
  const t = appLabels(locale);
  const chrome = editorChrome[locale];
  const label = (key: Parameters<typeof t>[0]) => escapeHtml(t(key));
  const fileDialog = editorDialog("editor-file-dialog", "manageFiles", locale, `
    <div class="editor-dialog-controls">
      <button id="editor-new-file" type="button" class="ghost" disabled data-editor-message="addFile">${label("addTextFile")}</button>
      <label><span data-editor-message="attachFile">${label("attachAFile")}</span><input id="editor-upload" type="file" accept=".png,.jpg,.jpeg,.pdf,.tex,.sty,.cls,.bib,.bst,.csv,.dat,.txt" disabled></label>
    </div>
    <div class="editor-dialog-controls editor-dialog-group">
      <button id="editor-rename-file" type="button" class="ghost" disabled data-editor-message="renameFile">${label("renameFile")}</button>
      <button id="editor-remove-file" type="button" class="ghost" disabled data-editor-message="deleteFile">${label("deleteFile")}</button>
      <button id="editor-entrypoint" type="button" class="ghost" disabled data-editor-message="setMain">${label("setAsMainDocument")}</button>
    </div>
    <div id="editor-source-actions" class="editor-dialog-controls editor-dialog-group" hidden>
      <button id="editor-search" type="button" class="ghost" data-editor-message="searchReplace">${label("searchAndReplace")}</button>
      <div class="editor-shortcuts" role="group" aria-label="${escapeHtml(chrome.insertSymbols)}" data-editor-aria="insertSymbols">
        <button type="button" class="ghost" data-insert="&#92;">&#92;</button>
        <button type="button" class="ghost" data-insert="{">{</button>
        <button type="button" class="ghost" data-insert="}">}</button>
        <button type="button" class="ghost" data-insert="$">$</button>
        <button type="button" class="ghost" data-insert="%">%</button>
      </div>
    </div>`);
  const settings = editorDialog("editor-settings-dialog", "editorSettings", locale, `
    <div class="editor-dialog-controls">
      <label><span data-editor-message="engine">${label("engine")}</span><select id="editor-engine" disabled></select></label>
      <label><input id="editor-auto" type="checkbox" checked> <span data-editor-message="autoCompile">${label("autoCompile")}</span></label>
    </div>
    <div class="editor-dialog-controls editor-dialog-group">
      <label><span data-editor-message="revisionOutputs">${label("outputsForTheSavedRevision")}</span><select id="editor-revision-outputs"><option value="pdf">PDF</option><option value="svg">PDF + SVG</option></select></label>
      <button id="editor-save-revision" type="button" class="ghost" disabled data-editor-message="saveRevision">${label("saveARevision")}</button>
    </div>
    <div class="editor-dialog-controls editor-dialog-group">
      <label><span data-editor-message="language">${label("displayLanguage")}</span><select id="editor-language" disabled></select></label>
      <button type="button" class="ghost" data-theme-toggle>${label("themeSystem")}</button>
      <label class="editor-split-control"><span data-editor-message="editorWidth">${label("editorWidth")}</span><input id="editor-split" type="range" min="30" max="70" value="50"></label>
      <a id="editor-build-detail" hidden data-editor-message="buildLog">${label("compileResultAndLog")}</a>
    </div>`);
  const previewSettings = editorDialog("editor-preview-dialog", "previewSettings", locale, `
    <div class="editor-dialog-controls">
      <label><span data-editor-message="format">${label("previewFormat")}</span>
        <select id="editor-preview-mode"><option value="pdf">PDF</option><option value="png" data-editor-message="lightweightPng">${label("pngLightweightPreview")}</option></select>
      </label>
      <label><span data-editor-message="zoom">${label("zoom")}</span>
        <select id="editor-zoom"><option value="" data-editor-message="fitWidth">${label("fitWidth")}</option><option value="125%">125%</option><option value="150%">150%</option><option value="200%">200%</option></select>
      </label>
    </div>`);
  return shell(
    "editor",
    t("texEditor"),
    `<section id="app-editor" data-project-id="${escapeHtml(projectId)}">
      <header class="editor-header">
        <a class="editor-icon editor-back" href="/app/projects/${escapeHtml(projectId)}/" aria-label="${label("backToProject")}" data-editor-aria="back"><span aria-hidden="true"></span></a>
        <h1 data-editor-message="title">${label("texEditor")}</h1>
        <div class="editor-main-actions">
          <button id="editor-build" type="button" disabled data-editor-message="compile">${label("compile")}</button>
          <button id="editor-cancel" type="button" class="ghost" disabled data-editor-message="cancel">${label("cancel")}</button>
          <button type="button" class="ghost" data-editor-dialog="editor-settings-dialog" aria-haspopup="dialog" data-editor-message="editorSettings">${escapeHtml(chrome.editorSettings)}</button>
        </div>
      </header>
      <div class="editor-body">
        <div class="editor-feedback">
          <p id="editor-save-status" role="status" data-editor-message="loading">${label("loading")}</p>
          <button id="editor-review-conflict" type="button" class="ghost" data-editor-message="reviewConflict" hidden></button>
          <button id="editor-save-copy" type="button" class="ghost" data-editor-message="saveUnsavedCopy" hidden></button>
          <p id="editor-preview-status" role="status"></p>
        </div>
        <div id="editor-panels" role="group" aria-label="${label("editorView")}" data-editor-aria="editorView">
          <button type="button" data-panel="source" aria-controls="editor-workspace" aria-pressed="true" data-editor-message="code">${label("code")}</button>
          <button type="button" data-panel="preview" aria-controls="editor-preview-body" aria-pressed="false">PDF</button>
          <button id="editor-error-tab" type="button" data-panel="errors" aria-controls="editor-errors" aria-pressed="false" hidden data-editor-message="errors">${label("errors")}</button>
        </div>
        <div id="editor-layout" class="editor-layout" data-panel="source">
          <div id="editor-workspace">
            <div class="editor-pane-bar">
              <select id="editor-files" aria-label="${label("file")}" data-editor-aria="file" disabled></select>
              <button type="button" class="ghost" data-editor-dialog="editor-file-dialog" aria-haspopup="dialog" data-editor-message="manageFiles">${escapeHtml(chrome.manageFiles)}</button>
            </div>
            <label id="editor-template-field" hidden><span data-editor-message="template">${label("template")}</span>
              <select id="editor-template">
                <option value="" data-editor-message="chooseTemplate">${label("chooseATemplate")}</option>
                <option value="article" data-editor-message="article">${label("article")}</option>
                <option value="report" data-editor-message="report">${label("report")}</option>
                <option id="editor-template-japanese" value="japanese" hidden data-editor-message="japaneseDocument">${label("japaneseDocument")}</option>
              </select>
            </label>
            <div id="editor-source"></div>
          </div>
          <div id="editor-preview">
            <div id="editor-preview-body">
              <div class="editor-pane-bar">
                <h2>PDF</h2>
                <div class="editor-preview-actions">
                  <div class="editor-pager">
                    <button id="editor-prev" type="button" class="editor-icon ghost" disabled aria-label="${label("previousPage")}" data-editor-aria="previousPage">‹</button>
                    <button id="editor-next" type="button" class="editor-icon ghost" disabled aria-label="${label("nextPage")}" data-editor-aria="nextPage">›</button>
                  </div>
                  <button type="button" class="editor-icon ghost" data-editor-dialog="editor-preview-dialog" aria-haspopup="dialog" aria-label="${escapeHtml(chrome.previewSettings)}" data-editor-aria="previewSettings">⋯</button>
                  <a id="editor-pdf" class="button ghost" hidden data-editor-message="downloadPdf">${label("savePdf")}</a>
                </div>
              </div>
              <p id="editor-preview-version"></p>
              <div class="editor-preview-scroll"><canvas id="editor-canvas" hidden></canvas></div>
              <p id="editor-pdf-error" role="alert" hidden></p>
              <p id="editor-preview-notice" role="status" hidden></p>
            </div>
            <div id="editor-errors" aria-live="polite">
              <p id="editor-diagnostics-status" data-editor-message="noErrors">${label("noCompileErrors")}</p>
              <ol id="editor-error-list"></ol>
              <a id="editor-error-detail" hidden data-editor-message="buildLog">${label("compileResultAndLog")}</a>
            </div>
          </div>
        </div>
      </div>
      ${fileDialog}${settings}${previewSettings}
      <dialog id="editor-conflict-dialog" aria-labelledby="editor-conflict-title">
        <h2 id="editor-conflict-title" data-editor-message="reviewConflict"></h2>
        <p id="editor-conflict-path"></p>
        <p id="editor-conflict-status" role="status"></p>
        <div class="editor-conflict-diff">
          <div><h3 data-editor-message="currentServerFile"></h3><pre id="editor-conflict-server"></pre></div>
          <div><h3 data-editor-message="unsaved"></h3><pre id="editor-conflict-local"></pre></div>
        </div>
        <button id="editor-conflict-apply" type="button" data-editor-message="applyMyEdits" disabled></button>
        <form method="dialog"><button class="ghost" data-editor-message="close"></button></form>
      </dialog>
    </section>`,
    locale,
    nonce,
    editorVersion,
  );
}

export function appJobPage(locale: DisplayLocale = "ja"): string {
  const t = appLabels(locale);
  return shell(
    "history",
    t("conversionResult"),
    `<div id="app-job-detail">${escapeHtml(t("loading"))}</div>`,
    locale,
  );
}

export function appEnvironmentPage(locale: DisplayLocale = "ja"): string {
  const t = appLabels(locale);
  return shell(
    "environment",
    t("renderingEnvironment"),
    `<div class="hero"><h1>${escapeHtml(t("renderingEnvironment"))}</h1></div><section id="app-environment-summary">${escapeHtml(t("loading"))}</section><div class="grid"><section><h2>${escapeHtml(t("checkPackages"))}</h2><form id="app-package-search" class="inline-form"><label>${escapeHtml(t("name"))}<input name="query" maxlength="100" placeholder="tikz" required></label><button type="submit">${escapeHtml(t("search"))}</button></form><div id="app-package-results"></div></section><section><h2>${escapeHtml(t("checkFonts"))}</h2><form id="app-font-search" class="inline-form"><label>${escapeHtml(t("name"))}<input name="query" maxlength="100" placeholder="Harano Aji" required></label><button type="submit">${escapeHtml(t("search"))}</button></form><div id="app-font-results"></div></section></div>`,
    locale,
  );
}
