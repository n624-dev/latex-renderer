export function createControls({
  adminMessage, err, ok, request, refreshPage
}) {
let activeDialog = null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function tableValue(v){const value=String(v??'');return /^(?:[a-z]+_[a-f0-9]{32}|[a-f0-9]{64}|[a-f0-9-]{36})$/.test(value)?'<details class="identifier"><summary>'+esc(value.slice(0,14))+'…</summary><code>'+esc(value)+'</code></details>':esc(value)}
const fmt=v=>v?new Date(v).toLocaleString(document.documentElement.lang || 'en'):'—';
const bytes=v=>v==null?'—':v<1048576?Math.round(v/1024)+' KiB':v<1073741824?(v/1048576).toFixed(1)+' MiB':(v/1073741824).toFixed(2)+' GiB';
function section(title,body){return '<section><h2>'+esc(title)+'</h2>'+body+'</section>'}
function nextPage(cursor,label=adminMessage("nextPage")){if(!cursor)return '';const query=new URLSearchParams(location.search);query.set('cursor',cursor);return '<div class="actions"><a class="button secondary" href="'+esc(location.pathname+'?'+query)+'">'+esc(label)+'</a></div>'}
/**
 * @template Item
 * @param {readonly Item[]} items
 * @param {ReadonlyArray<readonly [string, string | ((item: Item) => unknown)]>} cols
 * @param {string | ((item: Item) => string)} [actions]
 */
function table(items,cols,actions='',select=false){if(!items.length)return ("<p class=\"empty\">"+esc(adminMessage("noData"))+"</p>");return '<div class="table-wrap"><table class="responsive-table"><thead><tr>'+(select?("<th>"+esc(adminMessage("select"))+"</th>"):'')+cols.map(c=>'<th>'+esc(c[0])+'</th>').join('')+(actions?("<th>"+esc(adminMessage("actions"))+"</th>"):'')+'</tr></thead><tbody>'+items.map(x=>'<tr>'+(select?("<td data-label=\""+esc(adminMessage("select"))+"\"><input type=\"checkbox\" data-select=\"")+esc(x.id)+'" aria-label="'+esc(adminMessage("selectRow",{id:x.id}))+'"></td>':'')+cols.map(c=>'<td data-label="'+esc(c[0])+'">'+tableValue(typeof c[1]==='function'?c[1](x):x[c[1]])+'</td>').join('')+(actions?("<td data-label=\""+esc(adminMessage("actions"))+"\" class=\"actions-cell\"><div class=\"actions-group\">")+actions(x)+'</div></td>':'')+'</tr>').join('')+'</tbody></table></div>'}
function adminAction(fn) {
  let pending=false;
  return async (...args) => {
    args[0]?.preventDefault?.();
    if(pending)return;
    pending=true;
    try { await fn(...args); }
    catch (error) { err.textContent=error instanceof Error?error.message:String(error); }
    finally { pending=false; }
  };
}
function bindAction(selector,fn){document.querySelectorAll(selector).forEach(button=>button.addEventListener('click',adminAction(()=>fn(button))))}
function bindPagedChoices(dialog,{endpoint,initialCursor,prefix,select,label,emptyLabel}) {
  const search=dialog.querySelector('[data-'+prefix+'-search]');
  const next=dialog.querySelector('[data-'+prefix+'-next]');
  const query=dialog.querySelector('[data-'+prefix+'-query]');
  const status=dialog.querySelector('[data-'+prefix+'-error]');
  const controller=new AbortController();
  dialog.addEventListener('close',()=>controller.abort(),{once:true});
  let cursor=initialCursor||null,currentQuery='',loading=false;
  next.disabled=!cursor;

  const load=async reset=>{
    if(loading||!dialog.open||dialog.dataset.busy==='true')return;
    loading=true;
    search.disabled=true;
    next.disabled=true;
    status.textContent='';
    const selected=select.selectedOptions[0],value=select.value;
    const parameters=new URLSearchParams({pageSize:'50'});
    const requestedQuery=reset?query.value.trim():currentQuery;
    if(requestedQuery)parameters.set('query',requestedQuery);
    if(!reset&&cursor)parameters.set('cursor',cursor);
    try {
      const page=await request(endpoint+'?'+parameters,{signal:controller.signal});
      if(!dialog.open)return;
      const accounts=page.items.filter(item=>item.status==='active');
      const options=accounts.map(item=>new Option(label(item),item.id));
      if(value&&!accounts.some(item=>item.id===value)&&selected)options.push(selected.cloneNode(true));
      select.replaceChildren(new Option(adminMessage("selectAnOption"),''),...options);
      select.value=value;
      cursor=page.nextCursor||null;
      currentQuery=requestedQuery;
      if(!accounts.length)status.textContent=emptyLabel;
    } catch(error) {
      if(dialog.open)status.textContent=error instanceof Error?error.message:String(error);
    } finally {
      loading=false;
      if(dialog.open){search.disabled=false;next.disabled=!cursor;}
    }
  };
  search.onclick=()=>{void load(true);};
  next.onclick=()=>{void load(false);};
  query.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void load(true);}};
  return ()=>loading;
}
let managerWatch;
function stopManagerWatch(){managerWatch?.abort();managerWatch=undefined}
function beginManagerWatch(){stopManagerWatch();managerWatch=new AbortController();return managerWatch.signal}
function waitForManagerPoll(milliseconds,signal) {
  return new Promise(resolve=>{
    if(signal.aborted){resolve();return}
    const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve()};
    const timer=setTimeout(done,milliseconds);
    signal.addEventListener('abort',done,{once:true});
  });
}
async function watchManagerOperation(operation,{signal,endpoint,target,pending,render,finish,reconnectMessage,maxFailures}) {
  let failures=0;
  while(!signal.aborted&&target.isConnected){
    render(operation);
    if(!pending(operation)){await finish(operation);return}
    await waitForManagerPoll(1500,signal);
    if(signal.aborted||!target.isConnected)return;
    try {
      const next=await request(endpoint+encodeURIComponent(operation.id),{signal});
      if(next?.id!==operation.id)throw new Error(adminMessage("theServerReturnedAnInvalidResponse"));
      operation=next;
      failures=0;
    } catch {
      if(signal.aborted||!target.isConnected)return;
      render(operation,true);
      if(++failures>=maxFailures){err.textContent=reconnectMessage;return}
      await waitForManagerPoll(1000,signal);
    }
  }
}
function jsonBody(value){return{headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}}
function closeAdminDialog(dialog=activeDialog){if(!dialog)return;clearIssuedCredential(dialog);if(activeDialog===dialog)activeDialog=null;if(dialog.open)dialog.close();else dialog.remove()}
function openAdminDialog(title,body,{description='',wide=false}={}){closeAdminDialog();const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null,d=document.createElement('dialog'),heading='dialog-title-'+crypto.randomUUID(),markup='<div class="dialog-heading"><h2 id="'+heading+'">'+esc(title)+("</h2><button type=\"button\" class=\"ghost dialog-close\" aria-label=\""+esc(adminMessage("close"))+"\">×</button></div>")+(description?'<p class="dialog-description">'+esc(description)+'</p>':'')+body,parsed=new DOMParser().parseFromString(markup,'text/html');d.className='admin-dialog'+(wide?' wide':'');d.setAttribute('aria-labelledby',heading);d.replaceChildren(...parsed.body.childNodes);d.querySelector('.dialog-close').onclick=()=>closeAdminDialog(d);d.addEventListener('cancel',e=>{if(d.dataset.busy==='true')e.preventDefault()});d.addEventListener('close',()=>{if(activeDialog===d)activeDialog=null;d.remove();if(trigger?.isConnected)trigger.focus()},{once:true});document.body.append(d);activeDialog=d;d.showModal();queueMicrotask(()=>{const target=d.querySelector('[autofocus],input:not([type="hidden"]),select,textarea,button');if(target instanceof HTMLElement)target.focus()});return d}
function formDialog({title,description='',fields,submitLabel=adminMessage("save"),danger=false,successMessage='',onSubmit,afterSuccess,wide=false,reload=true}){const d=openAdminDialog(title,'<form class="dialog-form"><div class="form-grid dialog-fields">'+fields+("</div><p class=\"dialog-error\" role=\"alert\"></p><div class=\"dialog-actions\"><button type=\"button\" class=\"secondary\" data-dialog-cancel>"+esc(adminMessage("cancel"))+"</button><button type=\"submit\"")+(danger?' class="danger"':'')+'>'+esc(submitLabel)+'</button></div></form>',{description,wide}),form=d.querySelector('form'),localError=d.querySelector('.dialog-error');d.querySelector('[data-dialog-cancel]').onclick=()=>closeAdminDialog(d);form.onsubmit=async e=>{e.preventDefault();if(d.dataset.busy==='true')return;localError.textContent='';d.dataset.busy='true';for(const button of form.querySelectorAll('button'))button.disabled=true;try{const value=await onSubmit(new FormData(form),d);if(!d.open||activeDialog!==d)return;closeAdminDialog(d);if(reload)await refreshPage();if(successMessage)ok.textContent=successMessage;if(afterSuccess)afterSuccess(value)}catch(error){d.dataset.busy='false';localError.textContent=error instanceof Error?error.message:String(error);for(const button of form.querySelectorAll('button'))button.disabled=false}};return d}
function confirmDialog({title,description='',summary='',submitLabel=adminMessage("run"),danger=false,successMessage='',reason=false,onSubmit,afterSuccess,reload=true}){return formDialog({title,description,fields:'<div class="wide dialog-summary">'+summary+'</div>'+(reason?("<label class=\"wide\">"+esc(adminMessage("reasonForThisActionSavedIn"))+"<textarea name=\"reason\" required minlength=\"1\" maxlength=\"500\" autofocus></textarea><small>"+esc(adminMessage("doNotEnterSecretsOrApi"))+"</small></label>"):''),submitLabel,danger,successMessage,onSubmit,afterSuccess,reload})}
const displayLabels={user:adminMessage("user"),admin:adminMessage("administrator"),owner:adminMessage("owner"),active:adminMessage("enabled"),disabled:adminMessage("disabled"),password:adminMessage("password"),oidc:'OpenID Connect',cloudflare_access:'Cloudflare Access',success:adminMessage("succeeded"),failure:adminMessage("failed"),failed:adminMessage("failed"),requested:adminMessage("requested"),rejected:adminMessage("rejected"),normal:adminMessage("normalOperation"),'read-only':adminMessage("readOnly"),lockdown:adminMessage("emergencyLockdown"),running:adminMessage("running"),paused:adminMessage("paused"),draining:adminMessage("waitingForRunningJobsToFinish"),'cloudflare-access':'Cloudflare Access',generic:adminMessage("generalPurposeCli"),ci:'CI',mcp:'MCP',codex:'Codex','claude-code':'Claude Code'};const displayLabel=v=>Object.hasOwn(displayLabels,v)?displayLabels[v]:v;
function linkageLabel(user){return [...new Set([...(user.credential?['password']:[]),...(user.identities??[]).map(x=>x.provider)])].map(displayLabel).join(', ')||adminMessage("notSet")}
function userDetails(user){return{ID:user.id,[adminMessage("email")]:user.email??adminMessage("notSet"),[adminMessage("displayName")]:user.display_name,[adminMessage("role")]:user.role,[adminMessage("status")]:user.status,[adminMessage("authentication")]:linkageLabel(user),外部認証:user.identities??[],[adminMessage("loginName")]:user.credential?.login_name??'—',[adminMessage("lastSignIn")]:user.last_login_at??adminMessage("none")}}
function details(value,title=adminMessage("details")){const labels={id:adminMessage("identifier"),display_name:adminMessage("displayName"),name:adminMessage("name"),email:adminMessage("email"),role:adminMessage("role"),status:adminMessage("status"),client_type:adminMessage("type"),owner_user_id:adminMessage("ownerId"),service_account_id:adminMessage("serviceAccountId"),prefix:adminMessage("keyPrefix"),sourceRef:adminMessage("inputFileReference"),expiresAt:adminMessage("expires"),expires_at:adminMessage("expires"),created_at:adminMessage("created"),last_used_at:adminMessage("lastUsed"),revoked_at:adminMessage("revoked"),entrypoint:adminMessage("targetFile"),action:adminMessage("actions"),result:adminMessage("result"),reason:adminMessage("reason")},entries=value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value).filter(([key,item])=>(labels[key]||/[^a-zA-Z0-9_]/.test(key))&&['string','number','boolean'].includes(typeof item)):[],summary=entries.length?'<dl class="details">'+entries.map(([key,item])=>'<dt>'+esc(labels[key]||key)+'</dt><dd>'+esc(displayLabel(item))+'</dd>').join('')+'</dl>':("<p>"+esc(adminMessage("openDetailedDataToSeeEvery"))+"</p>"),d=openAdminDialog(title,summary+("<details><summary>"+esc(adminMessage("detailedDataJson"))+"</summary><pre class=\"dialog-json\"></pre></details><div class=\"dialog-actions\"><button type=\"button\" data-detail-copy>"+esc(adminMessage("copyAllFields"))+"</button><button type=\"button\" data-dialog-close>"+esc(adminMessage("close"))+"</button></div>"),{wide:true}),raw=JSON.stringify(value,null,2);d.querySelector('pre').textContent=raw;d.querySelector('[data-detail-copy]').onclick=()=>navigator.clipboard.writeText(raw).catch(()=>{err.textContent=adminMessage("copyFailedSelectTheTextIn")});d.querySelector('[data-dialog-close]').onclick=()=>closeAdminDialog(d);return d}
function clearIssuedCredential(dialog) {
  const value=dialog?.querySelector('[data-issued-credential]');
  if(value)value.textContent='';
}
function credentialDialog(value,title=adminMessage("apiKeyIssued")) {
  const d=openAdminDialog(title,("<div class=\"credential\"><code data-issued-credential></code></div><p class=\"dialog-error\" role=\"alert\"></p><div class=\"dialog-actions\"><button type=\"button\" id=\"copy-issued\">"+esc(adminMessage("copyAndClose"))+"</button><button type=\"button\" class=\"secondary\" id=\"dismiss-issued\">"+esc(adminMessage("dismissWithoutCopying"))+"</button></div>"),{description:adminMessage("thisValueIsShownOnlyOnce"),wide:true});
  const code=d.querySelector('[data-issued-credential]'), localError=d.querySelector('.dialog-error');
  code.textContent=value;
  d.addEventListener('cancel',()=>clearIssuedCredential(d));
  d.addEventListener('close',()=>clearIssuedCredential(d),{once:true});
  d.querySelector('#copy-issued').onclick=async()=>{
    if(!code.textContent)return;
    try {
      await navigator.clipboard.writeText(code.textContent);
      if(!d.open)return;
      closeAdminDialog(d);
      ok.textContent=adminMessage("apiKeyCopiedStoreItSecurely");
    } catch {
      if(d.open)localError.textContent=adminMessage("thisValueIsShownOnlyOnce");
    }
  };
  d.querySelector('#dismiss-issued').onclick=()=>closeAdminDialog(d);
}

  return { bindAction, bindPagedChoices, confirmDialog, details, displayLabel, esc, fmt, formDialog, jsonBody, linkageLabel, nextPage, section, table, userDetails, bytes, credentialDialog, adminAction, beginManagerWatch, stopManagerWatch, watchManagerOperation, closeAdminDialog };
}
