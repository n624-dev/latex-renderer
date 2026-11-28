import { createBackups } from "./backups.js";

export function createSystem(view) {
  const {
    adminMessage,
    bindAction,
    confirmDialog,
    details,
    displayLabel,
    err,
    esc,
    fmt,
    formDialog,
    jsonBody,
    me,
    ok,
    out,
    request,
    section,
    table,
  } = view;
  const { backups } = createBackups(view);
async function system(){
  const [s, c, keys] = await Promise.all([
    request("/system/status"),
    request("/system/config"),
    request("/system/ticket-keys"),
  ]);
  const settingLabels = {
    max_queue_length: adminMessage("maximumQueueLength"),
    max_user_active_jobs: adminMessage("concurrentConversionLimitPerUser"),
    max_user_storage_bytes: adminMessage("storageQuotaPerUser"),
    source_orphan_retention_minutes: adminMessage("retentionForUnusedInputFiles"),
  };
  const sourceLabels = {
    database: adminMessage("adminOverride"),
    host: adminMessage("hostSetting"),
    default: adminMessage("builtInDefault"),
  };
  const configs = (c.effective ?? []).map((entry) => {
    const { key, value, fallback, minimum, maximum } = entry;
    const isBytes = entry.unit === "bytes";
    const mib = 1024 ** 2;
    const scale =
      isBytes && [value, fallback, minimum, maximum].every((n) => n % mib === 0)
        ? mib
        : 1;
    let unit = "";
    if (isBytes) unit = scale === mib ? "MiB" : "B";
    if (entry.unit === "minutes") unit = adminMessage("min");
    const format = (n) => (unit ? n / scale + " " + unit : String(n / scale));
    return {
      ...entry,
      label: settingLabels[key] ?? key,
      value: value / scale,
      min: minimum / scale,
      max: maximum / scale,
      scale,
      unit,
      display: format(value),
      fallbackDisplay: format(fallback),
    };
  });
  const settingsTable = table(
    configs,
    [
      [adminMessage("settings"), "label"],
      [adminMessage("effectiveValue"), "display"],
      [
        adminMessage("configurationSource"),
        (config) => sourceLabels[config.source],
      ],
      [adminMessage("hostDefault"), "fallbackDisplay"],
    ],
    (config) => `
        <button class="secondary" data-config="${esc(config.key)}">${esc(adminMessage("edit"))}</button>
        ${config.source === "database" ? `<button class="secondary" data-config-reset="${esc(config.key)}">${esc(adminMessage("returnToHostDefault"))}</button>` : ""}
      `,
  );
  const keySummary=keys.verificationKids.length?("<button id=\"ticket-revoke\" class=\"danger\">"+esc(adminMessage("revokeOldSigningKey"))+"</button>"):("<p class=\"muted\">"+esc(adminMessage("noVerificationKeysAreAvailableTo"))+"</p>");
  out.innerHTML=section(adminMessage("status"),("<dl class=\"details\"><dt>"+esc(adminMessage("maintenance"))+"</dt><dd>")+esc(displayLabel(s.maintenance))+("</dd><dt>"+esc(adminMessage("worker"))+"</dt><dd>")+esc(({idle:adminMessage("standbyStartsOnRequest"),starting:adminMessage("starting"),unavailable:adminMessage("unavailable")}[s.rendering?.state]||displayLabel(s.worker)))+("</dd><dt>"+esc(adminMessage("writes"))+"</dt><dd>")+(s.writeEnabled?adminMessage("enabled"):adminMessage("paused"))+("</dd></dl><details><summary>"+esc(adminMessage("detailedDataJson"))+"</summary><pre id=\"system-json\"></pre></details>"))+(s.httpServices?.managed?section(adminMessage("httpServices"),table(s.httpServices.services,[[adminMessage("service"),x=>({'latex-renderer-web.service':'Web','latex-renderer-admin-web.service':'Web','latex-renderer-api.service':adminMessage("rendererApi"),'latex-renderer-internal-api.service':adminMessage("internalApi"),'latex-renderer-admin-api.service':adminMessage("adminApi"),'latex-renderer-remote-mcp.service':adminMessage("aiIntegrations")}[x.service]||x.service)],[adminMessage("status"),x=>({running:adminMessage("running"),idle:adminMessage("standbyStartsOnRequest"),starting:adminMessage("starting"),unavailable:adminMessage("unavailable")}[x.state]||adminMessage("couldNotVerify"))]])):'' )+section(adminMessage("settings"),settingsTable)+section(adminMessage("maintenance"),("<p><strong>"+esc(adminMessage("readOnly2"))+"</strong> "+esc(adminMessage("stopNewWorkAndAllowReads"))+" <strong>"+esc(adminMessage("emergencyLockdown2"))+"</strong> "+esc(adminMessage("stopAllUse"))+" <strong>"+esc(adminMessage("clear"))+"</strong> "+esc(adminMessage("returnToNormalOperation"))+"</p><div class=\"actions\"><button data-maint=\"read-only\">"+esc(adminMessage("readOnly"))+"</button><button data-maint=\"lockdown\" class=\"danger\">"+esc(adminMessage("emergencyLockdown"))+"</button><button data-maint=\"normal\" class=\"secondary\">"+esc(adminMessage("clear2"))+"</button></div>"))+section(adminMessage("worker"),("<p class=\"muted\">"+esc(adminMessage("pauseStopsTheWorkerFromTaking"))+"</p><div class=\"actions\"><button data-worker=\"pause\">"+esc(adminMessage("pause"))+"</button><button data-worker=\"drain\">"+esc(adminMessage("drain"))+"</button><button data-worker=\"resume\">"+esc(adminMessage("resume"))+"</button></div>"))+(me.role==='owner'?section(adminMessage("advancedActions"),("<details><summary>"+esc(adminMessage("signingKeyRevocation"))+"</summary><div class=\"notice warning\"><strong>")+esc(adminMessage("cannotRevokeActiveKey",{keyId:keys.activeKid}))+("</strong> "+esc(adminMessage("switchToANewKeyAnd"))+"</div><div class=\"actions\">")+keySummary+'</div></details>'):'');
  document.querySelector('#system-json').textContent=JSON.stringify(s,null,2);
  if (me.role === "owner") await backups();
  bindAction("[data-config]", (button) => {
    const config = configs.find((entry) => entry.key === button.dataset.config);
    formDialog({
      title: adminMessage("editSetting", { setting: config.label }),
      description: adminMessage("currentValue2") + " " + config.display,
      fields: `<label>${esc(adminMessage("newValue"))}${config.unit ? " (" + esc(config.unit) + ")" : ""}
          <input name="value" type="number" min="${esc(config.min)}" max="${esc(config.max)}" value="${esc(config.value)}" required autofocus>
          <small>${esc(adminMessage("ownerRequiredToIncreaseLimit", { min: config.min, max: config.max, unit: config.unit }))}</small>
        </label>
        <label class="wide">${esc(adminMessage("reasonForChange"))}<input name="reason" required maxlength="500"></label>`,
      submitLabel: adminMessage("saveSettings"),
      successMessage: adminMessage("settingsUpdated"),
      onSubmit: (form) =>
        request("/system/config", {
          method: "PATCH",
          ...jsonBody({
            key: config.key,
            value: Number(form.get("value")) * config.scale,
            reason: form.get("reason"),
          }),
        }),
    });
  });
  bindAction("[data-config-reset]", (button) => {
    const config = configs.find(
      (entry) => entry.key === button.dataset.configReset,
    );
    const title = adminMessage("returnToHostDefault");
    confirmDialog({
      title,
      description: config.label,
      summary: `<dl class="details">
          <dt>${esc(adminMessage("effectiveValue"))}</dt><dd>${esc(config.display)}</dd>
          <dt>${esc(adminMessage("hostDefault"))}</dt><dd>${esc(config.fallbackDisplay)}</dd>
        </dl>`,
      reason: true,
      submitLabel: title,
      successMessage: adminMessage("settingReset"),
      onSubmit: (form) =>
        request("/system/config/reset", {
          method: "POST",
          ...jsonBody({
            key: config.key,
            reason: String(form.get("reason")).trim(),
          }),
        }),
    });
  });
  bindAction('[data-maint]',b=>{const mode=b.dataset.maint;if(mode==='normal'){confirmDialog({title:adminMessage("returnToNormalOperation2"),summary:("<p>"+esc(adminMessage("exitMaintenanceModeAndResumeAccepting"))+"</p>"),submitLabel:adminMessage("returnToNormalOperation2"),successMessage:adminMessage("maintenanceModeChanged"),onSubmit:()=>request('/system/maintenance/disable',{method:'POST',...jsonBody({})})});return}const lockdown=mode==='lockdown';formDialog({title:lockdown?adminMessage("startEmergencyLockdown"):adminMessage("enableReadOnlyMode"),description:lockdown?adminMessage("stopAllUse"):adminMessage("stopNewWorkAndAllowReads"),fields:'<div class="wide notice warning">'+(lockdown?("<strong>"+esc(adminMessage("thisAffectsAllAccessIncludingThe"))+"</strong>"):adminMessage("newRenderingRequestsWillNoLonger"))+("</div><label class=\"wide\">"+esc(adminMessage("reasonForStarting"))+"<input name=\"reason\" required maxlength=\"500\" autofocus></label>"),submitLabel:lockdown?adminMessage("emergencyLockdown"):adminMessage("enableReadOnlyMode"),danger:lockdown,successMessage:adminMessage("maintenanceModeChanged"),onSubmit:f=>request('/system/maintenance/enable',{method:'POST',...jsonBody({mode,reason:f.get('reason')})})})});
  bindAction('[data-worker]',b=>{const labels={pause:adminMessage("pause"),drain:adminMessage("drain"),resume:adminMessage("resume")},label=labels[b.dataset.worker];confirmDialog({title:adminMessage("workerAction",{action:label}),summary:'<p>'+esc(adminMessage("confirmWorkerState",{state:label}))+'</p>',submitLabel:label,danger:b.dataset.worker==='pause',successMessage:adminMessage("workerStateChanged"),onSubmit:()=>request('/worker/'+b.dataset.worker,{method:'POST',...jsonBody({})})})});
  const ticketButton=document.querySelector('#ticket-revoke');if(ticketButton)ticketButton.onclick=()=>{const expiryDate=new Date(Date.now()+86400000),defaultExpiry=new Date(expiryDate.getTime()-expiryDate.getTimezoneOffset()*60000).toISOString().slice(0,16),options=keys.verificationKids.map(k=>'<option value="'+esc(k)+'">'+esc(k)+'</option>').join('');formDialog({title:adminMessage("revokeOldSigningKey"),description:adminMessage("activeKeyCannotBeSelected",{keyId:keys.activeKid}),fields:("<div class=\"wide notice warning\"><strong>"+esc(adminMessage("thisOperationAffectsExistingTokens"))+"</strong> "+esc(adminMessage("keepTheRevocationRecordForAt"))+"</div><label>"+esc(adminMessage("oldKeyId"))+"<select name=\"kid\" autofocus>")+options+("</select></label><label>"+esc(adminMessage("revocationRecordExpiry"))+"<input name=\"expiresAt\" type=\"datetime-local\" value=\"")+defaultExpiry+("\" required></label><label class=\"wide\">"+esc(adminMessage("reason"))+"<input name=\"reason\" required maxlength=\"500\"></label>"),submitLabel:adminMessage("revokeOldSigningKey"),danger:true,successMessage:adminMessage("signingKeyRevoked"),onSubmit:f=>request('/system/ticket-keys/'+encodeURIComponent(String(f.get('kid')))+'/revoke',{method:'POST',...jsonBody({reason:f.get('reason'),expiresAt:new Date(String(f.get('expiresAt'))).toISOString()})})})}
}

async function audit(){
  out.innerHTML=section(adminMessage("filters"),("<form id=\"audit-filter\" class=\"form-grid\"><label>"+esc(adminMessage("actions"))+"<input name=\"action\" placeholder=\"render.\"></label><label>"+esc(adminMessage("actor"))+"<input name=\"actor\" placeholder=\"user / ID\"></label><label>"+esc(adminMessage("target"))+"<input name=\"target\" placeholder=\"job / ID\"></label><label>"+esc(adminMessage("result"))+"<select name=\"result\"><option value=\"\">"+esc(adminMessage("all"))+"</option><option value=\"success\">"+esc(adminMessage("succeeded"))+"</option><option value=\"failure\">"+esc(adminMessage("failed"))+"</option><option value=\"requested\">"+esc(adminMessage("requested"))+"</option><option value=\"failed\">"+esc(adminMessage("operationFailed"))+"</option><option value=\"rejected\">"+esc(adminMessage("rejected"))+"</option></select></label><label>"+esc(adminMessage("startDateAndTime"))+"<input name=\"from\" type=\"datetime-local\"></label><label>"+esc(adminMessage("endDateAndTime"))+"<input name=\"to\" type=\"datetime-local\"></label><button>"+esc(adminMessage("search"))+"</button><button type=\"reset\" class=\"secondary\">"+esc(adminMessage("clear2"))+"</button></form>"))+section(adminMessage("auditLog"),'<div id="audit-table"></div>');
  const form=document.querySelector('#audit-filter');let page=1;
  const render=async()=>{const f=new FormData(form),q=new URLSearchParams({page:String(page),pageSize:'50'});for(const key of['action','actor','target','result']){const value=String(f.get(key)||'').trim();if(value)q.set(key,value)}for(const key of['from','to']){const value=f.get(key);if(value)q.set(key,new Date(String(value)).toISOString())}const d=await request('/audit-logs?'+q),items=d.items,first=d.total===0?0:(d.page-1)*d.pageSize+1,last=Math.min(d.page*d.pageSize,d.total);document.querySelector('#audit-table').innerHTML='<p class="muted">'+esc(adminMessage("auditPageRange",{first,last,total:d.total}))+'</p>'+table(items,[[adminMessage("date"),x=>fmt(x.created_at)],[adminMessage("actor"),x=>({user:adminMessage("user"),api_key:adminMessage("apiKeys"),service_account:adminMessage("serviceAccounts"),system:adminMessage("system")}[x.actor_type]||x.actor_type)],[adminMessage("actions"),'action'],[adminMessage("target"),x=>({user:adminMessage("user"),job:adminMessage("jobs"),source:adminMessage("inputFiles"),service_account:adminMessage("serviceAccounts"),api_key:adminMessage("apiKeys"),system:adminMessage("system")}[x.target_type]||x.target_type)],[adminMessage("result"),x=>displayLabel(x.result)]],x=>'<button class="secondary" data-log="'+esc(x.id)+("\">"+esc(adminMessage("details"))+"</button><button class=\"secondary\" data-copy-log=\"")+esc(x.target_id)+("\">"+esc(adminMessage("copyId"))+"</button>"))+'<div class="actions"><button id="audit-prev" class="secondary"'+(d.page<=1?' disabled':'')+('>'+esc(adminMessage("previousPageLink"))+'</button><span>')+d.page+' / '+Math.max(d.totalPages,1)+(""+esc(adminMessage("page"))+"</span><button id=\"audit-next\" class=\"secondary\"")+(d.page>=d.totalPages?' disabled':'')+('>'+esc(adminMessage("nextPageLink"))+'</button></div>');bindAction('[data-log]',b=>details(items.find(x=>x.id===b.dataset.log),adminMessage("auditLogDetails")));document.querySelectorAll('[data-copy-log]').forEach(b=>b.addEventListener('click',async()=>{await navigator.clipboard.writeText(b.dataset.copyLog);ok.textContent=adminMessage("targetIdCopied")}));document.querySelector('#audit-prev').onclick=()=>{page--;render().catch(e=>{err.textContent=e.message})};document.querySelector('#audit-next').onclick=()=>{page++;render().catch(e=>{err.textContent=e.message})}};
  form.onsubmit=e=>{e.preventDefault();page=1;render().catch(e=>{err.textContent=e instanceof Error?e.message:String(e)})};form.onreset=()=>setTimeout(()=>{page=1;render().catch(e=>{err.textContent=e instanceof Error?e.message:String(e)})});await render()
}


  return { system, audit };
}
