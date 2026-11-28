import type { AdminView } from "./view.js";
import { formText, requireElement } from "./view.js";

interface UpdateToolchain {
  node?: { version?: string } | null;
  corepack?: { version?: string } | null;
  apt?: { status: string; nodeVersion?: string; corepackVersion?: string } | null;
  update?: { status: string; checkedAt: string } | null;
}

interface UpdateState {
  installed?: { version?: string; releaseId?: string } | null;
  available?: { version?: string; unavailableReason?: string | null } | null;
  policy?: { channel: string; mode: string } | null;
  updater?: { status?: string; running?: { version?: string } | null } | null;
  toolchain?: UpdateToolchain | null;
  previousReleaseId?: string | null;
  previousRollbackCompatible?: boolean;
  lastError?: string | null;
  activeOperationId?: string | null;
  lastOperationId?: string | null;
}

interface UpdateOperation {
  id: string;
  status: string;
  outcome?: { complete?: boolean; updater?: string } | null;
  log?: string;
  error?: string | null;
}

export function createUpdates({
  adminMessage, adminAction, beginManagerWatch, confirmDialog, err, esc, jsonBody, ok, out, request, section, watchManagerOperation
}: AdminView) {
function updateVersion(value: string | null | undefined){return value?'v'+value:'—'}
// One bounded view state; no log text or credentials are retained here.
let updateLogView: {id: string | null; open: boolean; scrollTop: number} = {id:null,open:false,scrollTop:0};
function rememberUpdateLogView(){
  const card=document.querySelector<HTMLElement>('#update-operation > article');
  if(card&&card.dataset.operationId===updateLogView.id){updateLogView.open=requireElement<HTMLDetailsElement>(card,'details').open;updateLogView.scrollTop=requireElement<HTMLPreElement>(card,'pre').scrollTop}
}
function updateOperationLabel(operation: UpdateOperation){if(operation.status==='running')return adminMessage("processing");if(operation.status==='failed')return adminMessage("failed");if(operation.outcome&&operation.outcome.complete)return adminMessage("completedSuccessfully");return operation.outcome&&operation.outcome.updater==='activating'?adminMessage("applicationUpdatedWaitingForUpdaterTo"):adminMessage("applicationUpdatedCheckUpdater")}
function renderUpdateOperation(operation: UpdateOperation | null,reconnecting=false){
  const target=document.querySelector('#update-operation');if(!target||!operation)return;
  const status=reconnecting?adminMessage("reconnectingToAdminApi"):updateOperationLabel(operation);
  rememberUpdateLogView();
  if(updateLogView.id!==operation.id)updateLogView={id:operation.id,open:false,scrollTop:0};
  let card=target.firstElementChild as HTMLElement | null;
  if(!card||card.dataset.operationId!==operation.id){
    target.replaceChildren();card=document.createElement('article');card.className='card';card.dataset.operationId=operation.id;
    const strong=document.createElement('strong'),details=document.createElement('details'),summary=document.createElement('summary'),identifier=document.createElement('p'),pre=document.createElement('pre');
    details.open=updateLogView.open;summary.textContent=adminMessage("detailedLog");identifier.className='muted';identifier.textContent=(adminMessage("operationId")+" ")+(operation.id||'');
    details.addEventListener('toggle',()=>{if(updateLogView.id===operation.id)updateLogView.open=details.open});
    pre.addEventListener('scroll',()=>{if(updateLogView.id===operation.id)updateLogView.scrollTop=pre.scrollTop});
    pre.className='update-log';details.append(summary,identifier,pre);card.append(strong,details);target.append(card);
  }
  requireElement<HTMLElement>(card,'strong').textContent=status;
  const pre=requireElement<HTMLPreElement>(card,'pre'),text=operation.log||adminMessage("noLogEntriesYet");
  if(pre.textContent!==text){const scrollTop=updateLogView.scrollTop;pre.textContent=text;pre.scrollTop=scrollTop}
}
function toolchainDetails(toolchain: UpdateToolchain | null | undefined) {
  if (!toolchain?.node) return "";
  const running = `Node.js ${esc(toolchain.node.version || "—")} · Corepack ${esc(toolchain.corepack?.version || "—")}`;
  const apt = toolchain.apt;
  const candidate = apt && apt.status !== "current"
    ? `<p>${esc(adminMessage("updateCandidate"))} (APT) <strong>Node.js ${esc(apt.nodeVersion)} · Corepack ${esc(apt.corepackVersion)}</strong></p>`
    : "";
  const incompatible = apt?.status === "incompatible"
    ? `<p class="error-summary">${esc(adminMessage("thisVersionCannotBeApplied"))}</p>`
    : "";
  const update = toolchain.update;
  const result = update
    ? `<p>${esc(adminMessage(update.status === "applied" ? "completedSuccessfully" : "failed"))} · <time datetime="${esc(update.checkedAt)}">${esc(new Date(update.checkedAt).toLocaleString(document.documentElement.lang))}</time></p>`
    : "";
  return `<details><summary>Node.js / Corepack</summary><p>${esc(adminMessage("currentVersion"))} <strong>${running}</strong></p>${candidate}${incompatible}${result}</details>`;
}
async function updates(){
  const signal=beginManagerWatch();
  const aborted=()=>signal.aborted;
  const state=await (request('/updates/state',{signal}) as Promise<UpdateState>).catch((error: unknown)=>{if(!signal.aborted)throw error;return undefined});
  if(aborted()||state===undefined)return;
  const installed=state.installed||{},available=state.available||null,policy=state.policy||{channel:'stable',mode:'notify'};
  const updater=state.updater||{},running=updater.running||{};
  const updaterCard=("<details><summary>"+esc(adminMessage("updaterDetails"))+"</summary><p>Updater: <strong>")+esc(updateVersion(running.version))+'</strong></p><p>'+esc(updater.status==='ready'?adminMessage("switchAndRunningStateVerified"):updater.status==='activating'?adminMessage("switchInProgressNotComplete"):adminMessage("couldNotVerifyStatus"))+'</p></details>';
  const unavailable=available&&available.unavailableReason?("<div class=\"notice warning\"><strong>"+esc(adminMessage("thisVersionCannotBeApplied"))+"</strong><p>")+esc(available.unavailableReason)+'</p></div>':'';
  const stateCards=("<div class=\"grid\"><article class=\"card\"><h3>"+esc(adminMessage("currentVersion"))+"</h3><p><strong>")+esc(updateVersion(installed.version))+("</strong></p></article><article class=\"card\"><h3>"+esc(adminMessage("updateCandidate"))+"</h3><p><strong>")+esc(updateVersion(available&&available.version))+'</strong></p><p>'+(policy.mode==='automatic'?adminMessage("applyAutomatically"):adminMessage("notifyOnly"))+("</p></article></div><details><summary>"+esc(adminMessage("versionDetails"))+"</summary><p>"+esc(adminMessage("currentReleaseId"))+" <code>")+esc(installed.releaseId||'—')+("</code></p><p>"+esc(adminMessage("updateChannel"))+" <code>")+esc(policy.channel)+("</code></p><p>"+esc(adminMessage("recoveryTarget"))+" <code>")+esc(state.previousReleaseId||adminMessage("noPreviousWorkingVersion"))+'</code></p></details>';
  const policyForm=("<form id=\"update-policy-form\" class=\"form-grid\"><label>"+esc(adminMessage("stableUpdates"))+"<select name=\"mode\"><option value=\"notify\"")+(policy.mode==='notify'?' selected':'')+(">"+esc(adminMessage("checkAndNotifyOnlyDefault"))+"</option><option value=\"automatic\"")+(policy.mode==='automatic'?' selected':'')+((">"+esc(adminMessage("applyAutomaticallyAfterVerification"))+"</option></select></label><label class=\"wide\">")+esc(adminMessage("reasonForTheChangeSavedIn"))+"<textarea name=\"reason\" required minlength=\"1\" maxlength=\"500\"></textarea><small>"+esc(adminMessage("doNotEnterSecretsOrApi"))+"</small></label><p class=\"wide\">"+esc(adminMessage("withAutomaticUpdatesServicesRestartAfter"))+"</p><button>"+esc(adminMessage("savePolicy"))+"</button></form>");
  const operationForm=("<form id=\"update-version-form\" class=\"form-grid\"><label>"+esc(adminMessage("versionLeaveBlankForTheLatest"))+"<input name=\"version\" pattern=\"v?(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-rc\\.[1-9]\\d*)?\" placeholder=\"vX.Y.Z\"></label><small class=\"wide\">"+esc(adminMessage("releaseCandidateVersionHint"))+"</small><div class=\"actions wide\"><button type=\"button\" id=\"update-check\" class=\"secondary\">"+esc(adminMessage("checkForUpdates"))+"</button><button type=\"button\" id=\"update-apply\">"+esc(adminMessage("downloadVerifyAndUpdate"))+"</button><button type=\"button\" id=\"update-rollback\" class=\"danger\"")+(state.previousReleaseId&&state.previousRollbackCompatible?'':' disabled')+(">"+esc(adminMessage("rollBackToPrevious"))+"</button></div></form><div id=\"update-operation\" class=\"stack\" aria-live=\"polite\"></div>");
  rememberUpdateLogView();
  out.innerHTML=("<div class=\"page-heading\"><h1>"+esc(adminMessage("applicationUpdate"))+"</h1></div>")+section(adminMessage("status"),stateCards+updaterCard+toolchainDetails(state.toolchain)+unavailable+(state.lastError?("<div class=\"notice warning\"><strong>"+esc(adminMessage("applicationUpdatePreviousOperationFailed"))+"</strong><p>")+esc(state.lastError)+'</p></div>':''))+section(adminMessage("updatePolicy"),policyForm)+section(adminMessage("actions"),operationForm);
  const version=()=>formText(new FormData(requireElement<HTMLFormElement>(document,'#update-version-form')),'version','').trim();
  const form=requireElement<HTMLFormElement>(document,'#update-policy-form');
  form.onsubmit=adminAction(async (event: SubmitEvent)=>{event.preventDefault();const data=new FormData(form),mode=formText(data,'mode'),reason=formText(data,'reason','').trim();await request('/updates/policy',{method:'POST',...jsonBody({channel:'stable',mode,reason})});ok.textContent=adminMessage("applicationUpdatePolicySaved");await updates()});
  requireElement<HTMLButtonElement>(document,'#update-check').onclick=adminAction(async()=>{const selected=version(),result=await request('/updates/check',{method:'POST',...jsonBody(selected?{version:selected}:{})}) as {version?: string};ok.textContent=adminMessage("versionChecked",{version:updateVersion(result.version)});await updates()});
  requireElement<HTMLButtonElement>(document,'#update-apply').onclick=()=>{const selected=version();confirmDialog({title:adminMessage("updateApplication"),description:adminMessage("servicesRestartAfterBackupAndVerification"),summary:("<p>"+esc(adminMessage("target2"))+" <strong>")+esc(selected||adminMessage("latestStableRelease"))+("</strong></p><p>"+esc(adminMessage("someFailedUpdatesCannotBeRolled"))+"</p>"),reason:true,submitLabel:adminMessage("startUpdate"),successMessage:adminMessage("applicationUpdateOperationStarted"),reload:false,onSubmit:f=>request('/updates/apply',{method:'POST',...jsonBody({...(selected?{version:selected}:{}),reason:formText(f,'reason','').trim()})}) as Promise<UpdateOperation>,afterSuccess:startUpdateOperation})};
  requireElement<HTMLButtonElement>(document,'#update-rollback').onclick=()=>confirmDialog({title:adminMessage("restoreThePreviousApplicationVersion"),summary:'<p>'+esc(adminMessage("backUpAndRedeploy",{releaseId:state.previousReleaseId||''}))+'</p>',reason:true,submitLabel:adminMessage("rollBack"),danger:true,successMessage:adminMessage("rollbackStarted"),reload:false,onSubmit:f=>request('/updates/rollback',{method:'POST',...jsonBody({reason:formText(f,'reason','').trim()})}) as Promise<UpdateOperation>,afterSuccess:startUpdateOperation});
  const operationId=state.activeOperationId||state.lastOperationId;
  if(operationId){
    const operation=await (request('/updates/operations/'+encodeURIComponent(operationId),{signal}) as Promise<UpdateOperation>)
      .catch((error: unknown)=>{if(!signal.aborted)throw error;return undefined});
    if(aborted()||operation===undefined)return;
    if(updateOperationPending(operation))startUpdateOperation(operation,signal);
    else renderUpdateOperation(operation);
  }
}
function updateOperationPending(operation: UpdateOperation){return operation.status==='running'||operation.outcome?.updater==='activating'}
function startUpdateOperation(operation: UpdateOperation | null,signal?: AbortSignal) {
  const target=document.querySelector('#update-operation');
  if(!operation?.id||!target)return;
  void adminAction(()=>watchManagerOperation(operation,{
    signal:signal||beginManagerWatch(),endpoint:'/updates/operations/',target,
    pending:updateOperationPending,render:renderUpdateOperation,
    reconnectMessage:adminMessage("couldNotReconnectToTheAdmin2"),
    maxFailures:120,
    finish:async operation=>{
      if(operation.status==='succeeded'){
        if(operation.outcome?.complete)ok.textContent=adminMessage("confirmedThatTheApplicationAndUpdater");
        else err.textContent=adminMessage("theApplicationHasBeenUpdatedUpdater");
      }else err.textContent=operation.error||adminMessage("applicationUpdateOperationFailed");
      await updates();
    }
  }))();
}

  return { updates };
}
