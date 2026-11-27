import { readFileSync } from "node:fs";
import type { DisplayLocale } from "@latex-renderer/shared/locale";
import { clientSetupMessages } from "./messages.js";
import { setupDiagnosticCatalog, type ClientPackageManager } from "@latex-renderer/setup-core";

export const setupHtml = clientSetupHtml();

function escapeSetupHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function clientSetupHtml(
  packageManager?: ClientPackageManager,
  locale: DisplayLocale = "ja",
): string {
  const catalog = clientSetupMessages(locale);
  const t = (key: keyof typeof catalog) => catalog[key];
  const copy = escapeSetupHtml(JSON.stringify({ messages: catalog, diagnostics: setupDiagnosticCatalog(locale) }));
  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="latex-renderer-setup-copy" content="${copy}">
  <title>${escapeSetupHtml(t("clientSettingsLatexRenderer"))}</title>
  <link rel="stylesheet" href="/assets/setup.css">
</head>
<body>
  <main>
    <header>
      <h1>${escapeSetupHtml(t("clientSettings"))}</h1>
      <button id="close" class="quiet" type="button">${escapeSetupHtml(t("exitSetup"))}</button>
    </header>
    <p id="connection" class="notice">${escapeSetupHtml(t("startingASecureLocalSession"))}</p>
    <section>
      <div class="section-heading"><h2>${escapeSetupHtml(t("statusAndDiagnostics"))}</h2><button id="refresh" type="button">${escapeSetupHtml(t("runDiagnosticsAgain"))}</button></div>
      <div id="status-summary" role="status" aria-live="polite">${escapeSetupHtml(t("waiting"))}</div>
      <details><summary>${escapeSetupHtml(t("detailedDiagnosticData"))}</summary><pre id="status"></pre></details>
    </section>
    <div class="grid">
      <section>
        <h2>${escapeSetupHtml(t("authentication"))}</h2>
        <p>${escapeSetupHtml(t("theKeyIsStoredSecurelyAnd"))}</p>
        <label for="api-key">${escapeSetupHtml(t("renderApiKey"))}</label>
        <input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="lrk_…">
        <div class="actions"><button id="save-key" type="button">${escapeSetupHtml(t("save"))}</button><button id="remove-key" class="quiet" type="button">${escapeSetupHtml(t("delete"))}</button></div>
      </section>
      <section>
        <h2>${escapeSetupHtml(t("aiIntegrations"))}</h2>
        ${
          packageManager === "apt"
            ? `<p>${escapeSetupHtml(t("registerLocalMcpManuallyForApt"))}</p>`
            : `
        <p>${escapeSetupHtml(t("onlyTheSelectedIntegrationsAreConfigured"))}</p>
        <label for="skill-target">${escapeSetupHtml(t("skill"))}</label>
        <select id="skill-target"><option value="both">Codex + Claude</option><option value="codex">Codex</option><option value="claude">Claude</option><option value="none">${escapeSetupHtml(t("doNotConfigure"))}</option></select>
        <label for="mcp-target">MCP</label>
        <select id="mcp-target"><option value="both">Codex + Claude</option><option value="codex">Codex</option><option value="claude">Claude</option><option value="none">${escapeSetupHtml(t("doNotConfigure"))}</option></select>
        <div class="actions"><button id="repair" type="button">${escapeSetupHtml(t(packageManager ? "configureIntegrations" : "repairAndIntegrate"))}</button>${packageManager ? "" : `<button id="update" class="quiet" type="button">${escapeSetupHtml(t("clientUpdate"))}</button>`}</div>
        `
        }
      </section>
    </div>
    <section>
      <div class="section-heading"><div><h2>${escapeSetupHtml(t("sampleRender"))}</h2><p>${escapeSetupHtml(t("testTheFullPathFromAuthentication"))}</p></div><button id="sample" type="button">${escapeSetupHtml(t("run"))}</button></div>
      <div id="result-summary" role="status" aria-live="polite">${escapeSetupHtml(t("notRun"))}</div>
      <details><summary>${escapeSetupHtml(t("detailedResultData"))}</summary><pre id="result"></pre></details>
    </section>
  </main>
  <script src="/assets/setup.js" defer></script>
</body>
</html>`;
}

export const setupCss = `
:root { color-scheme:light dark; font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --page:#f5f5f5; --surface:#ffffff; --subtle:#eeeeee; --text:#1a1a1a; --muted:#595959; --border:#808080; --button:#262626; --button-text:#ffffff;
  background:var(--page); color:var(--text); accent-color:var(--button); }
@media(prefers-color-scheme:dark) { :root {
  --page:#111111; --surface:#1b1b1b; --subtle:#242424; --text:#f5f5f5; --muted:#bdbdbd; --border:#737373; --button:#ededed; --button-text:#171717;
} }
* { box-sizing:border-box; }
::selection { background:var(--button); color:var(--button-text); }
body { margin:0; min-height:100vh; background:var(--page); }
main { width:min(980px,calc(100% - 2rem)); margin:0 auto; padding:2.5rem 0 5rem; }
header,.section-heading,.actions { display:flex; align-items:center; justify-content:space-between; gap:1rem; }
h1 { font-size:clamp(1.5rem,4vw,2rem); margin:.1rem 0 1rem; }
h2 { margin:0 0 .45rem; font-size:1.15rem; }
p { color:var(--muted); line-height:1.6; margin:.2rem 0 1rem; }
.eyebrow { color:var(--muted); font-size:.72rem; font-weight:800; letter-spacing:.18em; margin:0; }
section { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:1.25rem; margin:1rem 0; }
summary { cursor:pointer; padding:.65rem 0; min-height:44px; }
dl { display:grid; grid-template-columns:auto minmax(0,1fr); gap:.5rem 1rem; } dd { margin:0; }
.grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1rem; }
.grid section { margin:0; }
.notice { padding:.8rem 1rem; border-left:3px solid var(--text); background:var(--subtle); border-radius:4px; }
.notice.error { border-left-style:double; border-left-width:6px; color:var(--text); font-weight:700; }
label { display:block; font-size:.82rem; font-weight:700; margin:.85rem 0 .35rem; }
input,select { width:100%; border:1px solid var(--border); border-radius:8px; padding:.72rem .8rem; background:var(--surface); color:var(--text); font:inherit; }
button { border:1px solid var(--button); border-radius:8px; padding:.68rem .9rem; background:var(--button); color:var(--button-text); font-weight:750; cursor:pointer; }
button:not(:disabled):hover { filter:contrast(1.1); }
button:not(:disabled):active { filter:contrast(1.2); }
input:disabled,select:disabled { background:var(--subtle); color:var(--muted); cursor:not-allowed; }
button:disabled { opacity:.55; cursor:wait; }
.quiet { background:var(--subtle); color:var(--text); border-color:var(--border); }
.actions { justify-content:flex-start; margin-top:1rem; flex-wrap:wrap; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:22rem; overflow:auto; background:var(--subtle); border:1px solid var(--border); border-radius:8px; padding:1rem; color:var(--text); font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace; }
@media(max-width:720px) { .grid { grid-template-columns:1fr; } header,.section-heading { align-items:flex-start; flex-direction:column; } }
main,section,.grid > * { min-inline-size:0; }
body { overflow-wrap:anywhere; min-height:100svh; }
input,select { min-width:0; min-height:44px; font-size:max(1rem,16px); }
button { min-width:44px; min-height:44px; font:inherit; font-weight:700; }
:focus-visible { outline:3px solid var(--button); outline-offset:3px; }
@media(max-width:480px) { main { width:calc(100% - 1.5rem); padding-top:1.25rem; padding-bottom:max(3rem,env(safe-area-inset-bottom)); } section { padding:1rem; } .actions > button { flex:1 1 10rem; } }
`;

declare const __latexRendererSetupBrowserScript: string | undefined;

export const setupJavaScript = typeof __latexRendererSetupBrowserScript === "string"
  ? __latexRendererSetupBrowserScript
  : readFileSync(new URL("./setup-browser.js", import.meta.url), "utf8");
