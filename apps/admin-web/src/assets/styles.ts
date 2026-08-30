export const styles = `
:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color-scheme: light dark;
  line-height: 1.55;
  --page: #ffffff;
  --surface: #ffffff;
  --surface-subtle: #f5f5f5;
  --surface-strong: #e8e8e8;
  --text: #151515;
  --muted: #666666;
  --border: #d4d4d4;
  --button: #171717;
  --button-text: #ffffff;
  --focus: #171717;
  --danger: #a11212;
  --danger-text: #ffffff;
  --warning: #8a4b00;
  --success: #176b36;
  --shadow: 0 12px 35px rgba(0, 0, 0, 0.08);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --page: #090909;
    --surface: #111111;
    --surface-subtle: #1a1a1a;
    --surface-strong: #262626;
    --text: #f4f4f4;
    --muted: #adadad;
    --border: #3b3b3b;
    --button: #f4f4f4;
    --button-text: #111111;
    --focus: #f4f4f4;
    --danger: #c83f3f;
    --danger-text: #ffffff;
    --warning: #d89a45;
    --success: #65b982;
    --shadow: 0 12px 35px rgba(0, 0, 0, 0.35);
  }
}

:root[data-theme="dark"] {
  --page: #090909;
  --surface: #111111;
  --surface-subtle: #1a1a1a;
  --surface-strong: #262626;
  --text: #f4f4f4;
  --muted: #adadad;
  --border: #3b3b3b;
  --button: #f4f4f4;
  --button-text: #111111;
  --focus: #f4f4f4;
  --danger: #c83f3f;
  --danger-text: #ffffff;
  --warning: #d89a45;
  --success: #65b982;
  --shadow: 0 12px 35px rgba(0, 0, 0, 0.35);
}

* { box-sizing: border-box; }
html { background: var(--page); color: var(--text); }
body { margin: 0; min-height: 100vh; background: var(--page); color: var(--text); }
a { color: inherit; text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; }
a:hover { text-decoration-thickness: 0.14em; }
button, input, select, textarea { font: inherit; }
button, .button, input, select, textarea {
  border: 1px solid var(--border);
  border-radius: 0.55rem;
  padding: 0.58rem 0.78rem;
}
button, .button {
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
button.danger, .button.danger { background: var(--danger); color: var(--danger-text); border-color: var(--danger); }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 3px;
}
input, select, textarea { width: 100%; background: var(--surface); color: var(--text); }
textarea { min-height: 7rem; resize: vertical; }
label { display: grid; gap: 0.35rem; }
fieldset { border: 1px solid var(--border); border-radius: 0.65rem; padding: 0.8rem; }
legend { padding: 0 0.35rem; font-weight: 700; }

.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.9rem max(1rem, calc((100vw - 1180px) / 2));
  background: color-mix(in srgb, var(--page) 92%, transparent);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(14px);
}
.site-header strong { margin-right: auto; white-space: nowrap; }
nav { display: flex; flex-wrap: wrap; align-items: center; gap: 0.8rem; }
nav a { text-decoration: none; color: var(--muted); }
nav a:hover, nav a[aria-current="page"] { color: var(--text); }
nav a[aria-current="page"] { font-weight: 750; text-decoration: underline; }
.header-meta { display: flex; align-items: center; gap: 0.55rem; color: var(--muted); font-size: 0.9rem; }

main { width: min(1180px, 100%); margin: 0 auto; padding: 2rem 1.25rem 4rem; }
.hero { padding: clamp(2.5rem, 8vw, 6rem) 0 3rem; max-width: 780px; }
.hero h1 { margin: 0 0 1rem; font-size: clamp(2.3rem, 7vw, 5rem); line-height: 1.02; letter-spacing: -0.04em; }
.hero p { font-size: clamp(1rem, 2.2vw, 1.2rem); }
.eyebrow { color: var(--muted); font-weight: 700; letter-spacing: 0.03em; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(235px, 1fr)); gap: 1rem; }
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
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 0.85rem; align-items: end; }
.form-grid .wide { grid-column: 1 / -1; }
[hidden] { display: none !important; }
.stack { display: grid; gap: 0.75rem; }
.muted { color: var(--muted); }
.notice { border-left: 4px solid var(--text); padding: 0.8rem 1rem; background: var(--surface-subtle); }
.notice.warning { border-left-color: var(--warning); }
.notice.success { border-left-color: var(--success); }
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

.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 0.7rem; }
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

@media (max-width: 700px) {
  .page-heading { display: block; }
  .page-heading .actions { justify-content: flex-start; }
}

.dialog-backdrop, dialog::backdrop { background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(2px); }
dialog { width: min(680px, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); overflow: auto; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 0.9rem; box-shadow: var(--shadow); padding: 1.1rem; }
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

@media (max-width: 820px) {
  .site-header { align-items: flex-start; flex-wrap: wrap; }
  .site-header strong { width: 100%; }
  nav { order: 3; width: 100%; overflow-x: auto; flex-wrap: nowrap; padding-bottom: 0.2rem; }
  nav a { white-space: nowrap; }
  .header-meta { margin-left: auto; }
  main { padding-top: 1.25rem; }
  dialog, dialog.wide { width: calc(100vw - 1rem); max-height: calc(100vh - 1rem); padding: 0.9rem; }
  .dialog-actions { display: grid; grid-template-columns: 1fr; }
  .dialog-actions button { width: 100%; }
  .docs-layout { grid-template-columns: 1fr; }
  .docs-sidebar { position: static; max-height: none; }
}
`;
