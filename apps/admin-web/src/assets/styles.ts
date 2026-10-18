export const styles = `
:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color-scheme: light dark;
  accent-color: var(--button);
  line-height: 1.55;
  --page: #f5f5f5;
  --surface: #ffffff;
  --surface-subtle: #eeeeee;
  --surface-strong: #e0e0e0;
  --text: #1a1a1a;
  --muted: #595959;
  --border: #808080;
  --button: #262626;
  --button-text: #ffffff;
  --focus: #262626;
  --danger: #262626;
  --danger-text: #ffffff;
  --warning: #525252;
  --success: #404040;
  --shadow: 0 12px 35px rgba(0, 0, 0, 0.08);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --page: #111111;
    --surface: #1b1b1b;
    --surface-subtle: #242424;
    --surface-strong: #303030;
    --text: #f5f5f5;
    --muted: #bdbdbd;
    --border: #737373;
    --button: #ededed;
    --button-text: #171717;
    --focus: #f5f5f5;
    --danger: #ededed;
    --danger-text: #171717;
    --warning: #c7c7c7;
    --success: #dddddd;
    --shadow: 0 12px 35px rgba(0, 0, 0, 0.35);
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #111111;
  --surface: #1b1b1b;
  --surface-subtle: #242424;
  --surface-strong: #303030;
  --text: #f5f5f5;
  --muted: #bdbdbd;
  --border: #737373;
  --button: #ededed;
  --button-text: #171717;
  --focus: #f5f5f5;
  --danger: #ededed;
  --danger-text: #171717;
  --warning: #c7c7c7;
  --success: #dddddd;
  --shadow: 0 12px 35px rgba(0, 0, 0, 0.35);
}

:root[data-theme="light"] { color-scheme: light; }

* { box-sizing: border-box; }
::selection { background: var(--button); color: var(--button-text); }
html { background: var(--page); color: var(--text); scrollbar-gutter: stable; scroll-padding-block-start: 7rem; }
body { margin: 0; min-height: 100vh; min-height: 100svh; background: var(--page); color: var(--text); overflow-wrap: anywhere; }
main, section, article, fieldset, .card, .stack, .form-grid > *, .grid > * { min-inline-size: 0; }
img, svg, video { max-inline-size: 100%; }
h1, h2, h3 { text-wrap: balance; line-height: 1.25; }
a { color: inherit; text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; }
a:hover { text-decoration-thickness: 0.14em; }
.skip-link { position: absolute; z-index: 100; top: 0.5rem; left: 0.75rem; transform: translateY(-160%); padding: 0.6rem 0.85rem; border-radius: 0.45rem; background: var(--button); color: var(--button-text); font-weight: 750; }
.skip-link:focus { transform: translateY(0); }
button, input, select, textarea { font: inherit; }
button, .button, input, select, textarea {
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  padding: 0.58rem 0.78rem;
}
button, .button {
  min-height: 44px;
  min-width: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  background: var(--button);
  color: var(--button-text);
  text-decoration: none;
  cursor: pointer;
  font-weight: 650;
}
button:hover, .button:hover { filter: contrast(1.1); text-decoration: none; }
button:disabled { cursor: not-allowed; opacity: 0.52; }
button.secondary, .button.secondary { background: var(--surface-strong); color: var(--text); }
button.ghost, .button.ghost { background: transparent; color: var(--text); }
button.danger, .button.danger { background: var(--danger); color: var(--danger-text); border: 3px double var(--danger-text); font-weight: 750; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 3px;
}
input, select, textarea { width: 100%; min-width: 0; min-height: 44px; font-size: max(1rem, 16px); background: var(--surface); color: var(--text); }
input[type="checkbox"], input[type="radio"] { width: 1.25rem; height: 1.25rem; min-height: 0; flex: 0 0 auto; accent-color: var(--button); }
label:has(> input[type="checkbox"]), label:has(> input[type="radio"]) { display: flex; align-items: center; gap: 0.65rem; min-height: 44px; cursor: pointer; }
textarea { min-height: 7rem; resize: vertical; }
label { display: grid; gap: 0.35rem; }
fieldset { border: 1px solid var(--border); border-radius: 0.65rem; padding: 0.8rem; }
legend { padding: 0 0.35rem; font-weight: 700; }

.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  padding: 0.9rem max(1rem, calc((100vw - 1180px) / 2));
  background: color-mix(in srgb, var(--page) 92%, transparent);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(14px);
}
.site-header strong { margin-right: auto; white-space: nowrap; }
nav { display: flex; flex-wrap: nowrap; min-width: 0; max-width: 100%; overflow-x: auto; align-items: center; gap: 0.35rem; overscroll-behavior-inline: contain; }
nav a { flex: 0 0 auto; min-height: 44px; display: inline-flex; align-items: center; padding: 0.5rem 0.65rem; border-radius: 0.5rem; text-decoration: none; color: var(--muted); }
nav a:hover, nav a[aria-current="page"] { color: var(--text); }
nav a[aria-current="page"] { font-weight: 750; background: var(--surface-strong); color: var(--text); text-decoration: none; }
.header-meta { display: flex; flex-wrap: wrap; min-width: 0; align-items: center; gap: 0.55rem; color: var(--muted); font-size: 0.9rem; overflow-wrap: anywhere; }

main { width: min(1180px, 100%); margin: 0 auto; padding: clamp(1rem, 3vw, 2rem) max(0.75rem, env(safe-area-inset-left)) max(4rem, env(safe-area-inset-bottom)); }
.hero { padding: clamp(2.5rem, 8vw, 6rem) 0 3rem; max-width: 780px; }
.hero h1 { margin: 0 0 1rem; font-size: clamp(2.3rem, 7vw, 5rem); line-height: 1.02; letter-spacing: -0.04em; }
.hero p { font-size: clamp(1rem, 2.2vw, 1.2rem); }
.eyebrow { color: var(--muted); font-weight: 700; letter-spacing: 0.03em; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 235px), 1fr)); gap: 1rem; }
.card, section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.9rem;
  padding: 1.1rem;
  margin-bottom: 1rem;
}
.card { box-shadow: var(--shadow); }
.card h2, section h2 { margin-top: 0; }
.actions { display: flex; flex-wrap: wrap; gap: 0.55rem; margin: 0.9rem 0; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 1rem; align-items: end; }
.form-grid .wide { grid-column: 1 / -1; }
[hidden] { display: none !important; }
.stack { display: grid; gap: 0.75rem; }
.muted { color: var(--muted); }
.notice { border-left: 4px solid var(--text); padding: 0.8rem 1rem; background: var(--surface-subtle); }
.notice.warning { border-left-color: var(--warning); border-left-style: dashed; }
.notice.success { border-left-color: var(--success); border-left-style: double; }
.code-label { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
.file-picker { border: 2px dashed var(--border); border-radius: 0.8rem; padding: 1.25rem; background: var(--surface-subtle); cursor: pointer; }
.file-picker:hover, .file-picker:focus-within { border-color: var(--focus); }
.file-picker span { color: var(--muted); }
.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 0.8rem; margin: 0 0 1rem; }
.summary-grid > div { min-width: 0; border: 1px solid var(--border); border-radius: 0.65rem; padding: 0.75rem; background: var(--surface-subtle); }
.summary-grid .wide { grid-column: 1 / -1; }
.summary-grid dt { color: var(--muted); font-size: 0.85rem; font-weight: 700; }
.summary-grid dd { margin: 0.3rem 0 0; overflow-wrap: anywhere; }
.render-hero { padding-bottom: 2rem; }
.render-preview { margin: 1rem 0; padding: 0; text-align: center; }
.render-preview img { display: block; width: min(100%, 900px); height: auto; margin: 0 auto; border: 1px solid var(--border); border-radius: 0.65rem; background: #fff; box-shadow: var(--shadow); }
.preview-controls { display: flex; align-items: center; justify-content: center; gap: 0.8rem; margin: 0.8rem 0; }
.page-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin: 1rem 0; }
.page-heading h1 { margin: 0.25rem 0; }
.page-heading .actions { justify-content: flex-end; }
.result-state { display: grid; gap: 0.75rem; justify-items: start; }
.error-summary { color: var(--danger); white-space: pre-wrap; }
.diagnostics { display: grid; gap: 0.6rem; margin-top: 0.75rem; }
.diagnostic { border-left: 4px solid var(--danger); padding: 0.6rem 0.8rem; background: var(--surface-subtle); }
.diagnostic p { margin: 0.35rem 0 0; white-space: pre-wrap; }
.source-tree { columns: 2 280px; padding-left: 1.5rem; }
.source-tree li { break-inside: avoid; margin-bottom: 0.35rem; }

.table-wrap { max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; border: 1px solid var(--border); border-radius: 0.7rem; }
table { border-collapse: collapse; width: 100%; min-width: 700px; font-size: 0.92rem; }
th, td { border-bottom: 1px solid var(--border); padding: 0.68rem; text-align: left; vertical-align: top; }
th { background: var(--surface-subtle); white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
.actions-cell { display: flex; flex-wrap: wrap; gap: 0.4rem; min-width: 180px; }
.status { display: inline-flex; align-items: center; gap: 0.35rem; border: 1px solid var(--border); border-radius: 999px; padding: 0.15rem 0.55rem; white-space: nowrap; }
.status::before { content: ""; width: 0.55rem; height: 0.55rem; border-radius: 50%; background: currentColor; }
.status.active, .status.succeeded, .status.running { color: var(--success); }
.status.disabled, .status.failed, .status.rejected, .status.timeout { color: var(--danger); }
.status.queued, .status.validating, .status.uploading, .status.reserved, .status.draining { color: var(--warning); }
.status.disabled::before, .status.failed::before, .status.rejected::before, .status.timeout::before { border-radius: 0; }
.status.queued::before, .status.validating::before, .status.uploading::before, .status.reserved::before, .status.draining::before { border: 2px solid currentColor; background: transparent; border-radius: 0; transform: rotate(45deg); }
.status.running::before { border: 2px solid currentColor; background: transparent; }

pre { overflow: auto; margin: 0.8rem 0; padding: 1rem; border-radius: 0.65rem; background: var(--surface-subtle); border: 1px solid var(--border); }
code { overflow-wrap: anywhere; }
details { border: 1px solid var(--border); border-radius: 0.65rem; padding: 0.75rem 0.9rem; margin: 0.75rem 0; }
summary { cursor: pointer; font-weight: 700; }

#error, #render-error, #app-error { color: var(--danger); white-space: pre-wrap; }
#success { color: var(--success); white-space: pre-wrap; }
.credential { word-break: break-all; border: 1px solid var(--warning); padding: 1rem; border-radius: 0.65rem; background: var(--surface-subtle); }
.empty { padding: 1.5rem; text-align: center; color: var(--muted); }
.drop-zone { border: 2px dashed var(--border); border-radius: 0.85rem; padding: 2rem; text-align: center; cursor: pointer; }
.drop-zone:hover, .drop-zone:focus-within { border-color: var(--focus); background: var(--surface-subtle); }
.drop-zone input { margin-inline: auto; }
.render-result-card { border: 1px solid var(--border); border-radius: 0.75rem; padding: 1rem; background: var(--surface); }

@media (max-width: 860px) {
  .page-heading { display: block; }
  .page-heading .actions { justify-content: flex-start; }
  .table-wrap:has(.responsive-table) { overflow: visible; border: 0; }
  .responsive-table, .responsive-table thead, .responsive-table tbody, .responsive-table tr, .responsive-table th, .responsive-table td { display: block; min-width: 0; }
  .responsive-table thead { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .responsive-table tbody { display: grid; gap: 0.75rem; }
  .responsive-table tr { border: 1px solid var(--border); border-radius: 0.7rem; background: var(--surface); overflow: hidden; }
  .responsive-table td { display: grid; grid-template-columns: minmax(6.5rem, 38%) minmax(0, 1fr); gap: 0.65rem; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
  .responsive-table td::before { content: attr(data-label); color: var(--muted); font-weight: 700; }
  .responsive-table td:last-child { border-bottom: 0; }
  .responsive-table td.actions-cell { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .responsive-table td.actions-cell::before { flex: 0 0 100%; }
}

.dialog-backdrop, dialog::backdrop { background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(2px); }
dialog { width: min(680px, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); max-height: calc(100dvh - 2rem); overflow: auto; overscroll-behavior: contain; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 0.9rem; box-shadow: var(--shadow); padding: 1.1rem; }
body:has(dialog[open]) { overflow: hidden; }
dialog :focus-visible { scroll-margin-block: 1rem; }
dialog.wide { width: min(900px, calc(100vw - 2rem)); }
.dialog-heading { display: flex; align-items: flex-start; gap: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem; margin-bottom: 0.85rem; }
.dialog-heading h2 { margin: 0; flex: 1; }
.dialog-close { flex: 0 0 auto; min-width: 2.5rem; padding: 0.35rem 0.6rem; font-size: 1.35rem; line-height: 1; }
.dialog-description { color: var(--muted); overflow-wrap: anywhere; }
.dialog-form { display: grid; gap: 0.9rem; }
.dialog-fields { align-items: start; }
.dialog-summary { padding: 0.15rem 0; }
.dialog-summary > :first-child { margin-top: 0; }
.dialog-summary > :last-child { margin-bottom: 0; }
.dialog-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 0.55rem; border-top: 1px solid var(--border); padding-top: 0.85rem; margin-top: 0.35rem; }
.dialog-error { color: var(--danger); min-height: 1.55em; margin: 0; white-space: pre-wrap; }
.dialog-error:empty { display: none; }
.dialog-json { max-height: min(65vh, 720px); }
.admin-dialog[data-busy="true"] .dialog-close { visibility: hidden; }

.docs-layout { display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); gap: 2rem; align-items: start; }
.docs-sidebar { position: sticky; top: 5.5rem; max-height: calc(100vh - 7rem); overflow: auto; display: grid; gap: 0.7rem; }
.docs-nav { display: grid; gap: 1rem; padding: 0.8rem 1rem; border: 1px solid var(--border); border-radius: 0.7rem; background: var(--surface-subtle); }
.docs-nav-group { display: grid; gap: 0.3rem; padding: 0; margin: 0; border: 0; background: transparent; }
.docs-nav-group h2 { margin: 0; color: var(--muted); font-size: 0.78rem; text-transform: uppercase; }
.docs-nav-group a { padding: 0.18rem 0; }
.docs-search-results { font-size: 0.86rem; }
.docs-search-results ul { margin: 0; padding-left: 1.2rem; }
.docs-main { min-width: 0; }
.docs-hero { padding-top: 2.5rem; }
.docs-meta { color: var(--muted); font-size: 0.9rem !important; }
.docs-content { max-width: 860px; }
.docs-content h2, .docs-content h3 { scroll-margin-top: 6rem; }
.heading-permalink { margin-left: 0.45rem; color: var(--muted); font-size: 0.72em; text-decoration: none; }
.heading-permalink:hover, .heading-permalink:focus-visible { color: var(--text); }
.notice.note { border-left-color: var(--focus); }
.docs-toc { display: grid; gap: 0.3rem; border-left: 3px solid var(--border); padding: 0.6rem 1rem; margin-bottom: 1.5rem; }
.docs-toc .toc-depth-3 { padding-left: 1rem; font-size: 0.92rem; }
.docs-pager { justify-content: space-between; border-top: 1px solid var(--border); margin-top: 2rem; padding-top: 1rem; }
.docs-content pre { position: relative; padding-top: 2.8rem; }
.code-copy { position: absolute; top: 0.45rem; right: 0.45rem; padding: 0.28rem 0.55rem; font-size: 0.8rem; }
.endpoint { border-left: 4px solid var(--text); }
.endpoint code:first-child { font-weight: 800; }

@media (max-width: 1100px) {
  .site-header nav { order: 3; flex-basis: 100%; width: 100%; }
}

@media (max-width: 820px) {
  html { scroll-padding-block-start: 1rem; }
  .site-header { position: static; }
  .site-header { align-items: flex-start; flex-wrap: wrap; }
  .site-header strong { align-self: center; }
  nav { order: 3; width: 100%; min-width: 0; overflow-x: auto; flex-wrap: nowrap; padding-bottom: 0.2rem; }
  nav a { white-space: nowrap; min-height: 44px; display: inline-flex; align-items: center; }
  .header-meta { margin-left: 0; }
  main { padding-top: 1.25rem; }
  dialog, dialog.wide { width: calc(100vw - 1rem); max-height: calc(100vh - 1rem); max-height: calc(100dvh - 1rem); padding: 0.9rem; }
  .dialog-actions { display: grid; grid-template-columns: 1fr; }
  .dialog-actions button { width: 100%; }
  .docs-layout { grid-template-columns: 1fr; }
  .docs-sidebar { position: static; max-height: none; }
}

@media (max-width: 480px) {
  .site-header { padding: 0.65rem 0.75rem; gap: 0.5rem; }
  .card, section { padding: 0.9rem; }
  .actions > button, .actions > .button { flex: 1 1 12rem; }
  .responsive-table td { grid-template-columns: minmax(5rem, 30%) minmax(0, 1fr); gap: 0.5rem; }
  .preview-controls { flex-wrap: wrap; gap: 0.5rem; }
  .code-label { flex-wrap: wrap; }
  dialog, dialog.wide { width: 100%; margin-block-end: 0; border-radius: 1rem 1rem 0 0; padding-bottom: max(0.9rem, env(safe-area-inset-bottom)); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; }
}
`;
