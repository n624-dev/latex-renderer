export const setupHtml = `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>サーバー設定</title><link rel="stylesheet" href="/style.css">
<main><h1>サーバー設定</h1>
<p id="scope">既存環境の容量・時間制限を設定します。</p>
<details><summary>変更範囲と注意</summary><p>OS・Docker・ユーザー・ディスク構成は変更しません。通常設定では秘密情報・管理者・保存場所・公開URL・HTTPSを維持します。処理時間はサービスの停止猶予に合わせ840秒以下にしてください。</p></details>
<p id="status" role="status" aria-live="polite">接続中…</p>
<form id="settings"><fieldset disabled id="fields"><legend>容量・時間・認証の確認</legend>
<p id="origin"></p>
<section id="network-settings" hidden><h2>公開範囲とHTTPS</h2>
<label>公開範囲<select id="network-scope" required><option value="">公開範囲を選択してください</option><option value="local">このPCのみ</option><option value="lan">LAN内</option><option value="internet">インターネット</option></select></label>
<div id="lan-options" hidden>
<label>LANインターフェース<select id="lan-interface"><option value="">選択してください</option></select></label>
<label>HTTPS方式<select id="lan-provider"><option value="akebi-local-acme">Akebi：ローカル証明書を自動取得</option><option value="akebi-keyless">Akebi：Keyless署名</option><option value="custom">自分で証明書を用意</option></select></label>
<div id="lan-authority-options">
<label>証明書サーバー<select id="lan-authority"><option value="common">共通サーバー</option><option value="custom">セルフホスト／独自サーバー</option></select></label>
<label>管理APIのHTTPS origin<input id="lan-server" type="url" autocomplete="off"></label>
<label>LAN用DNSドメイン<input id="lan-domain" autocomplete="off"></label>
<label>認証局ID<input id="lan-issuer" autocomplete="off"></label>
<label>HTTPSポート<input id="lan-port" type="number" min="1" max="65535" value="443"></label>
<label><input id="lan-fallback" type="checkbox">ローカル証明書が使えない間はKeyless署名を使う</label>
<label id="lan-terms-label"><input id="lan-terms" type="checkbox">選択した認証局の利用規約に同意する</label>
<p>接続先のIPからURLが決まります。同じIPの別ネットワークとはブラウザー保存領域を共有するため、移動後は必要に応じてログインし直してください。秘密鍵はこの導入先に保存します。</p>
<p>初回の証明書取得に数分かかることがあります。HTTPSとサービスの検査が終わるまで完了にはしません。</p>
</div></div>
<label id="setup-auth-label">ログイン方式<select id="setup-auth"><option value="password">パスワード</option><option value="oidc">OIDC</option><option value="both">パスワードとOIDC</option></select></label>
</section>
<div id="configuration"></div><h2>容量・時間の上限</h2><p>開始条件は空きRAMの確認値です。実行RAMは必要に応じて上限まで使用します。swapは既存のものを使う追加枠で、0は無効です。1GiB = 1024MiB。</p><div id="limits"></div>
<details><summary>上級設定（JSON）</summary><label>秘密情報は入力しないでください<textarea id="review" rows="8" spellcheck="false"></textarea></label></details>
<section id="initial" hidden><h2 id="credentials-heading">管理者と認証情報</h2>
<p>秘密情報は確認表示・ブラウザー保存・ログには出しません。自動HTTPSの秘密鍵は導入先で生成します。自分で証明書を用意する場合はPEM形式を使用します。</p>
<label>owner表示名<input id="owner-name" autocomplete="off"></label>
<label>Updaterのビルドに使う既存の非rootユーザー<input id="deployment-user" autocomplete="off"></label>
<label>ownerメール（任意・アカウント自動連携には使いません）<input id="owner-email" type="email" autocomplete="off"></label>
<label>ログイン名（Passwordを使用する場合）<input id="owner-login" autocomplete="off"></label>
<label>ownerパスワード<input id="owner-password" type="password" autocomplete="new-password"></label>
<label>パスワードの確認<input id="owner-confirm" type="password" autocomplete="new-password"></label>
<label>IdPの正確なsubject（OIDCのみ／Accessの場合）<input id="owner-subject" autocomplete="off"></label>
<label>OIDC client secret<input id="oidc-secret" type="password" autocomplete="off"></label>
<label id="lan-invitation-label" hidden>独自サーバーの招待コード（必要な場合のみ）<input id="lan-invitation" type="password" autocomplete="off"></label>
<label>証明書PEM<textarea id="tls-certificate" rows="4" spellcheck="false" autocomplete="off"></textarea></label>
<label>秘密鍵PEM<textarea id="tls-key" rows="4" spellcheck="false" autocomplete="off"></textarea></label>
</section>
<button type="submit">変更内容を確認</button></fieldset></form>
<section id="confirmation" hidden><h2>適用前の確認</h2><p>サービスを一度停止して適用します。処理中はこの画面を閉じずにお待ちください。</p>
<div id="summary"></div><details><summary>確認済み設定の詳細データ</summary><pre id="summary-json"></pre></details><button id="apply" type="button">この内容で適用する</button></section>
<button id="close" type="button">終了（未適用の変更は破棄）</button>
<button id="recover" type="button" hidden>中断した設定を復旧する</button>
</main><script src="/script.js" defer></script></html>`;

export const setupStyle = `
:root { font-family:system-ui,sans-serif; color-scheme:light dark; line-height:1.6; accent-color:var(--accent);
  --page:#f5f5f5; --surface:#ffffff; --text:#1a1a1a; --border:#808080; --accent:#262626; --on-accent:#ffffff; }
@media(prefers-color-scheme:dark) { :root { --page:#111111; --surface:#1b1b1b; --text:#f5f5f5; --border:#737373; --accent:#ededed; --on-accent:#171717; } }
* { box-sizing:border-box; }
[hidden] { display:none !important; }
::selection { background:var(--accent); color:var(--on-accent); }
body { margin:0; background:var(--page); color:var(--text); overflow-wrap:anywhere; }
main { max-width:56rem; margin:auto; padding:clamp(.75rem,3vw,2rem); }
h1,h2 { line-height:1.25; text-wrap:balance; }
fieldset,section { min-width:0; margin:1rem 0; border:1px solid var(--border); border-radius:.8rem; background:var(--surface); padding:clamp(.65rem,2vw,1.25rem); }
legend { padding:0 .4rem; font-weight:700; }
label { display:grid; gap:.4rem; margin:.85rem 0; min-width:0; }
input,textarea,select,button { font:inherit; font-size:max(1rem,16px); min-width:0; max-width:100%; }
input,textarea,select { width:100%; min-height:44px; padding:.65rem; color:var(--text); background:var(--page); border:1px solid var(--border); border-radius:.45rem; }
input:disabled,textarea:disabled,select:disabled { opacity:.65; }
summary { padding:.65rem 0; min-height:44px; cursor:pointer; }
dl { display:grid; grid-template-columns:minmax(6rem,1fr) minmax(0,2fr); gap:.5rem 1rem; } dd { margin:0; }
input[type=checkbox] { width:1.25rem; height:1.25rem; min-height:0; accent-color:var(--accent); }
label:has(>input[type=checkbox]) { display:flex; align-items:center; min-height:44px; }
button { min-height:44px; min-width:44px; padding:.65rem 1rem; margin:.4rem 0; cursor:pointer; border:1px solid var(--accent); border-radius:.5rem; background:var(--accent); color:var(--on-accent); font-weight:650; }
button:disabled { cursor:wait; opacity:.55; }
:focus-visible { outline:3px solid var(--accent); outline-offset:3px; }
textarea,pre { font-family:ui-monospace,monospace; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:50dvh; overflow:auto; }
#limits { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 1rem; }
@media(max-width:600px) { #limits { grid-template-columns:1fr; } button { width:100%; } }
`;

export const setupScript = `"use strict";
(() => {
  const bootstrap = location.hash.slice(1); history.replaceState(null, "", "/");
  const el = (id) => document.getElementById(id);
  let token, csrf, confirmation, model, baseline, initial = false, ingress = false;
  let networkInventory = {interfaces:[],common:{serverOrigin:"",lanDomain:"",issuerId:""}};
  const limitLabels = { maxUploadBytes:"アップロード上限（バイト）", maxExtractedBytes:"展開後の上限（バイト）", maxFileCount:"入力ファイル数", maxZipEntries:"ZIP内の項目数", maxOutputBytes:"成果物の上限（バイト）", maxOutputFileCount:"成果物のファイル数", maxOutputDirectoryCount:"成果物のフォルダー数", maxLogBytes:"ログの上限（バイト）", maxSvgObjects:"SVGの個数", maxSvgBytes:"SVG 1個の上限（バイト）", maxSvgTotalBytes:"SVG合計の上限（バイト）", svgConversionTimeoutSeconds:"SVG変換の制限時間（秒）", maxQueueLength:"待機ジョブ数", maxUserStorageBytes:"利用者ごとの保存容量（バイト）", minFreeStorageBytes:"確保する空き容量（バイト）", jobTimeoutSeconds:"変換の制限時間（秒・840以下）", minimumAvailableMemoryBytes:"開始に必要な空きRAM（MiB）", maximumMemoryBytes:"実行RAMの上限（MiB）", maximumSwapBytes:"追加swapの上限（MiB・0は無効）", admissionWaitSeconds:"長時間待機の案内まで（秒・超過だけでは失敗しません）" };
  const memoryFields = ["minimumAvailableMemoryBytes", "maximumMemoryBytes", "maximumSwapBytes"];
  const fieldLabels = { publicOrigin:"公開URL", rendererPublicUrl:"結果取得用URL", mode:"公開方式", backend:"認証方式", passwordEnabled:"パスワード認証", oidcEnabled:"OIDC認証", issuer:"認証先URL", clientId:"認証クライアントID", displayName:"表示名", adminAudience:"管理画面の認証対象", remoteMcpAudience:"MCPの認証対象", allowedAlgorithms:"署名方式", accessScope:"公開範囲", tlsProvider:"HTTPS方式", listenAddress:"待受アドレス", allowedNetworks:"許可するネットワーク", databasePath:"データベースの場所", storageRoot:"保存先", rendererImage:"固定されたTeXイメージ" };
  const flatten = (value, prefix = [], result = []) => { for (const [key, item] of Object.entries(value || {})) { const path = [...prefix,key]; if (key === "format") continue; if (item && typeof item === "object" && !Array.isArray(item)) flatten(item,path,result); else result.push({ path, key, value:item }); } return result; };
  const invalidate = () => { confirmation = null; el("confirmation").hidden = true; };
  const saveModel = () => { el("review").value = JSON.stringify(model, null, 2); invalidate(); };
  const status = (message) => { el("status").textContent = message; };
  const post = async (path, body) => {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token, "X-CSRF-Token": csrf } : {}) }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.code || "REQUEST_FAILED");
    return value;
  };
  const refreshNetworkControls = () => {
    const current=model.deployment.ingress, enabled=(initial||ingress)&&model.deployment.authentication.deployment.mode==="standalone";
    el("network-settings").hidden=!enabled;
    for(const id of ["network-scope","lan-interface","lan-provider","lan-authority","lan-server","lan-domain","lan-issuer","lan-port","lan-fallback","lan-terms","setup-auth"])el(id).disabled=!enabled;
    el("network-scope").required=enabled;
    if(!enabled){el("lan-interface").required=false;el("lan-terms").required=false;}
    if(!enabled)return;
    el("network-scope").value=current?.accessScope||"";
    const lan=current?.accessScope==="lan", policy=current?.lanHttps;
    el("lan-options").hidden=!lan;el("lan-interface").required=lan;
    const selection=el("lan-interface"),old=current?.listenAddress;const placeholder=document.createElement("option");placeholder.textContent="選択してください";placeholder.value="";selection.replaceChildren(placeholder);
    for(const entry of networkInventory.interfaces){const option=document.createElement("option");option.textContent=entry.interfaceName+" / "+entry.address+" / "+entry.network;option.value=entry.address;selection.append(option);}
    selection.value=networkInventory.interfaces.some(entry=>entry.address===old)?old:"";
    el("lan-provider").value=policy?.provider.provider||"custom";
    el("lan-authority-options").hidden=!policy;
    el("lan-invitation-label").hidden=!enabled||!policy;
    const common=networkInventory.common;
    el("lan-authority").value=!policy||policy.provider.serverOrigin===common.serverOrigin&&policy.provider.lanDomain===common.lanDomain?"common":"custom";
    el("lan-server").value=policy?.provider.serverOrigin||common.serverOrigin;
    el("lan-domain").value=policy?.provider.lanDomain||common.lanDomain;
    el("lan-issuer").value=policy?.issuerId||common.issuerId;
    el("lan-port").value=String(policy?.provider.port||443);
    const custom=el("lan-authority").value==="custom";
    for(const id of ["lan-server","lan-domain","lan-issuer"])el(id).readOnly=!custom;
    const keyless=policy?.provider.provider==="akebi-keyless";
    el("lan-fallback").checked=keyless||policy?.provider.keylessFallback===true;el("lan-fallback").disabled=keyless;
    el("lan-terms-label").hidden=keyless;el("lan-terms").checked=policy?.termsAccepted===true;el("lan-terms").required=!!policy&&!keyless;
    const auth=model.deployment.authentication.authentication;
    el("setup-auth-label").hidden=!initial||auth.backend!=="native";
    if(auth.backend==="native")el("setup-auth").value=auth.oidcEnabled?(auth.passwordEnabled?"both":"oidc"):"password";
  };
  const changeNetwork = () => {
    try{
      const scope=el("network-scope").value;
      if(!scope)throw Error("公開範囲を選んでください。");
      model.deployment.ingress ||= {format:1,mode:"standalone",tlsProvider:"custom",publicOrigin:model.deployment.authentication.deployment.publicOrigin};
      const current=model.deployment.ingress;
      current.accessScope=scope;
      if(scope==="lan"){
        const candidate=networkInventory.interfaces.find(entry=>entry.address===el("lan-interface").value);
        if(!candidate)throw Error("利用するLANインターフェースを選んでください。");
        current.listenAddress=candidate.address;current.allowedNetworks=[candidate.network];
        const mode=el("lan-provider").value;
        if(mode!=="custom"){
          const domain=el("lan-domain").value.trim(),server=el("lan-server").value.trim(),issuer=el("lan-issuer").value.trim();
          if(!domain||!server||!issuer)throw Error("証明書サーバーとLANドメイン、認証局IDを入力してください。");
          let label=candidate.address.replaceAll(".","-");
          if(label.includes(":")){
            const halves=candidate.address.split("::"),left=halves[0]?halves[0].split(":"):[],right=halves[1]?halves[1].split(":"):[];
            const groups=halves.length===2?[...left,...Array(8-left.length-right.length).fill("0"),...right]:left;
            label=groups.map(word=>word.padStart(4,"0")).join("-");
          }
          const port=Number(el("lan-port").value);
          const origin="https://"+label+"."+domain+(port===443?"":":"+port);
          current.tlsProvider="automatic";current.publicOrigin=origin;
          current.lanHttps={format:1,provider:{format:1,provider:mode,serverOrigin:server,lanDomain:domain,address:candidate.address,port,keylessFallback:mode==="akebi-keyless"||el("lan-fallback").checked},issuerId:issuer,termsAccepted:mode==="akebi-local-acme"&&el("lan-terms").checked};
          model.deployment.authentication.deployment.publicOrigin=origin;model.deployment.authentication.deployment.rendererPublicUrl=origin;
          el("origin").textContent=origin;
        }else{current.tlsProvider="custom";delete current.lanHttps;}
      }else{
        delete current.allowedNetworks;delete current.lanHttps;current.tlsProvider="custom";current.listenAddress=scope==="local"?"127.0.0.1":"0.0.0.0";
      }
      saveModel();synchronize();
    }catch(error){saveModel();el("lan-options").hidden=el("network-scope").value!=="lan";el("lan-interface").required=el("network-scope").value==="lan";status(error.message);}
  };
  for(const id of ["network-scope","lan-interface","lan-provider","lan-server","lan-domain","lan-issuer","lan-port","lan-fallback","lan-terms"])el(id).addEventListener("change",changeNetwork);
  el("lan-authority").addEventListener("change",()=>{
    const custom=el("lan-authority").value==="custom";
    for(const id of ["lan-server","lan-domain","lan-issuer"])el(id).readOnly=!custom;
    if(!custom){el("lan-server").value=networkInventory.common.serverOrigin;el("lan-domain").value=networkInventory.common.lanDomain;el("lan-issuer").value=networkInventory.common.issuerId;changeNetwork();}
  });
  el("setup-auth").addEventListener("change",()=>{
    const old=model.deployment.authentication.authentication,mode=el("setup-auth").value;
    model.deployment.authentication.authentication={backend:"native",passwordEnabled:mode!=="oidc",oidcEnabled:mode!=="password",...(mode!=="password"?{oidc:old.oidc||{issuer:"https://id.example.invalid",clientId:"",allowedAlgorithms:["RS256","ES256"],displayName:"OIDC"}}:{})};
    saveModel();synchronize();
  });
  const synchronize = () => {
    model = JSON.parse(el("review").value);
    const auth = model.deployment.authentication.authentication;
    const password = auth.backend === "native" && auth.passwordEnabled;
    for (const id of ["owner-login", "owner-password", "owner-confirm"]) el(id).closest("label").hidden = !initial || !password;
    el("owner-subject").closest("label").hidden = !initial || password;
    el("oidc-secret").closest("label").hidden = !initial || auth.backend !== "native" || !auth.oidcEnabled;
    for (const id of ["tls-certificate", "tls-key"]) el(id).closest("label").hidden = !(initial||ingress) || model.deployment.authentication.deployment.mode!=="standalone" || model.deployment.ingress?.tlsProvider==="automatic";
    refreshNetworkControls();
    el("configuration").replaceChildren();
    for (const field of flatten(model)) {
      if (field.path.includes("limits") || field.path.includes("lanHttps") || !fieldLabels[field.key]) continue;
      const label = document.createElement("label"); label.textContent = fieldLabels[field.key];
      const input = document.createElement("input"); input.type = "text";
      input.value = typeof field.value === "boolean" ? (field.value ? "有効" : "無効") : Array.isArray(field.value) ? field.value.join(", ") : String(field.value ?? "未設定");
      const structural = ["mode", "backend", "passwordEnabled", "oidcEnabled", "tlsProvider"].includes(field.key);
      input.readOnly = structural || (!initial && !(ingress && ["publicOrigin","rendererPublicUrl","accessScope","listenAddress","allowedNetworks"].includes(field.key)));
      input.addEventListener("change", () => {
        let target = model; for (const key of field.path.slice(0,-1)) target = target[key];
        target[field.key] = Array.isArray(field.value) ? input.value.split(",").map(value=>value.trim()).filter(Boolean) : input.value;
        if (field.key === "publicOrigin") { model.deployment.authentication.deployment.publicOrigin = input.value; if(model.deployment.ingress) model.deployment.ingress.publicOrigin = input.value; }
        saveModel();
      });
      label.append(input); el("configuration").append(label);
    }
    el("limits").replaceChildren();
    for (const [name, value] of Object.entries(model.runtime.limits)) {
      const label = document.createElement("label"); label.textContent = limitLabels[name] || name;
      const scale = memoryFields.includes(name) ? 1024 ** 2 : 1;
      const input = document.createElement("input"); input.type = "number"; input.min = name === "maximumSwapBytes" ? "0" : name === "maximumMemoryBytes" ? "128" : String(1 / scale); input.step = name === "maximumMemoryBytes" || name === "maximumSwapBytes" ? "64" : scale > 1 ? "any" : "1"; input.value = String(value / scale); input.required = true; input.setAttribute("aria-label", name);
      input.addEventListener("input", () => { model.runtime.limits[name] = Number(input.value) * scale; saveModel(); });
      label.append(input); el("limits").append(label);
    }
  };
  el("review").addEventListener("input", () => { confirmation = null; el("confirmation").hidden = true; });
  el("review").addEventListener("change", () => { try { synchronize(); } catch { status("設定JSONを確認してください。"); } });
  el("settings").addEventListener("submit", async (event) => {
    event.preventDefault(); confirmation = null; el("confirmation").hidden = true; el("fields").disabled = true;
    try {
      const value = await post("/api/preview", { review: JSON.parse(el("review").value) }); model = value.review; confirmation = value.confirmation;
      el("summary-json").textContent = JSON.stringify(value.review, null, 2);
      el("summary").replaceChildren();
      const before = new Map(flatten(baseline).map(field => [field.path.join("."),JSON.stringify(field.value)]));
      const changes = flatten(model).filter(field => before.get(field.path.join(".")) !== JSON.stringify(field.value));
      const list = document.createElement("dl");
      for (const field of changes) { const title=document.createElement("dt"),description=document.createElement("dd"); title.textContent=limitLabels[field.key]||fieldLabels[field.key]||field.key; description.textContent=memoryFields.includes(field.key) ? String(field.value / 1024 ** 2) + " MiB" : JSON.stringify(field.value); list.append(title,description); }
      if(changes.length) el("summary").append(list); else el("summary").textContent="設定値の変更はありません。初期導入・証明書の設定はこの確認後に適用します。";
      el("confirmation").hidden = false; status("確認済み。適用には下のボタンが必要です。");
    }
    catch (error) { status(error.message); } finally { el("fields").disabled = false; }
  });
  el("apply").addEventListener("click", async () => {
    if (!confirmation) return;
    const body = { confirmation };
    try {
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
        if (model.deployment.ingress.mode === "standalone" && model.deployment.ingress.tlsProvider === "custom") body.credentials.tls = { certificate: el("tls-certificate").value, privateKey: el("tls-key").value };
      }
      if (ingress) body.credentials = model.deployment.ingress.tlsProvider === "custom" ? { tls: { certificate: el("tls-certificate").value, privateKey: el("tls-key").value } } : {};
      if ((initial||ingress) && model.deployment.ingress.tlsProvider === "automatic" && el("lan-invitation").value) body.credentials.lanInvitation=el("lan-invitation").value;
    } catch (error) { status(error.message); return; }
    confirmation = null;
    el("fields").disabled = true; el("apply").disabled = true; el("close").disabled = true; status("適用中… workerの終了を待つ場合があります。");
    try {
      await post("/api/apply", body); status("適用完了。設定画面は停止しました。ownerログインと代表的なレンダリングを確認してください。");
    }
    catch { status("適用を確認できませんでした。下の復旧ボタンで状態を確認してください。変更をそのまま再送しないでください。"); el("recover").hidden = false; }
    finally { for (const id of ["owner-password", "owner-confirm", "oidc-secret", "tls-key", "lan-invitation"]) el(id).value = ""; }
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
      const value = await post("/api/status", {}); model = value.review; baseline = structuredClone(model);
      initial = value.scope === "initial-prepared-host"; ingress = value.scope === "ingress-prepared-host";
      if (initial || ingress) {
        networkInventory=await post("/api/network",{});
        el("initial").hidden = false; el("recover").hidden = false;
        el("credentials-heading").textContent = initial ? "管理者と認証情報" : "HTTPS証明書";
        el("scope").textContent = initial ? "準備済み環境への初期導入です。実際のHTTPS origin・公開範囲・immutable imageを設定し、初期ownerを作成します。OS・Docker・ユーザー・ディスクは変更しません。" : "既存StandaloneのHTTPS・公開範囲を変更します。owner・認証方式・imageは維持し、失敗時は以前の設定へ戻します。";
        if (ingress) for (const id of ["owner-name", "deployment-user", "owner-email", "owner-login", "owner-password", "owner-confirm", "owner-subject", "oidc-secret"]) el(id).closest("label").hidden = true;
      }
      el("origin").textContent = model.deployment.authentication.deployment.publicOrigin;
      el("review").value = JSON.stringify(model, null, 2); synchronize(); el("fields").disabled = false;
      status("変更を入力して確認してください。未適用の変更は保存されません。");
    } catch { status("開始URLが無効・期限切れ、または準備済み環境ではありません。"); }
  })();
})();`;
