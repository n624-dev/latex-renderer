export const part7 = String.raw`
function updateVersion(value){return value?'v'+value:'—'}
let updateWatchGeneration=0;
// One bounded view state; no log text or credentials are retained here.
let updateLogView={id:null,open:false,scrollTop:0};
function rememberUpdateLogView(){
  const card=document.querySelector('#update-operation > article');
  if(card&&card.dataset.operationId===updateLogView.id){updateLogView.open=card.querySelector('details').open;updateLogView.scrollTop=card.querySelector('pre').scrollTop}
}
function updateOperationLabel(operation){if(operation.status==='running')return '処理中';if(operation.status==='failed')return '失敗';if(operation.outcome&&operation.outcome.complete)return '正常に完了';return operation.outcome&&operation.outcome.updater==='activating'?'アプリ更新済み・Updater切替待ち':'アプリ更新済み・Updater要確認'}
function renderUpdateOperation(operation,reconnecting=false){
  const target=document.querySelector('#update-operation');if(!target||!operation)return;
  const status=reconnecting?'Admin APIへ再接続中':updateOperationLabel(operation);
  rememberUpdateLogView();
  if(updateLogView.id!==operation.id)updateLogView={id:operation.id,open:false,scrollTop:0};
  let card=target.firstElementChild;
  if(!card||card.dataset.operationId!==operation.id){
    target.replaceChildren();card=document.createElement('article');card.className='card';card.dataset.operationId=operation.id;
    const strong=document.createElement('strong'),details=document.createElement('details'),summary=document.createElement('summary'),identifier=document.createElement('p'),pre=document.createElement('pre');
    details.open=updateLogView.open;summary.textContent='詳細ログ';identifier.className='muted';identifier.textContent='操作ID: '+(operation.id||'');
    details.addEventListener('toggle',()=>{if(updateLogView.id===operation.id)updateLogView.open=details.open});
    pre.addEventListener('scroll',()=>{if(updateLogView.id===operation.id)updateLogView.scrollTop=pre.scrollTop});
    pre.className='update-log';details.append(summary,identifier,pre);card.append(strong,details);target.append(card);
  }
  card.querySelector('strong').textContent=status;
  const pre=card.querySelector('pre'),text=operation.log||'ログはまだありません。';
  if(pre.textContent!==text){const scrollTop=updateLogView.scrollTop;pre.textContent=text;pre.scrollTop=scrollTop}
}
async function updates(){
  ++updateWatchGeneration;
  const state=await request('/updates/state'),installed=state.installed||{},available=state.available||null,policy=state.policy||{channel:'stable',mode:'notify'};
  const updater=state.updater||{},running=updater.running||{};
  const updaterCard='<details><summary>更新プログラムの詳細</summary><p>Updater: <strong>'+esc(updateVersion(running.version))+'</strong></p><p>'+esc(updater.status==='ready'?'切替・実行状態を確認済み':updater.status==='activating'?'切替中（まだ完了ではありません）':'状態を確認できません')+'</p></details>';
  const unavailable=available&&available.unavailableReason?'<div class="notice warning"><strong>このバージョンは適用できません。</strong><p>'+esc(available.unavailableReason)+'</p></div>':'';
  const stateCards='<div class="grid"><article class="card"><h3>現在のバージョン</h3><p><strong>'+esc(updateVersion(installed.version))+'</strong></p></article><article class="card"><h3>更新候補</h3><p><strong>'+esc(updateVersion(available&&available.version))+'</strong></p><p>'+(policy.mode==='automatic'?'自動適用':'通知のみ')+'</p></article></div><details><summary>バージョンの詳細</summary><p>現在のリリースID: <code>'+esc(installed.releaseId||'—')+'</code></p><p>更新チャンネル: <code>'+esc(policy.channel)+'</code></p><p>復旧先: <code>'+esc(state.previousReleaseId||'前回の正常版なし')+'</code></p></details>';
  const policyForm='<form id="update-policy-form" class="form-grid"><label>安定版の更新<select name="mode"><option value="notify"'+(policy.mode==='notify'?' selected':'')+'>確認・通知のみ（既定）</option><option value="automatic"'+(policy.mode==='automatic'?' selected':'')+'>検証後に自動適用</option></select></label><label class="wide">変更理由（監査ログに保存）<textarea name="reason" required minlength="1" maxlength="500"></textarea><small>秘密情報やAPIキーは入力しないでください。</small></label><p class="wide">自動適用を選ぶと、バックアップと検証の後にサービスを再起動します。候補版（RC）は自動適用されません。</p><button>ポリシーを保存</button></form>';
  const operationForm='<form id="update-version-form" class="form-grid"><label>バージョン（空欄は最新の安定版）<input name="version" pattern="v?(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-rc\\.[1-9]\\d*)?" placeholder="vX.Y.Z"></label><small class="wide">検証用の候補版を使う場合は、<code>-rc.N</code>を含むバージョンを指定してください。</small><div class="actions wide"><button type="button" id="update-check" class="secondary">更新を確認</button><button type="button" id="update-apply">取得・検証して更新</button><button type="button" id="update-rollback" class="danger"'+(state.previousReleaseId&&state.previousRollbackCompatible?'':' disabled')+'>前回へロールバック</button></div></form><div id="update-operation" class="stack" aria-live="polite"></div>';
  rememberUpdateLogView();
  out.innerHTML='<div class="page-heading"><h1>アプリケーション更新</h1></div>'+section('状態',stateCards+updaterCard+unavailable+(state.lastError?'<div class="notice warning"><strong>前回の更新処理は失敗しました。</strong><p>'+esc(state.lastError)+'</p></div>':''))+section('更新ポリシー',policyForm)+section('操作',operationForm);
  const version=()=>String(new FormData(document.querySelector('#update-version-form')).get('version')||'').trim();
  document.querySelector('#update-policy-form').onsubmit=async event=>{event.preventDefault();const data=new FormData(event.target),mode=String(data.get('mode')),reason=String(data.get('reason')||'').trim();await request('/updates/policy',{method:'POST',...jsonBody({channel:'stable',mode,reason})});ok.textContent='アプリケーション更新ポリシーを保存しました。';await updates()};
  document.querySelector('#update-check').onclick=async()=>{const selected=version(),result=await request('/updates/check',{method:'POST',...jsonBody(selected?{version:selected}:{})});ok.textContent=updateVersion(result.version)+'を確認しました。';await updates()};
  document.querySelector('#update-apply').onclick=()=>{const selected=version();confirmDialog({title:'アプリケーションを更新',description:'バックアップと検証の後にサービスを再起動します。処理中は一時的に利用できません。',summary:'<p>対象: <strong>'+esc(selected||'最新の安定版')+'</strong></p><p>失敗時に自動で戻せない更新もあります。復旧が必要な場合は記録を保持します。</p>',reason:true,submitLabel:'更新を開始',successMessage:'更新処理を開始しました。',reload:false,onSubmit:f=>request('/updates/apply',{method:'POST',...jsonBody({...(selected?{version:selected}:{}),reason:String(f.get('reason')||'').trim()})}),afterSuccess:startUpdateOperation})};
  document.querySelector('#update-rollback').onclick=()=>confirmDialog({title:'前回のアプリケーションへ戻す',summary:'<p>現在の状態をバックアップしてから <code>'+esc(state.previousReleaseId||'')+'</code> を再デプロイします。</p>',reason:true,submitLabel:'ロールバック',danger:true,successMessage:'ロールバックを開始しました。',reload:false,onSubmit:f=>request('/updates/rollback',{method:'POST',...jsonBody({reason:String(f.get('reason')||'').trim()})}),afterSuccess:startUpdateOperation});
  const operationId=state.activeOperationId||state.lastOperationId;if(operationId){const operation=await request('/updates/operations/'+encodeURIComponent(operationId)).catch(()=>null);if(operation){renderUpdateOperation(operation);if(operation.status==='running'||operation.outcome&&operation.outcome.updater==='activating')watchUpdateOperation(operation)}}
}
function startUpdateOperation(value){if(value&&value.id)watchUpdateOperation(value)}
async function watchUpdateOperation(initial){const generation=++updateWatchGeneration;let operation=initial,failures=0;for(;;){if(generation!==updateWatchGeneration||!document.querySelector('#update-operation'))return;renderUpdateOperation(operation);if(operation.status==='succeeded'&&!(operation.outcome&&operation.outcome.updater==='activating')){if(operation.outcome&&operation.outcome.complete)ok.textContent='アプリとUpdaterの更新完了を確認しました。';else err.textContent='アプリ更新は完了しましたが、Updaterの切替完了は未確認です。状態欄とsystemdを確認してください。';await updates();return}if(operation.status==='failed'){err.textContent=operation.error||'アプリケーション更新に失敗しました。';await updates();return}await new Promise(resolve=>setTimeout(resolve,1500));try{operation=await request('/updates/operations/'+encodeURIComponent(operation.id));failures=0}catch(e){failures++;renderUpdateOperation(operation,true);if(failures>=120){err.textContent='更新後のAdmin APIへ再接続できません。CLIまたはsystemd journalでUpdate Managerの状態を確認してください。';return}await new Promise(resolve=>setTimeout(resolve,1000))}}}
`;
