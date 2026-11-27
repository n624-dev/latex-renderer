import { readFileSync } from "node:fs";
import { URL } from "node:url";
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
  const messageData = JSON.stringify(catalog).replaceAll("<", "\\u003c");
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
<section id="chatgpt-setup" hidden>
  <h2>${escapeSetupHtml(t("optionalChatGptConnection"))}</h2>
  <p>${escapeSetupHtml(t("enableChatGptFromTerminal"))} <code>sudo n624-latex server chatgpt --connect GATEWAY_HTTPS_ORIGIN</code></p>
  <button id="skip-chatgpt" type="button">${escapeSetupHtml(t("skipChatGptConnection"))}</button>
</section>
<button id="recover" type="button" hidden>${escapeSetupHtml(t("recoverInterruptedSetup"))}</button>
</main><script type="application/json" id="setup-messages">${messageData}</script><script src="/script.js" defer></script></html>`;
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

export const setupScript = readFileSync(new URL("./server-setup-browser.js", import.meta.url), "utf8");
