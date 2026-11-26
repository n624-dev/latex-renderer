export const part3 = String.raw`
function showIssuedCredential(result) {
  credentialDialog(result.apiKey);
  keys().catch(()=>{err.textContent=adminMessage("apiKeyIssued")});
}
async function keys(){
  const params=new URLSearchParams(location.search),keyApi=new URLSearchParams();if(params.get('cursor'))keyApi.set('cursor',params.get('cursor'));const[k,a]=await Promise.all([request('/api-keys'+(keyApi.size?'?'+keyApi:'')),request('/service-accounts')]);
  const renderScopes=[['render:create',adminMessage("createJob")],['render:read:own',adminMessage("renewAShortLivedTokenFor")]];
  const adminScopes=[['admin:users:read',adminMessage("viewUsers")],['admin:users:write',adminMessage("changeUsers")],['admin:service-accounts:read',adminMessage("viewServiceAccounts")],['admin:service-accounts:write',adminMessage("changeServiceAccounts")],['admin:api-keys:read',adminMessage("viewApiKeys")],['admin:api-keys:write',adminMessage("issueAndRevokeApiKeys")],['admin:jobs:read',adminMessage("viewJobs")],['admin:jobs:write',adminMessage("manageJobs")],['admin:system:read',adminMessage("viewSystemInformation")],['admin:system:write',adminMessage("changeSystemSettings")],['admin:update:read',adminMessage("viewApplicationUpdateStatus")],['admin:update:write',adminMessage("requestApplicationUpdatesOwnersOnly")],['admin:tex-environment:read',adminMessage("viewTexEnvironmentStatus")],['admin:tex-environment:write',adminMessage("requestTexEnvironmentOperationsRuntimeChanges")],['admin:audit:read',adminMessage("viewAuditLogs")],['admin:*',adminMessage("allAdministrativeOperationsEmergencyUse")]];
  const scopeFields=(items,kind)=>'<fieldset class="wide" data-key-kind="'+kind+'"><legend>'+ (kind==='render'?adminMessage("rendering"):adminMessage("administration")) +(""+esc(adminMessage("scopes"))+"</legend>")+items.map(([value,label])=>'<label class="check"><input type="checkbox" name="scope" value="'+value+'"'+(kind==='render'?' checked':'')+'> <span>'+esc(label)+'</span></label>').join('')+("<details><summary>"+esc(adminMessage("permissionIdentifier"))+"</summary><dl class=\"details\">")+items.map(([value,label])=>'<dt>'+esc(label)+'</dt><dd><code>'+esc(value)+'</code></dd>').join('')+'</dl></details></fieldset>';
  const requestedAccount=params.get('account');
  if(requestedAccount&&!a.items.some(x=>x.id===requestedAccount))a.items.push(await request('/service-accounts/'+encodeURIComponent(requestedAccount)));
  if(requestedAccount&&!a.items.some(x=>x.id===requestedAccount&&x.status==='active'))throw new Error(adminMessage("theSpecifiedServiceAccountIsDisabled"));
  const accountOptions=a.items.filter(x=>x.status==='active').map(x=>'<option value="'+esc(x.id)+'"'+(x.id===requestedAccount?' selected':'')+'>'+esc(x.name)+'</option>').join('');
  out.innerHTML=section(adminMessage("apiKeys"),("<div class=\"actions\"><button id=\"key-create\">"+esc(adminMessage("issueApiKey"))+"</button></div>")+table(k.items,[[adminMessage("keyPrefix"),'prefix'],[adminMessage("name"),'name'],[adminMessage("serviceAccount"),x=>a.items.find(account=>account.id===x.service_account_id)?.name||adminMessage("seeDetails")],[adminMessage("lastUsed"),x=>fmt(x.last_used_at)],[adminMessage("revoke"),x=>fmt(x.revoked_at)]],x=>'<button class="secondary" data-k-detail="'+esc(x.id)+("\">"+esc(adminMessage("details"))+"</button>")+(x.revoked_at?'':'<button class="secondary" data-k-rotate="'+esc(x.id)+("\">"+esc(adminMessage("rotate"))+"</button><button class=\"danger\" data-k-revoke=\"")+esc(x.id)+("\">"+esc(adminMessage("revoke"))+"</button>")))+nextPage(k.nextCursor));
  document.querySelector('#key-create').onclick=()=>{
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
        const scopes=f.getAll('scope').map(String),expires=f.get('expiresAt');
        if(!scopes.length)throw new Error(adminMessage("selectAtLeastOneScope"));
        return request('/service-accounts/'+encodeURIComponent(String(f.get('account')))+ '/api-keys',{
          method:'POST',...jsonBody({name:f.get('name'),scopes,expiresAt:expires?new Date(String(expires)).toISOString():null})
        });
      }
    });
    const isLoading=bindPagedChoices(dialog,{
      endpoint:'/service-accounts',initialCursor:a.nextCursor,prefix:'account',
      select:dialog.querySelector('[name="account"]'),
      label:account=>account.name,emptyLabel:adminMessage("noData")
    });
    const kind=dialog.querySelector('#dialog-key-kind');
    const syncKind=()=>{
      for(const field of dialog.querySelectorAll('[data-key-kind]')){
        const active=field.dataset.keyKind===kind.value;
        field.hidden=!active;
        for(const input of field.querySelectorAll('input'))input.disabled=!active;
      }
    };
    kind.onchange=syncKind;
    syncKind();
  };
  bindAction('[data-k-rotate]',b=>confirmDialog({title:adminMessage("rotateApiKey"),description:b.dataset.kRotate,summary:("<div class=\"notice warning\">"+esc(adminMessage("theOldKeyWillBeRevoked"))+"</div>"),submitLabel:adminMessage("rotate"),danger:true,successMessage:adminMessage("apiKeyRotated"),reload:false,afterSuccess:showIssuedCredential,onSubmit:async()=>{const v=await request('/api-keys/'+b.dataset.kRotate+'/rotate',{method:'POST',...jsonBody({})});return v}}));
  bindAction('[data-k-revoke]',b=>confirmDialog({title:adminMessage("revokeApiKey"),description:b.dataset.kRevoke,summary:("<div class=\"notice warning\">"+esc(adminMessage("thisApiKeyWillBeRevoked"))+"</div>"),submitLabel:adminMessage("revoke"),danger:true,successMessage:adminMessage("apiKeyRevoked"),onSubmit:()=>request('/api-keys/'+b.dataset.kRevoke+'/revoke',{method:'POST',...jsonBody({})})}));
  bindAction('[data-k-detail]',b=>details(k.items.find(item=>item.id===b.dataset.kDetail),adminMessage("apiKeyDetails")));
}

async function jobsLegacy(){
  const d=await request('/jobs'),active=new Set(['reserved','uploading','queued','validating','running']),retryable=new Set(['succeeded','failed','timeout','canceled','rejected']),deletable=new Set(['succeeded','failed','timeout','canceled','rejected','expired']),requestedJob=new URLSearchParams(location.search).get('job');
  out.innerHTML=section(adminMessage("jobs"),("<div class=\"actions\"><a class=\"button\" href=\"/admin/render/\">"+esc(adminMessage("createAJobInTheBrowser"))+"</a><button id=\"bulk-delete\" class=\"danger\">"+esc(adminMessage("deleteSelectedJobs"))+"</button><span id=\"selected-count\">"+esc(adminMessage("selected0"))+"</span></div>")+table(d.items,[['ID','id'],[adminMessage("user"),'user_id'],[adminMessage("status"),'status'],[adminMessage("input"),x=>bytes(x.source_size)],[adminMessage("created"),x=>fmt(x.created_at)]],x=>'<button class="secondary" data-j-detail="'+esc(x.id)+("\">"+esc(adminMessage("details"))+"</button>")+(active.has(x.status)?'<button class="secondary" data-j-cancel="'+esc(x.id)+("\">"+esc(adminMessage("canceled"))+"</button>"):'')+(retryable.has(x.status)?'<button class="secondary" data-j-retry="'+esc(x.id)+("\">"+esc(adminMessage("runAgain"))+"</button>"):'')+(deletable.has(x.status)?'<button class="danger" data-j-delete="'+esc(x.id)+("\">"+esc(adminMessage("delete"))+"</button>"):''),true));
  for(const box of document.querySelectorAll('[data-select]')){const job=d.items.find(x=>x.id===box.dataset.select);box.disabled=!deletable.has(job.status);box.addEventListener('change',()=>{document.querySelector('#selected-count').textContent=adminMessage("selectedCount",{count:document.querySelectorAll('[data-select]:checked').length})})}
  bindAction('[data-j-detail]',async b=>details(await request('/jobs/'+b.dataset.jDetail),adminMessage("jobDetails")));
  bindAction('[data-j-cancel]',b=>confirmDialog({title:adminMessage("cancelJob"),description:b.dataset.jCancel,summary:("<p>"+esc(adminMessage("ifTheJobIsRunningA"))+"</p>"),submitLabel:adminMessage("requestCancellation"),danger:true,successMessage:adminMessage("cancellationRequested"),onSubmit:()=>request('/jobs/'+b.dataset.jCancel+'/cancel',{method:'POST',...jsonBody({})})}));
  bindAction('[data-j-retry]',b=>confirmDialog({title:adminMessage("retryJob"),description:b.dataset.jRetry,summary:("<p>"+esc(adminMessage("aNewJobWillBeCreated"))+"</p>"),submitLabel:adminMessage("runAgain"),successMessage:adminMessage("newJobCreatedForTheRetry"),onSubmit:()=>request('/jobs/'+b.dataset.jRetry+'/retry',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:'{}'})}));
  bindAction('[data-j-delete]',b=>confirmDialog({title:adminMessage("deleteJob"),description:b.dataset.jDelete,summary:("<div class=\"notice warning\">"+esc(adminMessage("theInputPdfLogsAndPreviews"))+"</div>"),submitLabel:adminMessage("delete"),danger:true,successMessage:adminMessage("deletionRequested"),onSubmit:()=>request('/jobs/'+b.dataset.jDelete,{method:'DELETE'})}));
  document.querySelector('#bulk-delete').onclick=()=>{const ids=[...document.querySelectorAll('[data-select]:checked')].map(x=>x.dataset.select).slice(0,100);if(!ids.length){err.textContent=adminMessage("selectJobs");return}confirmDialog({title:adminMessage("bulkDeleteSelectedJobs"),description:adminMessage("markJobsForDeletion",{count:ids.length}),summary:("<div class=\"notice warning\"><strong>"+esc(adminMessage("theInputAndOutputFilesWill"))+"</strong></div><details><summary>"+esc(adminMessage("showTargetIds"))+"</summary><ul>")+ids.map(id=>'<li><code>'+esc(id)+'</code></li>').join('')+'</ul></details>',submitLabel:adminMessage("deleteSelectedJobs",{count:ids.length}),danger:true,successMessage:adminMessage("bulkDeletionRequested"),onSubmit:()=>request('/jobs/bulk-delete',{method:'POST',...jsonBody({ids})})})}
  if(requestedJob&&/^job_[a-f0-9]{32}$/.test(requestedJob))details(await request('/jobs/'+requestedJob),adminMessage("jobDetails"));
}
`;
