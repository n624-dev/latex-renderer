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
  --control-gap: 0.625rem;
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
button:enabled:hover, .button:not([aria-disabled="true"]):hover { filter: contrast(1.1); text-decoration: none; }
button:enabled:active, .button:not([aria-disabled="true"]):active { filter: contrast(1.25); }
button:disabled { cursor: not-allowed; opacity: 0.52; }
button.secondary, .button.secondary { background: var(--surface-strong); color: var(--text); }
button.ghost, .button.ghost { background: transparent; color: var(--text); }
button.danger, .button.danger { background: var(--danger); color: var(--danger-text); border: 3px double var(--danger-text); padding: calc(0.58rem - 2px) calc(0.78rem - 2px); font-weight: 750; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 3px;
}
input, select, textarea { width: 100%; min-width: 0; min-height: 44px; font-size: max(1rem, 16px); background: var(--surface); color: var(--text); }
input:disabled, select:disabled, textarea:disabled { background: var(--surface-subtle); color: var(--muted); border-style: dashed; cursor: not-allowed; }
input[type="file"]::file-selector-button { font: inherit; min-height: 44px; margin-inline-end: var(--control-gap); padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 0.4rem; background: var(--surface-strong); color: var(--text); cursor: pointer; }
input[type="checkbox"], input[type="radio"] { width: 1.25rem; height: 1.25rem; min-height: 0; margin: 0.2rem 0 0; flex: 0 0 auto; accent-color: var(--button); }
label:has(> input[type="checkbox"]), label:has(> input[type="radio"]) { display: flex; align-items: flex-start; gap: 0.65rem; min-height: 44px; cursor: pointer; }
label.check { display: grid; grid-template-columns: 1.25rem minmax(0, 1fr); align-items: start; }
label.check > input { grid-column: 1; grid-row: 1 / span 2; }
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
  background: var(--page);
  border-bottom: 1px solid var(--border);
}
.site-header strong { margin-right: auto; white-space: nowrap; }
.site-header nav { display: flex; flex-wrap: nowrap; min-width: 0; max-width: 100%; overflow-x: auto; align-items: center; gap: 0.35rem; padding: 0.25rem; overscroll-behavior-inline: contain; }
.site-header nav a { flex: 0 0 auto; min-height: 44px; display: inline-flex; align-items: center; padding: 0.5rem 0.65rem; border-radius: 0.5rem; text-decoration: none; color: var(--muted); }
.site-header nav a:focus-visible { outline-offset: -3px; }
.site-header nav a:hover, .site-header nav a[aria-current="page"] { color: var(--text); }
.site-header nav a[aria-current="page"] { font-weight: 750; background: var(--surface-strong); color: var(--text); text-decoration: none; }
.header-meta { display: flex; flex-wrap: wrap; min-width: 0; align-items: center; gap: 0.55rem; color: var(--muted); font-size: 0.9rem; overflow-wrap: anywhere; }

main { width: min(1180px, 100%); margin: 0 auto; padding: clamp(1rem, 3vw, 2rem) max(0.75rem, env(safe-area-inset-left)) max(4rem, env(safe-area-inset-bottom)); }
.hero { padding: 0.5rem 0 1rem; max-width: 780px; }
.hero h1 { margin: 0 0 0.75rem; font-size: clamp(1.6rem, 4vw, 2.25rem); line-height: 1.2; }
.hero p { font-size: 1rem; }
.eyebrow { color: var(--muted); font-weight: 700; letter-spacing: 0.03em; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 235px), 1fr)); gap: 1rem; }
.card, section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.9rem;
  padding: 1.1rem;
  margin-bottom: 1rem;
}
.card { box-shadow: none; }
section section, .card section { border: 0; border-radius: 0; background: transparent; padding: 0.5rem 0; }
.grid > .card, .grid > section { margin-bottom: 0; }
.card h2, section h2 { margin-top: 0; }
.actions { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--control-gap); margin: 0.9rem 0; }
.actions > details { flex: 1 1 100%; }
.actions > .danger:not(:first-child), .actions-group > .danger:not(:first-child) { margin-inline-start: 0.35rem; }
.inline-form, .filter-bar { display: flex; flex-wrap: wrap; align-items: end; gap: var(--control-gap); margin: 0.75rem 0 1rem; }
.inline-form > input, .filter-bar > input, .filter-bar > select { flex: 1 1 14rem; width: auto; }
.inline-form > label, .filter-bar > label { flex: 1 1 14rem; }
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
.details { display: grid; grid-template-columns: minmax(6rem, auto) minmax(0, 1fr); gap: 0.5rem 1rem; }
.details dt { font-weight: 650; }
.details dd { margin: 0; min-width: 0; }
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
table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
table.wide-table { min-width: 700px; }
th, td { border-bottom: 1px solid var(--border); padding: 0.68rem; text-align: left; vertical-align: top; }
th { background: var(--surface-subtle); white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
.actions-cell { min-width: 180px; }
.actions-group { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--control-gap); }
.row-options { margin: 0; min-width: 0; }
.identifier { border: 0; margin: 0; background: transparent; }
.identifier > summary { padding-inline: 0; font-size: 0.85rem; }
.row-options > .actions { margin-block: 0.5rem; }
.header-options { min-width: 0; margin: 0; }
.header-options > summary { white-space: nowrap; }
.header-options[open] { flex-basis: 100%; }
.header-options .stack { padding-block: 0.5rem; }
.check > span { min-width: 0; overflow-wrap: anywhere; }
.check > span > small { display: block; color: var(--muted); }
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
details { border: 1px solid var(--border); border-radius: 0.65rem; margin: 0.75rem 0; }
summary { cursor: pointer; font-weight: 700; min-height: 44px; padding: 0.65rem 0.9rem; }
details > :not(summary) { margin-inline: 0.9rem; margin-bottom: 0.75rem; }
.job-technical code { white-space: pre-wrap; display: block; }
#app-error:empty, #app-status:empty, #error:empty, #success:empty { margin: 0; }
.login-panel { max-width: 30rem; margin-inline: auto; }

#error, #render-error, #app-error { color: var(--danger); white-space: pre-wrap; }
#success { color: var(--success); white-space: pre-wrap; }
.credential { word-break: break-all; border: 1px solid var(--warning); padding: 1rem; border-radius: 0.65rem; background: var(--surface-subtle); }
.empty { padding: 1.5rem; text-align: center; color: var(--muted); }
.drop-zone { border: 2px dashed var(--border); border-radius: 0.85rem; padding: 2rem; text-align: center; cursor: pointer; }
.drop-zone:hover, .drop-zone:focus-within { border-color: var(--focus); background: var(--surface-subtle); }
.drop-zone input { margin-inline: auto; }
.render-result-card { border: 1px solid var(--border); border-radius: 0.75rem; padding: 1rem; background: var(--surface); }

@media (max-width: 860px) {
  .page-heading { display: grid; }
  .page-heading .actions { justify-content: flex-start; }
  .table-wrap:has(.responsive-table) { overflow: visible; border: 0; }
  .responsive-table, .responsive-table thead, .responsive-table tbody, .responsive-table tr, .responsive-table th, .responsive-table td { display: block; min-width: 0; }
  .responsive-table thead { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .responsive-table tbody { display: grid; gap: 0.75rem; }
  .responsive-table tr { border: 1px solid var(--border); border-radius: 0.7rem; background: var(--surface); overflow: hidden; }
  .responsive-table td { display: grid; grid-template-columns: minmax(6.5rem, 38%) minmax(0, 1fr); gap: 0.65rem; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
  .responsive-table td::before { content: attr(data-label); color: var(--muted); font-weight: 700; }
  .responsive-table tr:last-child td { border-bottom: 1px solid var(--border); }
  .responsive-table td:last-child { border-bottom: 0; }
  .responsive-table td.actions-cell { display: block; }
  .responsive-table td.actions-cell::before { display: block; margin-bottom: 0.5rem; }
}

.dialog-backdrop, dialog::backdrop { background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(2px); }
dialog { width: min(680px, calc(100% - 2rem)); max-height: calc(100vh - 2rem); max-height: calc(100dvh - 2rem); overflow: auto; overscroll-behavior: contain; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 0.9rem; box-shadow: var(--shadow); padding: 1.1rem; }
body:has(dialog[open]) { overflow: hidden; }
dialog :focus-visible { scroll-margin-block: 1rem; }
dialog.wide { width: min(900px, calc(100% - 2rem)); }
.dialog-heading { position: sticky; top: -1.1rem; z-index: 2; background: var(--surface); display: flex; align-items: flex-start; gap: 1rem; border-bottom: 1px solid var(--border); padding-block: 0.5rem 0.75rem; margin-bottom: 0.85rem; }
.dialog-heading h2 { margin: 0; flex: 1; }
.dialog-close { flex: 0 0 auto; min-width: 44px; min-height: 44px; padding: 0.35rem 0.6rem; font-size: 1.35rem; line-height: 1; }
.dialog-description { color: var(--muted); overflow-wrap: anywhere; }
.dialog-form { display: grid; gap: 0.9rem; }
.dialog-fields { align-items: start; max-height: min(50dvh, 36rem); overflow: auto; overscroll-behavior: contain; padding: 0.25rem; }
.dialog-summary { padding: 0.15rem 0; }
.dialog-summary > :first-child { margin-top: 0; }
.dialog-summary > :last-child { margin-bottom: 0; }
.dialog-actions { position: sticky; bottom: -1.1rem; z-index: 1; display: flex; justify-content: flex-end; flex-wrap: wrap; gap: var(--control-gap); border-top: 1px solid var(--border); background: var(--surface); padding-block: 0.85rem max(0.85rem, env(safe-area-inset-bottom)); margin-top: 0.35rem; }
.dialog-error { color: var(--danger); min-height: 1.55em; margin: 0; white-space: pre-wrap; }
.dialog-error:empty { display: none; }
.dialog-json { max-height: min(65vh, 720px); }
.update-log { max-height: 24rem; }
.admin-dialog[data-busy="true"] .dialog-close { visibility: hidden; }

.docs-layout { display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); gap: 2rem; align-items: start; }
.docs-sidebar { position: sticky; top: 5.5rem; max-height: calc(100vh - 7rem); overflow: auto; display: grid; gap: 0.7rem; }
.docs-nav { display: grid; gap: 1rem; padding: 0.8rem 1rem; border: 1px solid var(--border); border-radius: 0.7rem; background: var(--surface-subtle); }
.docs-nav-group { display: grid; gap: 0.3rem; padding: 0; margin: 0; border: 0; background: transparent; }
.docs-nav-group h2 { margin: 0; color: var(--muted); font-size: 0.78rem; text-transform: uppercase; }
.docs-nav-group a { padding: 0.25rem 0.5rem; }
.docs-menu { border: 0; background: transparent; }
.docs-menu > summary { font-weight: 650; }
.docs-menu > .docs-nav { margin: 0; }
.docs-search-results { font-size: 0.86rem; }
.docs-search-results ul { margin: 0; padding-left: 1.2rem; }
.docs-main { min-width: 0; }
.docs-hero { padding: 0 0 1rem; border: 0; background: transparent; }
.docs-meta { color: var(--muted); font-size: 0.9rem !important; }
.docs-content { max-width: 860px; }
.docs-content h2, .docs-content h3 { scroll-margin-top: 6rem; }
.heading-permalink { margin-left: 0.45rem; color: var(--muted); font-size: 0.72em; text-decoration: none; opacity: 0; }
.docs-content :is(h1,h2,h3,h4,h5,h6):hover .heading-permalink, .heading-permalink:focus-visible { color: var(--text); opacity: 1; }
.notice.note { border-left-color: var(--focus); }
.docs-toc { display: grid; gap: 0.3rem; border-left: 3px solid var(--border); padding: 0.6rem 1rem; margin-bottom: 1.5rem; }
.docs-toc .toc-depth-3 { padding-left: 1rem; font-size: 0.92rem; }
.docs-pager { justify-content: space-between; border-top: 1px solid var(--border); margin-top: 2rem; padding-top: 1rem; }
.code-block { min-width: 0; margin-block: 0.8rem; }
.code-toolbar { display: flex; justify-content: flex-end; padding-bottom: 0.35rem; }
.code-block pre { margin: 0; }
.code-copy { padding: 0.28rem 0.55rem; font-size: 0.8rem; }
.endpoint { border-left: 4px solid var(--text); }
.endpoint code:first-child { font-weight: 800; }

@media (max-width: 1100px) {
  html { scroll-padding-block-start: 1rem; }
  .site-header { position: static; }
  .site-header nav { order: 3; flex-basis: 100%; width: 100%; }
  .docs-sidebar { position: static; max-height: none; }
}

@media (max-width: 820px) {
  html { scroll-padding-block-start: 1rem; }
  .site-header { position: static; }
  .site-header { align-items: flex-start; flex-wrap: wrap; }
  .site-header strong { align-self: center; }
  .site-header nav { order: 3; width: 100%; min-width: 0; overflow-x: auto; flex-wrap: nowrap; padding-bottom: 0.25rem; }
  .site-header nav a { white-space: nowrap; min-height: 44px; display: inline-flex; align-items: center; }
  .header-meta { margin-left: 0; }
  main { padding-top: 1.25rem; }
  dialog, dialog.wide { width: calc(100% - 1rem); max-height: calc(100vh - 1rem); max-height: calc(100dvh - 1rem); padding: 0.9rem; }
  .dialog-actions { display: grid; grid-template-columns: 1fr; }
  .dialog-actions button { width: 100%; }
  .docs-layout { grid-template-columns: 1fr; }
  .docs-sidebar { position: static; max-height: none; }
}

@media (max-width: 480px) {
  .site-header { padding: 0.65rem 0.75rem; gap: 0.5rem; }
  .card, section { padding: 0.9rem; }
  .actions > button, .actions > .button { flex: 0 1 auto; }
  .responsive-table td { grid-template-columns: minmax(5rem, 30%) minmax(0, 1fr); gap: 0.5rem; }
  .preview-controls { flex-wrap: wrap; gap: 0.5rem; }
  .code-label { flex-wrap: wrap; }
  dialog, dialog.wide { width: calc(100% - 1rem); max-width: calc(100% - 1rem); margin: auto; padding-bottom: max(0.9rem, env(safe-area-inset-bottom)); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; }
}
`;
