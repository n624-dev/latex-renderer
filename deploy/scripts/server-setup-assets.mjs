export const setupHtml = `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Server settings</title><link rel="stylesheet" href="/style.css">
<main><h1>サーバー設定</h1>
<p id="scope">準備済みの既存環境専用です。OS・Docker・ユーザー・ディスク構成は変更しません。
秘密情報・owner・保存場所・公開URL・HTTPSの変更はこの画面では行いません。</p>
<p>既存サービスの停止時間に合わせ、jobTimeoutSeconds は840秒以下にしてください。</p>
<p id="status" role="status" aria-live="polite">接続中…</p>
<form id="settings"><fieldset disabled id="fields"><legend>容量・時間・認証の確認</legend>
<p id="origin"></p><div id="limits"></div>
<label>詳細設定（秘密情報を入力しないでください）<textarea id="review" rows="16" spellcheck="false"></textarea></label>
<section id="initial" hidden><h2>初期owner・秘密情報</h2>
<p>秘密情報は確認表示・ブラウザー保存・ログには出しません。HTTPSはPEM証明書と秘密鍵を使用します。</p>
<label>owner表示名<input id="owner-name" autocomplete="off"></label>
<label>Updaterのビルドに使う既存の非rootユーザー<input id="deployment-user" autocomplete="off"></label>
<label>ownerメール（任意・アカウント自動連携には使いません）<input id="owner-email" type="email" autocomplete="off"></label>
<label>ログイン名（Passwordを使用する場合）<input id="owner-login" autocomplete="off"></label>
<label>ownerパスワード<input id="owner-password" type="password" autocomplete="new-password"></label>
<label>パスワードの確認<input id="owner-confirm" type="password" autocomplete="new-password"></label>
<label>IdPの正確なsubject（OIDCのみ／Accessの場合）<input id="owner-subject" autocomplete="off"></label>
<label>OIDC client secret<input id="oidc-secret" type="password" autocomplete="off"></label>
<label>証明書PEM<textarea id="tls-certificate" rows="4" spellcheck="false" autocomplete="off"></textarea></label>
<label>秘密鍵PEM<textarea id="tls-key" rows="4" spellcheck="false" autocomplete="off"></textarea></label>
</section>
<button type="submit">変更内容を確認</button></fieldset></form>
<section id="confirmation" hidden><h2>適用前の確認</h2><p>サービスを一度停止して適用します。処理中はこの画面を閉じずにお待ちください。</p>
<pre id="summary"></pre><button id="apply" type="button">この内容で適用する</button></section>
<button id="close" type="button">終了（未適用の変更は破棄）</button>
<button id="recover" type="button" hidden>中断した設定を復旧する</button>
</main><script src="/script.js" defer></script></html>`;

export const setupStyle = `:root{font-family:system-ui,sans-serif;color-scheme:light dark}body{margin:0}main{max-width:56rem;margin:auto;padding:1rem}label{display:block;margin:.75rem 0}input,textarea,button{font:inherit;box-sizing:border-box;max-width:100%}input,textarea{width:100%;padding:.65rem}button{min-height:44px;padding:.6rem 1rem;margin:.4rem 0;cursor:pointer}textarea,pre{font-family:monospace;font-size:.9rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}fieldset{min-width:0}#limits{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 1rem}@media(max-width:600px){#limits{grid-template-columns:1fr}}`;

export const setupScript = `"use strict";
(() => {
  const bootstrap = location.hash.slice(1); history.replaceState(null, "", "/");
  const el = (id) => document.getElementById(id);
  let token, csrf, confirmation, model, initial = false, ingress = false;
  const status = (message) => { el("status").textContent = message; };
  const post = async (path, body) => {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token, "X-CSRF-Token": csrf } : {}) }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.code || "REQUEST_FAILED");
    return value;
  };
  const synchronize = () => {
    model = JSON.parse(el("review").value);
    el("limits").replaceChildren();
    for (const [name, value] of Object.entries(model.runtime.limits)) {
      const label = document.createElement("label"); label.textContent = name + (/Bytes$/.test(name) ? " (bytes)" : /Seconds$/.test(name) ? " (seconds)" : "");
      const input = document.createElement("input"); input.type = "number"; input.min = "1"; input.step = "1"; input.value = String(value); input.required = true; input.setAttribute("aria-label", name);
      input.addEventListener("input", () => { model.runtime.limits[name] = Number(input.value); el("review").value = JSON.stringify(model, null, 2); confirmation = null; el("confirmation").hidden = true; });
      label.append(input); el("limits").append(label);
    }
  };
  el("review").addEventListener("input", () => { confirmation = null; el("confirmation").hidden = true; });
  el("review").addEventListener("change", () => { try { synchronize(); } catch { status("設定JSONを確認してください。"); } });
  el("settings").addEventListener("submit", async (event) => {
    event.preventDefault(); confirmation = null; el("confirmation").hidden = true; el("fields").disabled = true;
    try { const value = await post("/api/preview", { review: JSON.parse(el("review").value) }); model = value.review; confirmation = value.confirmation; el("summary").textContent = JSON.stringify(value.review, null, 2); el("confirmation").hidden = false; status("確認済み。適用には下のボタンが必要です。"); }
    catch (error) { status(error.message); } finally { el("fields").disabled = false; }
  });
  el("apply").addEventListener("click", async () => {
    if (!confirmation) return; const approved = confirmation; confirmation = null;
    el("fields").disabled = true; el("apply").disabled = true; el("close").disabled = true; status("適用中… workerの終了を待つ場合があります。");
    try {
      const body = { confirmation: approved };
      if (initial) {
        const auth = model.deployment.authentication.authentication;
        const password = auth.backend === "native" && auth.passwordEnabled;
        const owner = { displayName: el("owner-name").value };
        if (el("owner-email").value) owner.email = el("owner-email").value;
        if (password) {
          if (el("owner-password").value !== el("owner-confirm").value) throw new Error("パスワードの確認が一致しません。");
          owner.loginName = el("owner-login").value; owner.password = el("owner-password").value;
        } else owner.subject = el("owner-subject").value;
        body.credentials = { owner, deploymentUser: el("deployment-user").value };
        if (auth.backend === "native" && auth.oidcEnabled) body.credentials.oidcClientSecret = el("oidc-secret").value;
        if (model.deployment.ingress.mode === "standalone") body.credentials.tls = { certificate: el("tls-certificate").value, privateKey: el("tls-key").value };
      }
      if (ingress) body.credentials = { tls: { certificate: el("tls-certificate").value, privateKey: el("tls-key").value } };
      await post("/api/apply", body); status("適用完了。設定画面は停止しました。ownerログインと代表的なレンダリングを確認してください。");
    }
    catch { status("適用を確認できませんでした。下の復旧ボタンで状態を確認してください。変更をそのまま再送しないでください。"); el("recover").hidden = false; }
    finally { for (const id of ["owner-password", "owner-confirm", "oidc-secret", "tls-key"]) el(id).value = ""; }
  });
  el("recover").addEventListener("click", async () => {
    el("recover").disabled = true; status("復旧中…");
    try {
      const result = await post("/api/recover", { confirmation: "RECOVER" });
      if (result.phase === "complete") { status("復旧完了。HTTPS・サービス状態を確認できました。設定画面を停止しました。"); return; }
      const value = await post("/api/status", {}); model = value.review; el("review").value = JSON.stringify(model, null, 2); synchronize();
      el("fields").disabled = false; el("apply").disabled = false; el("close").disabled = false; confirmation = null; el("confirmation").hidden = true;
      status("復旧記録を確認しました。設定を再確認し、必要な秘密情報を再入力してください。");
    } catch { status("復旧できませんでした。秘密の復旧記録は保持しています。管理者が状態を確認してください。"); }
    finally { el("recover").disabled = false; }
  });
  el("close").addEventListener("click", async () => { try { await post("/api/close", {}); status("終了しました。"); el("fields").disabled = true; el("close").disabled = true; } catch (error) { status(error.message); } });
  (async () => {
    try {
      const session = await post("/api/session", { bootstrap }); token = session.token; csrf = session.csrf;
      const value = await post("/api/status", {}); model = value.review;
      initial = value.scope === "initial-prepared-host"; ingress = value.scope === "ingress-prepared-host";
      if (initial || ingress) {
        el("initial").hidden = false; el("recover").hidden = false;
        el("scope").textContent = initial ? "準備済み環境への初期導入です。実際のHTTPS origin・公開範囲・immutable imageを設定し、初期ownerを作成します。OS・Docker・ユーザー・ディスクは変更しません。" : "既存StandaloneのHTTPS・公開範囲を変更します。owner・認証方式・imageは維持し、失敗時は以前の設定へ戻します。";
        if (ingress) for (const id of ["owner-name", "deployment-user", "owner-email", "owner-login", "owner-password", "owner-confirm", "owner-subject", "oidc-secret"]) el(id).closest("label").hidden = true;
      }
      el("origin").textContent = model.deployment.authentication.deployment.publicOrigin;
      el("review").value = JSON.stringify(model, null, 2); synchronize(); el("fields").disabled = false;
      status("変更を入力して確認してください。未適用の変更は保存されません。");
    } catch { status("開始URLが無効・期限切れ、または準備済み環境ではありません。"); }
  })();
})();`;
