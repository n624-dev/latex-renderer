import type { AdminView } from "./view.js";
import { formText, requireElement, required } from "./view.js";

interface TexSelector {
  mode: string;
  value?: string | null;
}

interface TexRuntime {
  languages?: string[];
  effectiveLanguageCollections?: string[];
  snapshotDate?: string | null;
  selector?: TexSelector | null;
  appliedAt?: string | null;
  baseDigest?: string | null;
}

interface TexState {
  desired?: {
    selector?: TexSelector | null;
    languages?: string[];
    autoUpdate?: boolean;
  } | null;
  current?: TexRuntime | null;
  previous?: TexRuntime | null;
  lastApplyError?: string | null;
  activeOperationId?: string | null;
  lastOperationId?: string | null;
}

interface TexImages {
  registryUnavailable?: boolean;
  repository?: string;
  daily?: string[];
  weekly?: string[];
}

interface TexLanguage {
  id: string;
  description?: string;
  name?: string;
  recommended?: boolean;
}

interface TexLanguages {
  items: TexLanguage[];
  countryOverride?: string | null;
  effectiveCountry?: string | null;
  detectedCountry?: string | null;
  catalogUnavailable?: boolean;
}

interface TexInventory {
  total: number;
  items: string[];
  truncated?: boolean;
}

interface TexOperation {
  id: string;
  status: string;
  type?: string;
  log?: string;
  error?: string | null;
}

export function createTex({
  adminMessage, adminAction, beginManagerWatch, confirmDialog, err, esc, fmt, jsonBody, ok, out, request, section, watchManagerOperation
}: AdminView) {
function texLanguageLabel(item: TexLanguage){return item.description||item.name||item.id}
function texSelectorDisplay(selector: TexSelector | null | undefined){if(!selector)return adminMessage("notSet");if(selector.mode==='latest')return adminMessage("latestVersion");if(selector.mode==='weekly')return (adminMessage("weeklyBuild")+" ")+String(selector.value);return selector.value||selector.mode}
function texRuntimeCard(value: TexRuntime | null | undefined,title: string){if(!value)return '<article class="card"><h3>'+esc(title)+("</h3><p class=\"muted\">"+esc(adminMessage("none"))+"</p></article>");const selected=value.languages||[],effective=value.effectiveLanguageCollections||selected,dependencies=effective.filter(x=>!selected.includes(x));return '<article class="card"><h3>'+esc(title)+("</h3><dl class=\"details\"><dt>"+esc(adminMessage("version"))+"</dt><dd>")+esc(value.snapshotDate||texSelectorDisplay(value.selector))+("</dd><dt>"+esc(adminMessage("language"))+"</dt><dd>")+esc(selected.join(', ')||adminMessage("none"))+("</dd><dt>"+esc(adminMessage("appliedAt"))+"</dt><dd>")+esc(value.appliedAt?fmt(value.appliedAt):'—')+("</dd></dl><details><summary>"+esc(adminMessage("environmentDetails"))+"</summary><dl class=\"details\"><dt>Base digest</dt><dd><code>")+esc(value.baseDigest||'—')+("</code></dd><dt>Runtime</dt><dd>"+esc(adminMessage("builtAndVerifiedOnThisServer"))+"</dd><dt>"+esc(adminMessage("requiredLanguageCollections"))+"</dt><dd>")+esc(dependencies.join(', ')||adminMessage("none"))+'</dd></dl></details></article>'}
function renderTexOperation(operation: TexOperation | null,reconnecting=false){const target=document.querySelector('#tex-operation');if(!target||!operation)return;const status=reconnecting?adminMessage("reconnectingToAdminApi"):operation.status==='running'?adminMessage("processing"):operation.status==='succeeded'?adminMessage("completedSuccessfully"):adminMessage("failed");let card=target.querySelector<HTMLElement>('[data-tex-operation]');if(!card||card.dataset.operationId!==operation.id){target.replaceChildren();card=document.createElement('article');card.className='card';card.dataset.texOperation='';card.dataset.operationId=operation.id||'';const strong=document.createElement('strong');strong.dataset.operationStatus='';const label=document.createElement('p');label.className='muted';label.dataset.operationLabel='';const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent=adminMessage("showDetailedLog");details.append(summary,pre);card.append(strong,label,details);target.append(card)}requireElement<HTMLElement>(card,'[data-operation-status]').textContent=status;requireElement<HTMLElement>(card,'[data-operation-label]').textContent=(operation.type||'Image operation')+' / '+(operation.id||'');const pre=requireElement<HTMLPreElement>(card,'pre'),nextLog=operation.log||adminMessage("noLogEntriesYet"),previousScrollTop=pre.scrollTop,followTail=pre.scrollHeight-pre.scrollTop-pre.clientHeight<8;if(pre.textContent!==nextLog){pre.textContent=nextLog;pre.scrollTop=followTail?pre.scrollHeight:previousScrollTop}}
async function texEnvironment(){
  const signal=beginManagerWatch();
  const aborted=()=>signal.aborted;
  const responses=await Promise.all([
    request('/tex-environment/state',{signal}) as Promise<TexState>,
    request('/tex-environment/images',{signal}) as Promise<TexImages>,
    request('/tex-environment/languages',{signal}) as Promise<TexLanguages>,
  ]).catch((error: unknown)=>{if(!signal.aborted)throw error;return undefined});
  if(aborted()||responses===undefined)return;
  const [state,images,languages]=responses;
  const desired=state.desired||{};
  const selector=desired.selector||{mode:'latest',value:null},selected=new Set(desired.languages||[]),recommended=languages.items.filter(x=>x.recommended),others=languages.items.filter(x=>!x.recommended),languageRows=(items: readonly TexLanguage[])=>items.map(item=>'<label class="check" data-language-row data-label="'+esc((texLanguageLabel(item)+' '+item.id).toLowerCase())+'"><input type="checkbox" name="tex-language" value="'+esc(item.id)+'"'+(selected.has(item.id)?' checked':'')+'><span>'+esc(texLanguageLabel(item))+'</span></label>').join('');
  const savedCountry=languages.countryOverride||'';
  out.innerHTML=("<div class=\"page-heading\"><h1>"+esc(adminMessage("texEnvironment"))+"</h1></div>")+
    section(adminMessage("currentStatus"),(state.lastApplyError?("<div class=\"notice warning\"><strong>"+esc(adminMessage("thePreviousTexEnvironmentChangeFailed"))+"</strong><p>")+esc(state.lastApplyError)+'</p></div>':'')+'<div class="grid">'+texRuntimeCard(state.current,adminMessage("currentEnvironment"))+texRuntimeCard(state.previous,adminMessage("previousWorkingEnvironment"))+'</div>'+(images.registryUnavailable?("<p class=\"notice warning\">"+esc(adminMessage("couldNotFetchTheListOf"))+"</p>"):'')+("<details><summary>"+esc(adminMessage("distributionSourceDetails"))+"</summary><code>")+esc(images.repository||'—')+'</code></details>')+
    section(adminMessage("version"),("<form id=\"tex-image-form\" class=\"form-grid\"><label>"+esc(adminMessage("selectionMethod"))+"<select id=\"tex-image-mode\" name=\"mode\"><option value=\"latest\"")+(selector.mode==='latest'?' selected':'')+(">"+esc(adminMessage("latestVersion"))+"</option><option value=\"date\"")+(selector.mode==='date'?' selected':'')+(">"+esc(adminMessage("date2"))+"</option><option value=\"weekly\"")+(selector.mode==='weekly'?' selected':'')+(">"+esc(adminMessage("weeklyBuild"))+"</option><option value=\"digest\"")+(selector.mode==='digest'?' selected':'')+((">"+esc(adminMessage("digestAdvanced"))+"</option></select></label><label>")+esc(adminMessage("dateWeekOrDigest"))+"<input id=\"tex-image-value\" name=\"value\" value=\"")+esc(selector.value||'')+'" list="tex-image-values" placeholder="YYYY-MM-DD / YYYY-Www / sha256:..."></label><datalist id="tex-image-values">'+(images.daily||[]).map(x=>'<option value="'+esc(x)+'"></option>').join('')+(images.weekly||[]).map(x=>'<option value="'+esc(x)+'"></option>').join('')+'</datalist><label class="check"><input id="tex-auto-update" type="checkbox"'+(desired.autoUpdate?' checked':'')+("><span>"+esc(adminMessage("automaticallyUpdateToTheLatestVersion"))+"</span></label><label class=\"check\"><input id=\"tex-rebuild-missing\" type=\"checkbox\" checked><span>"+esc(adminMessage("buildOnThisServerIfNo"))+"</span></label><p class=\"notice warning wide\">"+esc(adminMessage("buildingTheEnvironmentCanTakeTens"))+"</p></form>"))+
    ("<details><summary>"+esc(adminMessage("languageDisplaySettings"))+"</summary><form id=\"tex-country-form\" class=\"form-grid\"><label>"+esc(adminMessage("countryForSortingTwoLetterIso"))+"<input name=\"country\" maxlength=\"2\" pattern=\"[A-Za-z]{2}\" value=\"")+esc(savedCountry)+("\" placeholder=\"JP\"></label><div class=\"wide\"><p>"+esc(adminMessage("current"))+" ")+esc(languages.effectiveCountry||adminMessage("unknown"))+((esc(adminMessage("thisChangesTheDisplayOrderOnly"))+"</p><p class=\"muted\">")+esc(adminMessage("automaticallyDetected"))+" ")+esc(languages.detectedCountry||adminMessage("unknown"))+("</p><div class=\"actions\"><button type=\"submit\">"+esc(adminMessage("saveCountry"))+"</button><button type=\"button\" id=\"tex-country-clear\" class=\"secondary\">"+esc(adminMessage("clearOverride"))+"</button></div></div></form></details>")+
    section(adminMessage("language"),'<div class="stack">'+(languages.catalogUnavailable?("<div class=\"notice warning\"><strong>"+esc(adminMessage("couldNotFetchTheTexLive"))+"</strong> "+esc(adminMessage("onlySavedLanguagesAreShownYou"))+"</div>"):'')+("<label>"+esc(adminMessage("search"))+"<input id=\"tex-language-search\" type=\"search\" placeholder=\"Japanese / collection-lang...\"></label><div class=\"actions\"><button type=\"button\" id=\"tex-select-all\" class=\"secondary\"")+(languages.catalogUnavailable?' disabled':'')+((">"+esc(adminMessage("selectAll"))+"</button><button type=\"button\" id=\"tex-clear-all\" class=\"secondary\">")+esc(adminMessage("deselectAll"))+"</button></div>")+(recommended.length?("<h3>"+esc(adminMessage("recommended"))+"</h3><div class=\"grid\" id=\"tex-recommended-languages\">")+languageRows(recommended)+'</div>':'')+("<h3>"+esc(adminMessage("other"))+"</h3><div class=\"grid\" id=\"tex-other-languages\">")+languageRows(others)+("</div><details><summary>"+esc(adminMessage("languageIdentifier"))+"</summary><dl class=\"details\">")+languages.items.map(item=>'<dt>'+esc(texLanguageLabel(item))+'</dt><dd><code>'+esc(item.id)+'</code></dd>').join('')+'</dl></details></div>')+
    section(adminMessage("change"),("<div class=\"actions\"><button id=\"tex-apply\">"+esc(adminMessage("applyChanges"))+"</button></div><details><summary>"+esc(adminMessage("maintenanceActions"))+"</summary><div class=\"actions\"><button id=\"tex-refresh-latest\" class=\"secondary\">"+esc(adminMessage("checkForTheLatestVersion"))+"</button><button id=\"tex-rollback\" class=\"danger\"")+(state.previous?'':' disabled')+(">"+esc(adminMessage("rollBackToPrevious"))+"</button><button id=\"tex-revalidate\" class=\"secondary\"")+(state.current?'':' disabled')+((">"+esc(adminMessage("verifyAgain"))+"</button><button id=\"tex-cleanup\" class=\"secondary\">")+esc(adminMessage("cleanUpUnusedImages"))+"</button></div></details><div id=\"tex-operation\" class=\"stack\" aria-live=\"polite\"></div>"))+
    section(adminMessage("packagesAndFonts"),("<form id=\"tex-inventory-form\" class=\"form-grid\"><label>"+esc(adminMessage("type"))+"<select name=\"kind\"><option value=\"packages\">"+esc(adminMessage("packages"))+"</option><option value=\"fonts\">"+esc(adminMessage("fonts"))+"</option></select></label><label>"+esc(adminMessage("search"))+"<input name=\"query\" placeholder=\"tikz / Noto ...\"></label><button>"+esc(adminMessage("search"))+"</button></form><div id=\"tex-inventory-result\"></div>"));

  const mode=requireElement<HTMLSelectElement>(document,'#tex-image-mode'),value=requireElement<HTMLInputElement>(document,'#tex-image-value'),autoUpdate=requireElement<HTMLInputElement>(document,'#tex-auto-update');
  const syncImageInput=()=>{const m=mode.value;value.disabled=m==='latest';value.placeholder=m==='date'?'YYYY-MM-DD':m==='weekly'?'YYYY-Www':m==='digest'?'sha256:...':'';if(m==='latest')value.value='';autoUpdate.disabled=m!=='latest';if(m!=='latest')autoUpdate.checked=false};mode.onchange=syncImageInput;syncImageInput();
  const languageSearch=requireElement<HTMLInputElement>(document,'#tex-language-search');
  languageSearch.oninput=()=>{const q=languageSearch.value.trim().toLowerCase();document.querySelectorAll<HTMLElement>('[data-language-row]').forEach(row=>{row.hidden=Boolean(q)&&!required(row.dataset.label, 'TeX language label').includes(q)})};
  requireElement<HTMLButtonElement>(document,'#tex-select-all').onclick=()=>{if(languages.catalogUnavailable)return;document.querySelectorAll<HTMLInputElement>('input[name="tex-language"]').forEach(x=>{x.checked=true})};
  requireElement<HTMLButtonElement>(document,'#tex-clear-all').onclick=()=>document.querySelectorAll<HTMLInputElement>('input[name="tex-language"]').forEach(x=>{x.checked=false});
  const countryForm=requireElement<HTMLFormElement>(document,'#tex-country-form');
  countryForm.onsubmit=adminAction(async (e: SubmitEvent)=>{e.preventDefault();const raw=formText(new FormData(countryForm),'country','').trim().toUpperCase();if(!/^[A-Z]{2}$/.test(raw)){err.textContent=adminMessage("enterATwoLetterIsoCountry");return}await request('/tex-environment/country',{method:'POST',...jsonBody({country:raw})});ok.textContent=adminMessage("countryPreferenceSaved");await texEnvironment()});
  requireElement<HTMLButtonElement>(document,'#tex-country-clear').onclick=adminAction(async()=>{await request('/tex-environment/country',{method:'POST',...jsonBody({country:null})});ok.textContent=adminMessage("countryOverrideRemoved");await texEnvironment()});
  requireElement<HTMLButtonElement>(document,'#tex-apply').onclick=()=>{try{const input=collectTexApply();const languageText=input.languages.length?input.languages.join(', '):adminMessage("none");confirmDialog({title:adminMessage("changeTexEnvironment"),description:adminMessage("buildAndVerifyTheEnvironmentUsing"),summary:("<dl class=\"details\"><dt>"+esc(adminMessage("version"))+"</dt><dd>")+esc(texSelectorDisplay(input.selector))+("</dd><dt>"+esc(adminMessage("language"))+"</dt><dd>")+esc(languageText)+("</dd><dt>"+esc(adminMessage("automaticUpdatesToTheLatestVersion"))+"</dt><dd>")+(input.autoUpdate?adminMessage("enabled"):adminMessage("disabled"))+("</dd><dt>"+esc(adminMessage("buildImagesForUnpublishedDates"))+"</dt><dd>")+(input.rebuildIfMissing?adminMessage("allow"):adminMessage("doNotAllow"))+'</dd></dl>',reason:true,submitLabel:adminMessage("fetchVerifyAndApply"),successMessage:adminMessage("texEnvironmentOperationStarted"),reload:false,onSubmit:f=>request('/tex-environment/apply',{method:'POST',...jsonBody({...input,reason:formText(f,'reason').trim()})}) as Promise<TexOperation>,afterSuccess:startTexOperation})}catch(e){err.textContent=e instanceof Error?e.message:String(e)}};
  for(const [id,path,title,danger,description] of [
    ['tex-refresh-latest','refresh',adminMessage("checkForTheLatestVersion"),false,adminMessage("fetchAndVerifyTheLatestVersion")],
    ['tex-rollback','rollback',adminMessage("restoreThePreviousWorkingEnvironment"),true,adminMessage("switchToThePreviousWorkingEnvironment")],
    ['tex-revalidate','revalidate',adminMessage("verifyTheCurrentEnvironmentAgain"),false,adminMessage("runVerificationInTheCurrentEnvironment")],
    ['tex-cleanup','cleanup',adminMessage("cleanUpUnusedImages"),false,adminMessage("removeUnusedLocalImagesWhileProtecting")]
  ] as const){const button=document.querySelector<HTMLButtonElement>('#'+id);if(!button)continue;button.onclick=()=>confirmDialog({title,reason:true,summary:'<p>'+esc(description)+'</p>',submitLabel:title,danger,successMessage:adminMessage("operationStarted"),reload:false,onSubmit:f=>request('/tex-environment/'+path,{method:'POST',...jsonBody({reason:formText(f,'reason').trim()})}) as Promise<TexOperation>,afterSuccess:startTexOperation})}
  const inventoryForm=requireElement<HTMLFormElement>(document,'#tex-inventory-form');
  inventoryForm.onsubmit=adminAction(async (e: SubmitEvent)=>{e.preventDefault();const f=new FormData(inventoryForm),kind=formText(f,'kind'),query=formText(f,'query','').trim(),data=await request('/tex-environment/inventory/'+kind+(query?'?q='+encodeURIComponent(query):'')) as TexInventory,target=requireElement<HTMLElement>(document,'#tex-inventory-result'),summary=document.createElement('p'),pre=document.createElement('pre');summary.className='muted';summary.textContent=adminMessage("itemCount",{count:new Intl.NumberFormat(document.documentElement.lang).format(data.total)})+(data.truncated?adminMessage("showingTheFirst500Entries"):'');pre.textContent=data.items.join('\n');target.replaceChildren(summary,pre)});
  const operationId=state.activeOperationId||state.lastOperationId;
  if(operationId){
    const operation=await (request('/tex-environment/operations/'+encodeURIComponent(operationId),{signal}) as Promise<TexOperation>)
      .catch((error: unknown)=>{if(!signal.aborted)throw error;return undefined});
    if(aborted()||operation===undefined)return;
    if(texOperationPending(operation))startTexOperation(operation,signal);
    else renderTexOperation(operation);
  }
}
function collectTexApply(){const mode=requireElement<HTMLSelectElement>(document,'#tex-image-mode').value,raw=requireElement<HTMLInputElement>(document,'#tex-image-value').value.trim();let selector: TexSelector;if(mode==='latest')selector={mode:'latest',value:null};else if(mode==='date'&&/^\d{4}-\d{2}-\d{2}$/.test(raw))selector={mode,value:raw};else if(mode==='weekly'&&/^\d{4}-W\d{2}$/.test(raw))selector={mode,value:raw};else if(mode==='digest'&&/^sha256:[a-f0-9]{64}$/.test(raw))selector={mode,value:raw};else throw new Error(adminMessage("invalidImageSelector"));return{selector,languages:[...document.querySelectorAll<HTMLInputElement>('input[name="tex-language"]:checked')].map(x=>x.value),autoUpdate:selector.mode==='latest'&&requireElement<HTMLInputElement>(document,'#tex-auto-update').checked,rebuildIfMissing:requireElement<HTMLInputElement>(document,'#tex-rebuild-missing').checked}}
function texOperationPending(operation: TexOperation){return operation.status==='running'}
function startTexOperation(operation: TexOperation | null,signal?: AbortSignal) {
  const target=document.querySelector('#tex-operation');
  if(!operation?.id||!target)return;
  void adminAction(()=>watchManagerOperation(operation,{
    signal:signal||beginManagerWatch(),endpoint:'/tex-environment/operations/',target,
    pending:texOperationPending,render:renderTexOperation,
    reconnectMessage:adminMessage("couldNotReconnectToTheAdmin"),
    maxFailures:40,
    finish:async operation=>{
      if(operation.status==='succeeded')ok.textContent=adminMessage("texEnvironmentOperationSucceeded");
      else err.textContent=operation.error||adminMessage("texEnvironmentOperationFailed");
      await texEnvironment();
    }
  }))();
}

  return { texEnvironment };
}
