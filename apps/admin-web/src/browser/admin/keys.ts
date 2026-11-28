import type { ApiKeyRow, Page, ServiceAccountRow } from "./list-responses.js";
import type { AdminView } from "./view.js";
import { formText, requireElement } from "./view.js";

interface IssuedCredential {
  apiKey: string;
}

type Scope = readonly [value: string, label: string, selected?: boolean];

export function createKeys({
  adminMessage, bindAction, bindPagedChoices, confirmDialog, credentialDialog, details, err, esc, fmt, formDialog, jsonBody, me, nextPage, out, request, section, table
}: AdminView) {
function showIssuedCredential(result: IssuedCredential) {
  credentialDialog(result.apiKey);
  keys().catch(()=>{err.textContent=adminMessage("apiKeyIssued")});
}
async function keys(){
  const params=new URLSearchParams(location.search),keyApi=new URLSearchParams();const cursor=params.get('cursor');if(cursor)keyApi.set('cursor',cursor);const[k,a]=await Promise.all([request('/api-keys'+(keyApi.size?'?'+keyApi.toString():'')) as Promise<Page<ApiKeyRow>>,request('/service-accounts') as Promise<Page<ServiceAccountRow>>]);
  const renderScopes: Scope[] = [
    ['render:create', adminMessage("createJob"), true],
    ['render:read:own', adminMessage("renewAShortLivedTokenFor"), true],
    ['render:project:read', adminMessage("readSavedRevisionFiles"), false],
    ['render:draft:read', adminMessage("readSharedDrafts"), false],
    ['render:draft:write', adminMessage("editSharedDrafts"), false],
    ['render:pdf:inspect', adminMessage("inspectOwnedPdfs"), false],
  ];
  const adminScopes: Scope[] =[['admin:users:read',adminMessage("viewUsers")],['admin:users:write',adminMessage("changeUsers")],['admin:service-accounts:read',adminMessage("viewServiceAccounts")],['admin:service-accounts:write',adminMessage("changeServiceAccounts")],['admin:api-keys:read',adminMessage("viewApiKeys")],['admin:api-keys:write',adminMessage("issueAndRevokeApiKeys")],['admin:jobs:read',adminMessage("viewJobs")],['admin:jobs:write',adminMessage("manageJobs")],['admin:system:read',adminMessage("viewSystemInformation")],['admin:system:write',adminMessage("changeSystemSettings")],['admin:update:read',adminMessage("viewApplicationUpdateStatus")],['admin:update:write',adminMessage("requestApplicationUpdatesOwnersOnly")],['admin:tex-environment:read',adminMessage("viewTexEnvironmentStatus")],['admin:tex-environment:write',adminMessage("requestTexEnvironmentOperationsRuntimeChanges")],['admin:audit:read',adminMessage("viewAuditLogs")],['admin:*',adminMessage("allAdministrativeOperationsEmergencyUse")]];
  const scopeFields=(items: readonly Scope[],kind: 'render' | 'admin')=>'<fieldset class="wide" data-key-kind="'+kind+'"><legend>'+ (kind==='render'?adminMessage("rendering"):adminMessage("administration")) +(esc(adminMessage("scopes"))+"</legend>")+items.map(([value,label,selected])=>'<label class="check"><input type="checkbox" name="scope" value="'+value+'"'+(selected?' checked':'')+'> <span>'+esc(label)+'</span></label>').join('')+("<details><summary>"+esc(adminMessage("permissionIdentifier"))+"</summary><dl class=\"details\">")+items.map(([value,label])=>'<dt>'+esc(label)+'</dt><dd><code>'+esc(value)+'</code></dd>').join('')+'</dl></details></fieldset>';
  const requestedAccount=params.get('account');
  if(requestedAccount&&!a.items.some(x=>x.id===requestedAccount))a.items.push(await request('/service-accounts/'+encodeURIComponent(requestedAccount)) as ServiceAccountRow);
  if(requestedAccount&&!a.items.some(x=>x.id===requestedAccount&&x.status==='active'))throw new Error(adminMessage("theSpecifiedServiceAccountIsDisabled"));
  const accountOptions=a.items.filter(x=>x.status==='active').map(x=>'<option value="'+esc(x.id)+'"'+(x.id===requestedAccount?' selected':'')+'>'+esc(x.name)+'</option>').join('');
  out.innerHTML=section(adminMessage("apiKeys"),("<div class=\"actions\"><button id=\"key-create\">"+esc(adminMessage("issueApiKey"))+"</button></div>")+table(k.items,[[adminMessage("keyPrefix"),'prefix'],[adminMessage("name"),'name'],[adminMessage("serviceAccount"),x=>a.items.find(account=>account.id===x.service_account_id)?.name||adminMessage("seeDetails")],[adminMessage("lastUsed"),x=>fmt(x.last_used_at)],[adminMessage("revoke"),x=>fmt(x.revoked_at)]],x=>'<button class="secondary" data-k-detail="'+esc(x.id)+("\">"+esc(adminMessage("details"))+"</button>")+(x.revoked_at?'':'<button class="secondary" data-k-rotate="'+esc(x.id)+("\">"+esc(adminMessage("rotate"))+"</button><button class=\"danger\" data-k-revoke=\"")+esc(x.id)+("\">"+esc(adminMessage("revoke"))+"</button>")))+nextPage(k.nextCursor));
  requireElement<HTMLButtonElement>(document,'#key-create').onclick=()=>{
    const kindField='<label>'+esc(adminMessage("keyType"))+'<select name="kind" id="dialog-key-kind"><option value="render">'+esc(adminMessage("renderingKey"))+'</option>'+
      (me.role==='owner'?'<option value="admin">'+esc(adminMessage("adminKeyOwnersOnly"))+'</option>':'')+'</select></label>';
    const accountPicker='<div class="wide"><label>'+esc(adminMessage("search"))+'<input data-account-query maxlength="200" autocomplete="off"></label><div class="actions">'+
      '<button type="button" class="secondary" data-account-search>'+esc(adminMessage("search"))+'</button>'+
      '<button type="button" class="secondary" data-account-next>'+esc(adminMessage("nextPage"))+'</button></div>'+
      '<p data-account-error role="status"></p></div>'+
      '<label>'+esc(adminMessage("serviceAccount"))+'<select name="account" required autofocus>'+accountOptions+'</select></label>';
    const dialog=formDialog({
      title:adminMessage("issueApiKey"),
      description:adminMessage("theNewKeyAppearsOnlyOnce"),
      fields:accountPicker+'<label>'+esc(adminMessage("name"))+'<input name="name" required maxlength="100"></label>'+
        kindField+scopeFields(renderScopes,'render')+(me.role==='owner'?scopeFields(adminScopes,'admin'):'')+
        '<label>'+esc(adminMessage("expires"))+'<input name="expiresAt" type="datetime-local"></label>',
      submitLabel:adminMessage("issue"),
      successMessage:adminMessage("apiKeyIssued"),
      wide:true,
      reload:false,
      afterSuccess:showIssuedCredential,
      onSubmit:async f=>{
        if(isLoading())throw new Error(adminMessage("processing"));
        const scopes=f.getAll('scope').map(String),expires=formText(f,'expiresAt','');
        if(!scopes.length)throw new Error(adminMessage("selectAtLeastOneScope"));
        return request('/service-accounts/'+encodeURIComponent(formText(f,'account'))+ '/api-keys',{
          method:'POST',...jsonBody({name:f.get('name'),scopes,expiresAt:expires?new Date(expires).toISOString():null})
        }) as Promise<IssuedCredential>;
      }
    });
    const isLoading=bindPagedChoices<ServiceAccountRow>(dialog,{
      endpoint:'/service-accounts',initialCursor:a.nextCursor,prefix:'account',
      select:requireElement<HTMLSelectElement>(dialog,'[name="account"]'),
      label:account=>account.name,emptyLabel:adminMessage("noData")
    });
    const kind=requireElement<HTMLSelectElement>(dialog,'#dialog-key-kind');
    const syncKind=()=>{
      for(const field of dialog.querySelectorAll<HTMLFieldSetElement>('[data-key-kind]')){
        const active=field.dataset.keyKind===kind.value;
        field.hidden=!active;
        for(const input of field.querySelectorAll('input'))input.disabled=!active;
      }
    };
    kind.onchange=syncKind;
    syncKind();
  };
  bindAction('[data-k-rotate]',b=>confirmDialog({title:adminMessage("rotateApiKey"),description:b.dataset.kRotate,summary:("<div class=\"notice warning\">"+esc(adminMessage("theOldKeyWillBeRevoked"))+"</div>"),submitLabel:adminMessage("rotate"),danger:true,successMessage:adminMessage("apiKeyRotated"),reload:false,afterSuccess:showIssuedCredential,onSubmit:async()=>{const v=await request('/api-keys/'+String(b.dataset.kRotate)+'/rotate',{method:'POST',...jsonBody({})}) as IssuedCredential;return v}}));
  bindAction('[data-k-revoke]',b=>confirmDialog({title:adminMessage("revokeApiKey"),description:b.dataset.kRevoke,summary:("<div class=\"notice warning\">"+esc(adminMessage("thisApiKeyWillBeRevoked"))+"</div>"),submitLabel:adminMessage("revoke"),danger:true,successMessage:adminMessage("apiKeyRevoked"),onSubmit:()=>request('/api-keys/'+String(b.dataset.kRevoke)+'/revoke',{method:'POST',...jsonBody({})})}));
  bindAction('[data-k-detail]',b=>details(k.items.find(item=>item.id===b.dataset.kDetail),adminMessage("apiKeyDetails")));
}

  return { keys };
}
