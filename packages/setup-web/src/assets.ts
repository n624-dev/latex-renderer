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
  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
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

const setupController = `"use strict";
(() => {
  const byId = (id) => document.getElementById(id);
  const connection = byId("connection");
  const status = byId("status");
  const result = byId("result");
  let sessionToken = "";
  let csrfToken = "";
  let busy = false;

  const show = (target, value) => {
    target.textContent = JSON.stringify(value, null, 2);
    const summary = byId(target === status ? "status-summary" : "result-summary");
    summary.replaceChildren();
    const labels = { healthy:setupMessage("healthy"), degraded:setupMessage("needsAttention"), not_installed:setupMessage("notInstalled"), pass:setupMessage("healthy"), warn:setupMessage("warning"), fail:setupMessage("failed"), succeeded:setupMessage("succeeded"), failed:setupMessage("failed"), timeout:setupMessage("timedOut"), canceled:setupMessage("canceled"), rejected:setupMessage("rejected"), queued:setupMessage("queued"), running:setupMessage("processing") };
    const message = document.createElement("p");
    const report = value?.doctor || value?.setup || value;
    const state = value?.job?.status || report?.status;
    message.textContent = value?.success === false ? setupMessage("failurePrefix") + (value.message || setupMessage("operationFailed")) : labels[state] || setupMessage("operationCompleted");
    summary.append(message);
    if (value?.job?.errorMessage) { const error = document.createElement("p"); error.textContent = value.job.errorMessage; summary.append(error); }
    const checks = Array.isArray(report?.checks) ? report.checks : [];
    if (checks.length) {
      const list = document.createElement("ul");
      const names = { installation:setupMessage("installation"), client:setupMessage("client"), credential:setupMessage("credentials"), skill:setupMessage("skillIntegration"), mcp:setupMessage("mcpIntegration"), launcher:setupMessage("launcher") };
      for (const check of checks) {
        const item = document.createElement("li");
        const name = names[String(check.id).split(".")[0]] || setupMessage("diagnosticCheck");
        item.textContent = name + ": " + (labels[check.status] || setupMessage("unverified")) + (check.status === "pass" ? "" : " — " + setupDiagnostic(check.message));
        list.append(item);
      }
      summary.append(list);
    }
  };
  const setBusy = (value) => {
    busy = value;
    for (const button of document.querySelectorAll("button")) button.disabled = value;
  };
  const api = async (path, body = {}) => {
    const response = await fetch(path, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + sessionToken,
        "X-CSRF-Token": csrfToken
      },
      body: JSON.stringify(body)
    });
    const value = await response.json();
    if (!response.ok || value.success !== true) throw new Error(setupDiagnostic(value.error?.message || "Request failed"));
    return value.result;
  };
  const refresh = async () => {
    const [setup, doctor] = await Promise.all([api("/api/status"), api("/api/doctor")]);
    const allowed = new Set(["both", "codex", "claude", "none"]);
    if (allowed.has(setup?.state?.skillTarget)) byId("skill-target").value = setup.state.skillTarget;
    if (allowed.has(setup?.state?.mcpTarget)) byId("mcp-target").value = setup.state.mcpTarget;
    show(status, { setup, doctor });
  };
  const run = async (operation, target = result) => {
    if (busy) return;
    setBusy(true);
    try { show(target, await operation()); await refresh(); }
    catch (error) { show(target, { success: false, message: error instanceof Error ? error.message : "Unknown error" }); }
    finally { setBusy(false); }
  };

  const bootstrap = async () => {
    const bootstrapToken = location.hash.slice(1);
    history.replaceState(null, "", location.pathname);
    if (!bootstrapToken) throw new Error(setupMessage("tokenMissing"));
    const response = await fetch("/api/session", {
      method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bootstrapToken })
    });
    const value = await response.json();
    if (!response.ok || value.success !== true) throw new Error(value.error?.message || "Session bootstrap failed");
    sessionToken = value.result.sessionToken;
    csrfToken = value.result.csrfToken;
    connection.textContent = setupMessage("browserSetup");
    await refresh();
  };

  byId("refresh").addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    try { await refresh(); }
    catch (error) { show(status, { success: false, message: error instanceof Error ? error.message : "Unknown error" }); }
    finally { setBusy(false); }
  });
  byId("save-key").addEventListener("click", () => run(async () => {
    const input = byId("api-key");
    const value = await api("/api/auth", { apiKey: input.value });
    input.value = "";
    return value;
  }));
  byId("remove-key").addEventListener("click", () => run(() => api("/api/auth/logout")));
  const targets = () => ({ skillTarget: byId("skill-target").value, mcpTarget: byId("mcp-target").value });
  byId("repair")?.addEventListener("click", () => run(() => api("/api/repair", targets())));
  byId("update")?.addEventListener("click", () => run(() => api("/api/update", targets())));
  byId("sample").addEventListener("click", () => run(() => api("/api/sample-render")));
  byId("close").addEventListener("click", async () => {
    try { await api("/api/close"); } finally { document.body.textContent = setupMessage("closed"); }
  });
  void bootstrap().catch((error) => {
    connection.classList.add("error");
    connection.textContent = error instanceof Error ? error.message : "Session bootstrap failed";
    setBusy(true);
  });
})();`;

export function clientSetupScript(locale: DisplayLocale): string {
  return `"use strict";
const setupMessages = ${JSON.stringify(clientSetupMessages(locale))};
const setupMessage = (key) => setupMessages[key];
const setupDiagnostics = ${JSON.stringify(setupDiagnosticCatalog(locale))};
const setupDiagnostic = (value) => Object.hasOwn(setupDiagnostics, value) ? setupDiagnostics[value] : value;
${setupController}`;
}

export const setupJavaScript = clientSetupScript("ja");
