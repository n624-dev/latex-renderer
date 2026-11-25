import { setupTexts } from "./setup-messages.mjs";

const escapeSetupHtml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

export const setupHtml = serverSetupHtml("ja");

export function serverSetupHtml(locale) {
  const catalog = setupTexts(locale);
  const t = (key) => catalog[key];
  return `<!doctype html>
<html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeSetupHtml(t("serverSettings"))}</title><link rel="stylesheet" href="/style.css">
<main><h1>${escapeSetupHtml(t("serverSettings"))}</h1>
<p id="scope">${escapeSetupHtml(t("setStorageAndTimeLimitsFor"))}</p>
<details><summary>${escapeSetupHtml(t("scopeOfChangesAndPrecautions"))}</summary><p>${escapeSetupHtml(t("theOsDockerUsersAndDisk"))}</p></details>
<p id="status" role="status" aria-live="polite">${escapeSetupHtml(t("connecting"))}</p>
<form id="settings"><fieldset disabled id="fields"><legend>${escapeSetupHtml(t("reviewCapacityTimeLimitsAndAuthentication"))}</legend>
<p id="origin"></p>
<section id="network-settings" hidden><h2>${escapeSetupHtml(t("networkExposureAndHttps"))}</h2>
<label>${escapeSetupHtml(t("networkExposure"))}<select id="network-scope" required><option value="">${escapeSetupHtml(t("selectTheNetworkExposure"))}</option><option value="local">${escapeSetupHtml(t("thisComputerOnly"))}</option><option value="lan">${escapeSetupHtml(t("localNetwork"))}</option><option value="internet">${escapeSetupHtml(t("internet"))}</option></select></label>
<div id="lan-options" hidden>
<label>${escapeSetupHtml(t("lanInterface"))}<select id="lan-interface"><option value="">${escapeSetupHtml(t("selectAnOption"))}</option></select></label>
<label>${escapeSetupHtml(t("httpsMethod"))}<select id="lan-provider"><option value="akebi-local-acme">${escapeSetupHtml(t("akebiObtainALocalCertificateAutomatically"))}</option><option value="akebi-keyless">${escapeSetupHtml(t("akebiKeylessSigning"))}</option><option value="custom">${escapeSetupHtml(t("supplyYourOwnCertificate"))}</option></select></label>
<div id="lan-authority-options">
<label>${escapeSetupHtml(t("certificateServer"))}<select id="lan-authority"><option value="common">${escapeSetupHtml(t("sharedServer"))}</option><option value="custom">${escapeSetupHtml(t("selfHostedOrCustomServer"))}</option></select></label>
<label>${escapeSetupHtml(t("managementApiHttpsOrigin"))}<input id="lan-server" type="url" autocomplete="off"></label>
<label>${escapeSetupHtml(t("lanDnsDomain"))}<input id="lan-domain" autocomplete="off"></label>
<label>${escapeSetupHtml(t("certificateAuthorityId"))}<input id="lan-issuer" autocomplete="off"></label>
<label>${escapeSetupHtml(t("httpsPort"))}<input id="lan-port" type="number" min="1" max="65535" value="443"></label>
<label><input id="lan-fallback" type="checkbox">${escapeSetupHtml(t("useKeylessSigningWhileNoLocal"))}</label>
<label id="lan-terms-label"><input id="lan-terms" type="checkbox">${escapeSetupHtml(t("acceptTheSelectedCertificateAuthorityS"))}</label>
<p>${escapeSetupHtml(t("theDestinationIpDeterminesTheUrl"))}</p>
<p>${escapeSetupHtml(t("theFirstCertificateRequestMayTake"))}</p>
</div></div>
<label id="setup-auth-label">${escapeSetupHtml(t("signInMethod"))}<select id="setup-auth"><option value="password">${escapeSetupHtml(t("password"))}</option><option value="oidc">OIDC</option><option value="both">${escapeSetupHtml(t("passwordAndOidc"))}</option></select></label>
</section>
<div id="configuration"></div><h2>${escapeSetupHtml(t("capacityAndTimeLimits"))}</h2><p>${escapeSetupHtml(t("theStartThresholdChecksAvailableRam"))}</p><div id="limits"></div>
<details><summary>${escapeSetupHtml(t("advancedSettingsJson"))}</summary><label>${escapeSetupHtml(t("doNotEnterSecrets"))}<textarea id="review" rows="8" spellcheck="false"></textarea></label></details>
<section id="initial" hidden><h2 id="credentials-heading">${escapeSetupHtml(t("administratorAndCredentials"))}</h2>
<p>${escapeSetupHtml(t("secretsAreExcludedFromTheReview"))}</p>
<label>${escapeSetupHtml(t("ownerDisplayName"))}<input id="owner-name" autocomplete="off"></label>
<label>${escapeSetupHtml(t("existingNonRootUserForUpdater"))}<input id="deployment-user" autocomplete="off"></label>
<label>${escapeSetupHtml(t("ownerEmailOptionalNeverUsedFor"))}<input id="owner-email" type="email" autocomplete="off"></label>
<label>${escapeSetupHtml(t("loginNameWhenUsingPasswordAuthentication"))}<input id="owner-login" autocomplete="off"></label>
<label>${escapeSetupHtml(t("ownerPassword"))}<input id="owner-password" type="password" autocomplete="new-password"></label>
<label>${escapeSetupHtml(t("confirmPassword"))}<input id="owner-confirm" type="password" autocomplete="new-password"></label>
<label>${escapeSetupHtml(t("exactIdpSubjectOidcOnlyOr"))}<input id="owner-subject" autocomplete="off"></label>
<label>${escapeSetupHtml(t("oidcClientSecret"))}<input id="oidc-secret" type="password" autocomplete="off"></label>
<label id="lan-invitation-label" hidden>${escapeSetupHtml(t("customServerInvitationCodeOnlyIf"))}<input id="lan-invitation" type="password" autocomplete="off"></label>
<label>${escapeSetupHtml(t("certificatePem"))}<textarea id="tls-certificate" rows="4" spellcheck="false" autocomplete="off"></textarea></label>
<label>${escapeSetupHtml(t("privateKeyPem"))}<textarea id="tls-key" rows="4" spellcheck="false" autocomplete="off"></textarea></label>
</section>
<button type="submit">${escapeSetupHtml(t("reviewSettings"))}</button></fieldset></form>
<section id="confirmation" hidden><h2>${escapeSetupHtml(t("reviewBeforeApplying"))}</h2><p>${escapeSetupHtml(t("servicesStopBrieflyToApplyThe"))}</p>
<div id="summary"></div><details><summary>${escapeSetupHtml(t("detailsOfReviewedSettings"))}</summary><pre id="summary-json"></pre></details><button id="apply" type="button">${escapeSetupHtml(t("applyTheseSettings"))}</button></section>
<button id="close" type="button">${escapeSetupHtml(t("exitAndDiscardUnappliedChanges"))}</button>
<button id="recover" type="button" hidden>${escapeSetupHtml(t("recoverInterruptedSetup"))}</button>
</main><script src="/script.js" defer></script></html>`;
}

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

const setupController = `"use strict";
(() => {
  const bootstrap = location.hash.slice(1); history.replaceState(null, "", "/");
  const el = (id) => document.getElementById(id);
  let token, csrf, confirmation, model, baseline, initial = false, ingress = false, invitationOrigin;
  let networkInventory = {interfaces:[],common:{serverOrigin:"",lanDomain:"",issuerId:""}};
  const limitLabels = { maxUploadBytes:setupMessage("uploadLimit"), maxExtractedBytes:setupMessage("extractLimit"), maxFileCount:setupMessage("inputFileCount"), maxZipEntries:setupMessage("zipEntryCount"), maxOutputBytes:setupMessage("artifactSizeLimit"), maxOutputFileCount:setupMessage("artifactFileCount"), maxOutputDirectoryCount:setupMessage("artifactDirectoryCount"), maxLogBytes:setupMessage("logLimit"), maxSvgObjects:setupMessage("svgCount"), maxSvgBytes:setupMessage("svgItemLimit"), maxSvgTotalBytes:setupMessage("svgTotalLimit"), svgConversionTimeoutSeconds:setupMessage("svgTimeout"), maxQueueLength:setupMessage("queuedJobs"), maxUserStorageBytes:setupMessage("userQuota"), minFreeStorageBytes:setupMessage("freeDisk"), jobTimeoutSeconds:setupMessage("renderTimeout"), minimumAvailableMemoryBytes:setupMessage("freeRam"), maximumMemoryBytes:setupMessage("executionRam"), maximumSwapBytes:setupMessage("swapLimit"), admissionWaitSeconds:setupMessage("longWait") };
  const memoryFields = ["minimumAvailableMemoryBytes", "maximumMemoryBytes", "maximumSwapBytes"];
  const fieldLabels = { publicOrigin:setupMessage("publicUrl"), rendererPublicUrl:setupMessage("resultsUrl"), mode:setupMessage("publicExposure"), backend:setupMessage("signInMethod"), passwordEnabled:setupMessage("passwordAuthentication"), oidcEnabled:setupMessage("oidcAuthentication"), issuer:setupMessage("issuerUrl"), clientId:setupMessage("oidcClientId"), displayName:setupMessage("displayName"), adminAudience:setupMessage("adminAudience"), remoteMcpAudience:setupMessage("mcpAudience"), allowedAlgorithms:setupMessage("signingMode"), accessScope:setupMessage("networkExposure"), tlsProvider:setupMessage("httpsMethod"), listenAddress:setupMessage("listenAddress"), allowedNetworks:setupMessage("allowedNetworks"), databasePath:setupMessage("databasePath"), storageRoot:setupMessage("destination"), rendererImage:setupMessage("pinnedTexImage") };
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
    const nextInvitationOrigin=current?.lanHttps?.provider.serverOrigin;
    if(invitationOrigin!==nextInvitationOrigin)el("lan-invitation").value="";
    invitationOrigin=nextInvitationOrigin;
    el("network-settings").hidden=!enabled;
    for(const id of ["network-scope","lan-interface","lan-provider","lan-authority","lan-server","lan-domain","lan-issuer","lan-port","lan-fallback","lan-terms","setup-auth"])el(id).disabled=!enabled;
    el("network-scope").required=enabled;
    if(!enabled){el("lan-interface").required=false;el("lan-terms").required=false;}
    if(!enabled)return;
    el("network-scope").value=current?.accessScope||"";
    const lan=current?.accessScope==="lan", policy=current?.lanHttps;
    el("lan-options").hidden=!lan;el("lan-interface").required=lan;
    const selection=el("lan-interface"),old=current?.listenAddress;const placeholder=document.createElement("option");placeholder.textContent=setupMessage("chooseATemplate");placeholder.value="";selection.replaceChildren(placeholder);
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
      if(!scope)throw Error(setupMessage("requireExposure"));
      model.deployment.ingress ||= {format:1,mode:"standalone",tlsProvider:"custom",publicOrigin:model.deployment.authentication.deployment.publicOrigin};
      const current=model.deployment.ingress;
      current.accessScope=scope;
      if(scope==="lan"){
        const candidate=networkInventory.interfaces.find(entry=>entry.address===el("lan-interface").value);
        if(!candidate)throw Error(setupMessage("requireInterface"));
        current.listenAddress=candidate.address;current.allowedNetworks=[candidate.network];
        const mode=el("lan-provider").value;
        if(mode!=="custom"){
          const domain=el("lan-domain").value.trim(),server=el("lan-server").value.trim(),issuer=el("lan-issuer").value.trim();
          if(!domain||!server||!issuer)throw Error(setupMessage("requireAuthority"));
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
  el("lan-server").addEventListener("input",()=>{el("lan-invitation").value="";});
  el("lan-authority").addEventListener("change",()=>{
    el("lan-invitation").value="";
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
      input.value = typeof field.value === "boolean" ? (field.value ? setupMessage("enabled") : setupMessage("disabled")) : Array.isArray(field.value) ? field.value.join(", ") : String(field.value ?? setupMessage("notSet"));
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
      const input = document.createElement("input"); input.type = "number"; input.min = name === "maximumSwapBytes" ? "0" : name === "maximumMemoryBytes" ? "128" : String(1 / scale); input.step = name === "maximumMemoryBytes" || name === "maximumSwapBytes" ? "64" : scale > 1 ? "any" : "1"; input.value = String(value / scale); input.required = true;
      input.addEventListener("input", () => { model.runtime.limits[name] = Number(input.value) * scale; saveModel(); });
      label.append(input); el("limits").append(label);
    }
  };
  el("review").addEventListener("input", () => { confirmation = null; el("confirmation").hidden = true; });
  el("review").addEventListener("change", () => { try { synchronize(); } catch { status(setupMessage("invalidSettings")); } });
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
      if(changes.length) el("summary").append(list); else el("summary").textContent=setupMessage("unchangedSettings");
      el("confirmation").hidden = false; status(setupMessage("reviewed"));
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
          if (el("owner-password").value !== el("owner-confirm").value) throw new Error(setupMessage("passwordMismatch"));
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
    el("fields").disabled = true; el("apply").disabled = true; el("close").disabled = true; status(setupMessage("applying"));
    try {
      await post("/api/apply", body); status(setupMessage("applied"));
    }
    catch { status(setupMessage("applyUnconfirmed")); el("recover").hidden = false; }
    finally { for (const id of ["owner-password", "owner-confirm", "oidc-secret", "tls-key", "lan-invitation"]) el(id).value = ""; }
  });
  el("recover").addEventListener("click", async () => {
    el("recover").disabled = true; status(setupMessage("recovering"));
    try {
      const result = await post("/api/recover", { confirmation: "RECOVER" });
      if (result.phase === "complete") { status(setupMessage("recovered")); return; }
      const value = await post("/api/status", {}); model = value.review; el("review").value = JSON.stringify(model, null, 2); synchronize();
      el("fields").disabled = false; el("apply").disabled = false; el("close").disabled = false; confirmation = null; el("confirmation").hidden = true;
      status(setupMessage("reviewRecovery"));
    } catch { status(setupMessage("recoveryFailed")); }
    finally { el("recover").disabled = false; }
  });
  el("close").addEventListener("click", async () => { try { await post("/api/close", {}); status(setupMessage("closed")); el("fields").disabled = true; el("close").disabled = true; } catch (error) { status(error.message); } });
  (async () => {
    try {
      const session = await post("/api/session", { bootstrap }); token = session.token; csrf = session.csrf;
      const value = await post("/api/status", {}); model = value.review; baseline = structuredClone(model);
      initial = value.scope === "initial-prepared-host"; ingress = value.scope === "ingress-prepared-host";
      if (initial || ingress) {
        networkInventory=await post("/api/network",{});
        el("initial").hidden = false; el("recover").hidden = false;
        el("credentials-heading").textContent = initial ? setupMessage("administratorAndCredentials") : setupMessage("httpsCertificate");
        el("scope").textContent = initial ? setupMessage("initialScope") : setupMessage("ingressScope");
        if (ingress) for (const id of ["owner-name", "deployment-user", "owner-email", "owner-login", "owner-password", "owner-confirm", "owner-subject", "oidc-secret"]) el(id).closest("label").hidden = true;
      }
      el("origin").textContent = model.deployment.authentication.deployment.publicOrigin;
      el("review").value = JSON.stringify(model, null, 2); synchronize(); el("fields").disabled = false;
      status(setupMessage("reviewChanges"));
    } catch { status(setupMessage("invalidStart")); }
  })();
})();`;

export function serverSetupScript(locale) {
  return `const setupMessages = ${JSON.stringify(setupTexts(locale))};
const setupMessage = (key) => setupMessages[key];
${setupController}`;
}

export const setupScript = serverSetupScript("ja");
