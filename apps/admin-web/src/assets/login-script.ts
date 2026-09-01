export const loginScript = String.raw`
const form=document.querySelector('#password-login'),message=document.querySelector('#login-message'),button=document.querySelector('#external-login');
const params=new URLSearchParams(location.search),candidate=params.get('return_to')||'/app/';
const returnTo=/^\/(?!\/)/.test(candidate)&&candidate.length<=2048&&!candidate.includes('\\')&&!/[\u0000-\u001f\u007f]/.test(candidate)?candidate:'/app/';
async function responseJson(response){const text=await response.text();let body={};try{body=text?JSON.parse(text):{}}catch{}if(!response.ok)throw new Error(body?.error?.message||'ログインできませんでした。');return body}
const config=await responseJson(await fetch('/auth/config',{credentials:'same-origin',cache:'no-store'}));
if(config.mode==='password'){form.hidden=false;form.onsubmit=async event=>{event.preventDefault();message.textContent='';const submit=form.querySelector('button');submit.disabled=true;try{await responseJson(await fetch('/auth/password/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({loginName:form.elements.loginName.value,password:form.elements.password.value})}));form.elements.password.value='';location.replace(returnTo)}catch(error){message.textContent=error instanceof Error?error.message:String(error);submit.disabled=false}}}
else if(config.mode==='oidc'){button.hidden=false;button.textContent='IDプロバイダーでログイン';button.onclick=()=>location.assign('/auth/oidc/start?return_to='+encodeURIComponent(returnTo))}
else{button.hidden=false;button.textContent='Cloudflare Accessで続行';button.onclick=async()=>{try{await responseJson(await fetch('/auth/session',{credentials:'same-origin',cache:'no-store'}));location.replace(returnTo)}catch(error){message.textContent=error instanceof Error?error.message:String(error)}}}
`;
