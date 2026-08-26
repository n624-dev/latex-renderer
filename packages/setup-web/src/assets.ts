export const setupHtml = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>LaTeX Renderer Setup</title>
  <link rel="stylesheet" href="/assets/setup.css">
</head>
<body>
  <main>
    <header>
      <div><p class="eyebrow">LOCAL SETUP</p><h1>LaTeX Renderer</h1></div>
      <button id="close" class="quiet" type="button">セットアップを終了</button>
    </header>
    <p id="connection" class="notice">安全なローカルセッションを開始しています…</p>
    <section>
      <div class="section-heading"><div><h2>状態と診断</h2><p>インストール、認証、Skill、MCPを確認します。</p></div><button id="refresh" type="button">再診断</button></div>
      <pre id="status" aria-live="polite">待機中</pre>
    </section>
    <div class="grid">
      <section>
        <h2>認証</h2>
        <p>Render APIキーはOSの保護された資格情報領域に保存され、ブラウザへ再表示されません。</p>
        <label for="api-key">Render APIキー</label>
        <input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="lrk_…">
        <div class="actions"><button id="save-key" type="button">保存</button><button id="remove-key" class="quiet" type="button">削除</button></div>
      </section>
      <section>
        <h2>AI連携</h2>
        <p>管理対象のSkillとMCPだけを設定します。所有者不明の設定は保持されます。</p>
        <label for="skill-target">Skill</label>
        <select id="skill-target"><option value="both">Codex + Claude</option><option value="codex">Codex</option><option value="claude">Claude</option><option value="none">設定しない</option></select>
        <label for="mcp-target">MCP</label>
        <select id="mcp-target"><option value="both">Codex + Claude</option><option value="codex">Codex</option><option value="claude">Claude</option><option value="none">設定しない</option></select>
        <div class="actions"><button id="repair" type="button">修復・連携</button><button id="update" class="quiet" type="button">クライアント更新</button></div>
      </section>
    </div>
    <section>
      <div class="section-heading"><div><h2>サンプルレンダリング</h2><p>固定された日本語・英語のサンプルで認証からPDF生成まで確認します。</p></div><button id="sample" type="button">実行</button></div>
      <pre id="result" aria-live="polite">未実行</pre>
    </section>
  </main>
  <script src="/assets/setup.js" defer></script>
</body>
</html>`;

export const setupCss = `:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#0d1117;color:#e6edf3}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#17243a 0,#0d1117 38rem)}main{width:min(980px,calc(100% - 2rem));margin:0 auto;padding:2.5rem 0 5rem}header,.section-heading,.actions{display:flex;align-items:center;justify-content:space-between;gap:1rem}h1{font-size:clamp(2rem,5vw,3.6rem);margin:.1rem 0 1.5rem;letter-spacing:-.04em}h2{margin:0 0 .45rem;font-size:1.15rem}p{color:#9da7b3;line-height:1.6;margin:.2rem 0 1rem}.eyebrow{color:#74c7ec;font-size:.72rem;font-weight:800;letter-spacing:.18em;margin:0}section{background:rgba(22,27,34,.92);border:1px solid #30363d;border-radius:14px;padding:1.25rem;margin:1rem 0;box-shadow:0 14px 40px rgba(0,0,0,.18)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.grid section{margin:0}.notice{padding:.8rem 1rem;border-left:3px solid #74c7ec;background:#111a27;border-radius:4px}.notice.error{border-color:#f85149;color:#ffb4ad}label{display:block;font-size:.82rem;font-weight:700;margin:.85rem 0 .35rem}input,select{width:100%;border:1px solid #48515d;border-radius:8px;padding:.72rem .8rem;background:#0d1117;color:#e6edf3;font:inherit}button{border:0;border-radius:8px;padding:.68rem .9rem;background:#2f81f7;color:#fff;font-weight:750;cursor:pointer}button:hover{filter:brightness(1.08)}button:disabled{opacity:.55;cursor:wait}.quiet{background:#2d333b;color:#e6edf3}.actions{justify-content:flex-start;margin-top:1rem;flex-wrap:wrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:22rem;overflow:auto;background:#090c10;border:1px solid #252b33;border-radius:8px;padding:1rem;color:#b9c4cf;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}@media(max-width:720px){.grid{grid-template-columns:1fr}header,.section-heading{align-items:flex-start;flex-direction:column}}`;

export const setupJavaScript = `"use strict";
(() => {
  const byId = (id) => document.getElementById(id);
  const connection = byId("connection");
  const status = byId("status");
  const result = byId("result");
  let sessionToken = "";
  let csrfToken = "";
  let busy = false;

  const show = (target, value) => { target.textContent = JSON.stringify(value, null, 2); };
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
    if (!response.ok || value.success !== true) throw new Error(value.error?.message || "Request failed");
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
    if (!bootstrapToken) throw new Error("Bootstrap tokenがありません。CLIからセットアップを再起動してください。");
    const response = await fetch("/api/session", {
      method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bootstrapToken })
    });
    const value = await response.json();
    if (!response.ok || value.success !== true) throw new Error(value.error?.message || "Session bootstrap failed");
    sessionToken = value.result.sessionToken;
    csrfToken = value.result.csrfToken;
    connection.textContent = "このブラウザだけに許可されたloopbackセッションです。";
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
  byId("repair").addEventListener("click", () => run(() => api("/api/repair", targets())));
  byId("update").addEventListener("click", () => run(() => api("/api/update", targets())));
  byId("sample").addEventListener("click", () => run(() => api("/api/sample-render")));
  byId("close").addEventListener("click", async () => {
    try { await api("/api/close"); } finally { document.body.textContent = "セットアップを終了しました。このタブを閉じてください。"; }
  });
  void bootstrap().catch((error) => {
    connection.classList.add("error");
    connection.textContent = error instanceof Error ? error.message : "Session bootstrap failed";
    setBusy(true);
  });
})();`;
