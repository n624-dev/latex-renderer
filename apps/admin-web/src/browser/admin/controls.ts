import type { Page, UserRow } from "./list-responses.js";
import type { AdminInput } from "./view.js";
import { requireElement } from "./view.js";

interface ControlsInput extends Pick<AdminInput, "adminMessage" | "err" | "ok" | "request"> {
  refreshPage: () => Promise<void>;
}

interface PagedChoices<Item> {
  endpoint: string;
  initialCursor: string | null | undefined;
  prefix: string;
  select: HTMLSelectElement;
  label: (item: Item) => string;
  emptyLabel: string;
}

interface ManagerWatch<Operation> {
  signal: AbortSignal;
  endpoint: string;
  target: Element;
  pending: (operation: Operation) => boolean;
  render: (operation: Operation, reconnecting?: boolean) => void;
  finish: (operation: Operation) => Promise<void>;
  reconnectMessage: string;
  maxFailures: number;
}

interface DialogOptions<Result> {
  title: string;
  description?: string | undefined;
  fields: string;
  submitLabel?: string;
  danger?: boolean;
  successMessage?: string;
  onSubmit: (form: FormData, dialog: HTMLDialogElement) => Promise<Result>;
  afterSuccess?: ((result: Result) => void) | undefined;
  wide?: boolean;
  reload?: boolean;
}

interface ConfirmOptions<Result> extends Omit<DialogOptions<Result>, "fields" | "wide"> {
  summary?: string;
  reason?: boolean;
}

export function createControls({
  adminMessage, err, ok, request, refreshPage
}: ControlsInput) {
let activeDialog: HTMLDialogElement | null = null;
const htmlEntities: Readonly<Record<string, string>> = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
function textValue(value: unknown): string {
  // Details and table cells retain the same string conversion for arbitrary values.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(value??'');
}
const esc=(v: unknown)=>textValue(v).replace(/[&<>"']/g,c=>htmlEntities[c]??c);
function tableValue(v: unknown){const value=textValue(v);return /^(?:[a-z]+_[a-f0-9]{32}|[a-f0-9]{64}|[a-f0-9-]{36})$/.test(value)?'<details class="identifier"><summary>'+esc(value.slice(0,14))+'…</summary><code>'+esc(value)+'</code></details>':esc(value)}
const fmt=(v: string | null | undefined)=>v?new Date(v).toLocaleString(document.documentElement.lang || 'en'):'—';
const bytes=(v: number | null | undefined)=>v==null?'—':v<1048576?String(Math.round(v/1024))+' KiB':v<1073741824?(v/1048576).toFixed(1)+' MiB':(v/1073741824).toFixed(2)+' GiB';
function section(title: string,body: string){return '<section><h2>'+esc(title)+'</h2>'+body+'</section>'}
function nextPage(cursor: string | null | undefined,label=adminMessage("nextPage")){if(!cursor)return '';const query=new URLSearchParams(location.search);query.set('cursor',cursor);return '<div class="actions"><a class="button secondary" href="'+esc(location.pathname+'?'+query.toString())+'">'+esc(label)+'</a></div>'}
function table<Item extends object>(
  items: readonly Item[],
  cols: ReadonlyArray<readonly [string, keyof Item | ((item: Item) => unknown)]>,
  actions: '' | ((item: Item) => string) = '',
  select = false,
){if(!items.length)return ("<p class=\"empty\">"+esc(adminMessage("noData"))+"</p>");return '<div class="table-wrap"><table class="responsive-table"><thead><tr>'+(select?("<th>"+esc(adminMessage("select"))+"</th>"):'')+cols.map(c=>'<th>'+esc(c[0])+'</th>').join('')+(actions?("<th>"+esc(adminMessage("actions"))+"</th>"):'')+'</tr></thead><tbody>'+items.map(x=>{const id=select?(x as {id: string}).id:'';return '<tr>'+(select?("<td data-label=\""+esc(adminMessage("select"))+"\"><input type=\"checkbox\" data-select=\"")+esc(id)+'" aria-label="'+esc(adminMessage("selectRow",{id}))+'"></td>':'')+cols.map(c=>'<td data-label="'+esc(c[0])+'">'+tableValue(typeof c[1]==='function'?c[1](x):x[c[1]])+'</td>').join('')+(actions?("<td data-label=\""+esc(adminMessage("actions"))+"\" class=\"actions-cell\"><div class=\"actions-group\">")+actions(x)+'</div></td>':'')+'</tr>'}).join('')+'</tbody></table></div>'}
function adminAction<Args extends [] | [Event]>(fn: (...args: Args) => unknown) {
  let pending=false;
  return async (...args: Args) => {
    args[0]?.preventDefault();
    if(pending)return;
    pending=true;
    try { await fn(...args); }
    catch (error) { err.textContent=error instanceof Error?error.message:String(error); }
    finally { pending=false; }
  };
}
function bindAction(selector: string,fn: (button: HTMLElement) => unknown){document.querySelectorAll<HTMLElement>(selector).forEach(button=>{const action=adminAction<[Event]>(()=>fn(button));button.addEventListener('click',event=>{void action(event)})})}
function bindPagedChoices<Item extends { id: string; status: string }>(dialog: HTMLDialogElement,{endpoint,initialCursor,prefix,select,label,emptyLabel}: PagedChoices<Item>) {
  const search=requireElement<HTMLButtonElement>(dialog,'[data-'+prefix+'-search]');
  const next=requireElement<HTMLButtonElement>(dialog,'[data-'+prefix+'-next]');
  const query=requireElement<HTMLInputElement>(dialog,'[data-'+prefix+'-query]');
  const status=requireElement<HTMLElement>(dialog,'[data-'+prefix+'-error]');
  const controller=new AbortController();
  dialog.addEventListener('close',()=>controller.abort(),{once:true});
  let cursor=initialCursor||null,currentQuery='',loading=false;
  next.disabled=!cursor;

  const isOpen=()=>dialog.open;
  const load=async (reset: boolean)=>{
    if(loading||!isOpen()||dialog.dataset.busy==='true')return;
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
      const page=await request(endpoint+'?'+parameters.toString(),{signal:controller.signal}) as Page<Item>;
      if(!isOpen())return;
      const accounts=page.items.filter(item=>item.status==='active');
      const options=accounts.map(item=>new Option(label(item),item.id));
      if(value&&!accounts.some(item=>item.id===value)&&selected)options.push(selected.cloneNode(true) as HTMLOptionElement);
      select.replaceChildren(new Option(adminMessage("selectAnOption"),''),...options);
      select.value=value;
      cursor=page.nextCursor||null;
      currentQuery=requestedQuery;
      if(!accounts.length)status.textContent=emptyLabel;
    } catch(error) {
      if(isOpen())status.textContent=error instanceof Error?error.message:String(error);
    } finally {
      loading=false;
      if(isOpen()){search.disabled=false;next.disabled=!cursor;}
    }
  };
  search.onclick=()=>{void load(true);};
  next.onclick=()=>{void load(false);};
  query.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void load(true);}};
  return ()=>loading;
}
let managerWatch: AbortController | undefined;
function stopManagerWatch(){managerWatch?.abort();managerWatch=undefined}
function beginManagerWatch(){stopManagerWatch();managerWatch=new AbortController();return managerWatch.signal}
function waitForManagerPoll(milliseconds: number,signal: AbortSignal) {
  return new Promise<void>(resolve=>{
    if(signal.aborted){resolve();return}
    const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve()};
    const timer=setTimeout(done,milliseconds);
    signal.addEventListener('abort',done,{once:true});
  });
}
async function watchManagerOperation<Operation extends { id: string }>(operation: Operation,{signal,endpoint,target,pending,render,finish,reconnectMessage,maxFailures}: ManagerWatch<Operation>) {
  let failures=0;
  const watching=()=>!signal.aborted&&target.isConnected;
  while(watching()){
    render(operation);
    if(!pending(operation)){await finish(operation);return}
    await waitForManagerPoll(1500,signal);
    if(!watching())return;
    try {
      const next=await request(endpoint+encodeURIComponent(operation.id),{signal}) as Operation | null;
      if(next?.id!==operation.id)throw new Error(adminMessage("theServerReturnedAnInvalidResponse"));
      operation=next;
      failures=0;
    } catch {
      if(!watching())return;
      render(operation,true);
      if(++failures>=maxFailures){err.textContent=reconnectMessage;return}
      await waitForManagerPoll(1000,signal);
    }
  }
}
function jsonBody(value: unknown){return{headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}}
function closeAdminDialog(dialog=activeDialog){if(!dialog)return;clearIssuedCredential(dialog);if(activeDialog===dialog)activeDialog=null;if(dialog.open)dialog.close();else dialog.remove()}
function openAdminDialog(title: string,body: string,{description='',wide=false}={}){closeAdminDialog();const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null,d=document.createElement('dialog'),heading='dialog-title-'+crypto.randomUUID(),markup='<div class="dialog-heading"><h2 id="'+heading+'">'+esc(title)+("</h2><button type=\"button\" class=\"ghost dialog-close\" aria-label=\""+esc(adminMessage("close"))+"\">×</button></div>")+(description?'<p class="dialog-description">'+esc(description)+'</p>':'')+body,parsed=new DOMParser().parseFromString(markup,'text/html');d.className='admin-dialog'+(wide?' wide':'');d.setAttribute('aria-labelledby',heading);d.replaceChildren(...parsed.body.childNodes);requireElement<HTMLButtonElement>(d,'.dialog-close').onclick=()=>closeAdminDialog(d);d.addEventListener('cancel',e=>{if(d.dataset.busy==='true')e.preventDefault()});d.addEventListener('close',()=>{if(activeDialog===d)activeDialog=null;d.remove();if(trigger?.isConnected)trigger.focus()},{once:true});document.body.append(d);activeDialog=d;d.showModal();queueMicrotask(()=>{const target=d.querySelector('[autofocus],input:not([type="hidden"]),select,textarea,button');if(target instanceof HTMLElement)target.focus()});return d}
function formDialog<Result>({title,description='',fields,submitLabel=adminMessage("save"),danger=false,successMessage='',onSubmit,afterSuccess,wide=false,reload=true}: DialogOptions<Result>){const d=openAdminDialog(title,'<form class="dialog-form"><div class="form-grid dialog-fields">'+fields+("</div><p class=\"dialog-error\" role=\"alert\"></p><div class=\"dialog-actions\"><button type=\"button\" class=\"secondary\" data-dialog-cancel>"+esc(adminMessage("cancel"))+"</button><button type=\"submit\"")+(danger?' class="danger"':'')+'>'+esc(submitLabel)+'</button></div></form>',{description,wide}),form=requireElement<HTMLFormElement>(d,'form'),localError=requireElement<HTMLElement>(d,'.dialog-error');requireElement<HTMLButtonElement>(d,'[data-dialog-cancel]').onclick=()=>closeAdminDialog(d);form.onsubmit=async e=>{e.preventDefault();if(d.dataset.busy==='true')return;localError.textContent='';d.dataset.busy='true';for(const button of form.querySelectorAll('button'))button.disabled=true;try{const value=await onSubmit(new FormData(form),d);if(!d.open||activeDialog!==d)return;closeAdminDialog(d);if(reload)await refreshPage();if(successMessage)ok.textContent=successMessage;if(afterSuccess)afterSuccess(value)}catch(error){d.dataset.busy='false';localError.textContent=error instanceof Error?error.message:String(error);for(const button of form.querySelectorAll('button'))button.disabled=false}};return d}
function confirmDialog<Result>({title,description='',summary='',submitLabel=adminMessage("run"),danger=false,successMessage='',reason=false,onSubmit,afterSuccess,reload=true}: ConfirmOptions<Result>){return formDialog({title,description,fields:'<div class="wide dialog-summary">'+summary+'</div>'+(reason?("<label class=\"wide\">"+esc(adminMessage("reasonForThisActionSavedIn"))+"<textarea name=\"reason\" required minlength=\"1\" maxlength=\"500\" autofocus></textarea><small>"+esc(adminMessage("doNotEnterSecretsOrApi"))+"</small></label>"):''),submitLabel,danger,successMessage,onSubmit,afterSuccess,reload})}
const displayLabels: Readonly<Record<string, string>> = {user:adminMessage("user"),admin:adminMessage("administrator"),owner:adminMessage("owner"),active:adminMessage("enabled"),disabled:adminMessage("disabled"),password:adminMessage("password"),oidc:'OpenID Connect',cloudflare_access:'Cloudflare Access',success:adminMessage("succeeded"),failure:adminMessage("failed"),failed:adminMessage("failed"),requested:adminMessage("requested"),rejected:adminMessage("rejected"),normal:adminMessage("normalOperation"),'read-only':adminMessage("readOnly"),lockdown:adminMessage("emergencyLockdown"),running:adminMessage("running"),paused:adminMessage("paused"),draining:adminMessage("waitingForRunningJobsToFinish"),'cloudflare-access':'Cloudflare Access',generic:adminMessage("generalPurposeCli"),ci:'CI',mcp:'MCP',codex:'Codex','claude-code':'Claude Code'};function displayLabel<T extends string | number | boolean>(v: T): string | T {const key=String(v);return Object.hasOwn(displayLabels,key)?displayLabels[key]??v:v}
function linkageLabel(user: Pick<UserRow, 'credential' | 'identities'>){return [...new Set([...(user.credential?['password']:[]),...(user.identities??[]).map(x=>x.provider)])].map(displayLabel).join(', ')||adminMessage("notSet")}
function userDetails(user: UserRow){return{ID:user.id,[adminMessage("email")]:user.email??adminMessage("notSet"),[adminMessage("displayName")]:user.display_name,[adminMessage("role")]:user.role,[adminMessage("status")]:user.status,[adminMessage("authentication")]:linkageLabel(user),外部認証:user.identities??[],[adminMessage("loginName")]:user.credential?.login_name??'—',[adminMessage("lastSignIn")]:user.last_login_at??adminMessage("none")}}
function details(value: unknown,title=adminMessage("details")){const labels: Readonly<Record<string, string>> = {id:adminMessage("identifier"),display_name:adminMessage("displayName"),name:adminMessage("name"),email:adminMessage("email"),role:adminMessage("role"),status:adminMessage("status"),client_type:adminMessage("type"),owner_user_id:adminMessage("ownerId"),service_account_id:adminMessage("serviceAccountId"),prefix:adminMessage("keyPrefix"),sourceRef:adminMessage("inputFileReference"),expiresAt:adminMessage("expires"),expires_at:adminMessage("expires"),created_at:adminMessage("created"),last_used_at:adminMessage("lastUsed"),revoked_at:adminMessage("revoked"),entrypoint:adminMessage("targetFile"),action:adminMessage("actions"),result:adminMessage("result"),reason:adminMessage("reason")},entries=value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string | number | boolean]=>{const [key,item]=entry;return Boolean(labels[key]||/[^a-zA-Z0-9_]/.test(key))&&(typeof item==='string'||typeof item==='number'||typeof item==='boolean')}):[],summary=entries.length?'<dl class="details">'+entries.map(([key,item])=>'<dt>'+esc(labels[key]||key)+'</dt><dd>'+esc(displayLabel(item))+'</dd>').join('')+'</dl>':("<p>"+esc(adminMessage("openDetailedDataToSeeEvery"))+"</p>"),d=openAdminDialog(title,summary+("<details><summary>"+esc(adminMessage("detailedDataJson"))+"</summary><pre class=\"dialog-json\"></pre></details><div class=\"dialog-actions\"><button type=\"button\" data-detail-copy>"+esc(adminMessage("copyAllFields"))+"</button><button type=\"button\" data-dialog-close>"+esc(adminMessage("close"))+"</button></div>"),{wide:true}),raw=JSON.stringify(value,null,2);requireElement<HTMLPreElement>(d,'pre').textContent=raw;requireElement<HTMLButtonElement>(d,'[data-detail-copy]').onclick=()=>navigator.clipboard.writeText(raw).catch(()=>{err.textContent=adminMessage("copyFailedSelectTheTextIn")});requireElement<HTMLButtonElement>(d,'[data-dialog-close]').onclick=()=>closeAdminDialog(d);return d}
function clearIssuedCredential(dialog: HTMLDialogElement | null) {
  const value=dialog?.querySelector('[data-issued-credential]');
  if(value)value.textContent='';
}
function credentialDialog(value: string,title=adminMessage("apiKeyIssued")) {
  const d=openAdminDialog(title,("<div class=\"credential\"><code data-issued-credential></code></div><p class=\"dialog-error\" role=\"alert\"></p><div class=\"dialog-actions\"><button type=\"button\" id=\"copy-issued\">"+esc(adminMessage("copyAndClose"))+"</button><button type=\"button\" class=\"secondary\" id=\"dismiss-issued\">"+esc(adminMessage("dismissWithoutCopying"))+"</button></div>"),{description:adminMessage("thisValueIsShownOnlyOnce"),wide:true});
  const code=requireElement<HTMLElement>(d,'[data-issued-credential]'), localError=requireElement<HTMLElement>(d,'.dialog-error');
  code.textContent=value;
  d.addEventListener('cancel',()=>clearIssuedCredential(d));
  d.addEventListener('close',()=>clearIssuedCredential(d),{once:true});
  requireElement<HTMLButtonElement>(d,'#copy-issued').onclick=async()=>{
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
  requireElement<HTMLButtonElement>(d,'#dismiss-issued').onclick=()=>closeAdminDialog(d);
}

  return { bindAction, bindPagedChoices, confirmDialog, details, displayLabel, esc, fmt, formDialog, jsonBody, linkageLabel, nextPage, section, table, userDetails, bytes, credentialDialog, adminAction, beginManagerWatch, stopManagerWatch, watchManagerOperation, closeAdminDialog };
}
