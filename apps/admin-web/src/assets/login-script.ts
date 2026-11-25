import { browserLoginConfigurationScript } from "./auth-configuration.js";

export const loginScript =
  browserLoginConfigurationScript +
  String.raw`
const translations=JSON.parse(document.querySelector('meta[name="site-messages"]')?.content||'{}');
const messageText=(key,fallback)=>translations[key]??fallback;
const methods=document.querySelector('#login-methods'),message=document.querySelector('#login-message');
const params=new URLSearchParams(location.search),candidate=params.get('return_to')||'/app/';
const returnTo=/^\/(?!\/)/.test(candidate)&&candidate.length<=2048&&!candidate.includes('\\')&&!/[\u0000-\u001f\u007f]/.test(candidate)?candidate:'/app/';
async function responseJson(response){const text=await response.text();let body;try{body=text?JSON.parse(text):{}}catch{throw new Error(messageText('invalidResponse','サーバーから不正な応答が返されました。'))}if(!response.ok)throw new Error(body?.error?.message||messageText('signInError','ログインできませんでした。'));return body}
function showError(error){message.textContent=error instanceof Error?error.message:String(error)}
try{
  const config=normalizeBrowserLoginConfiguration(await responseJson(await fetch('/auth/config',{credentials:'same-origin',cache:'no-store'})));
  message.textContent='';
  if(config.backend==='cloudflare-access'){
    const button=document.createElement('button');button.id='external-login';button.type='button';button.textContent=messageText('cloudflareLogin','Cloudflare Accessで続行');
    button.onclick=async()=>{if(button.disabled)return;button.disabled=true;message.textContent='';try{await responseJson(await fetch('/auth/session',{credentials:'same-origin',cache:'no-store'}));location.replace(returnTo)}catch(error){showError(error);button.disabled=false}};
    methods.append(button);
  }else{
    if(config.methods.some(method=>method.id==='password')){
      const form=document.createElement('form');form.id='password-login';form.className='stack';
      form.innerHTML='<label><span></span><input name="loginName" autocomplete="username" required minlength="3" maxlength="64"></label><label><span></span><input name="password" type="password" autocomplete="current-password" required minlength="12" maxlength="1024"></label><button type="submit"></button>';
      const [loginLabel,passwordLabel]=form.querySelectorAll('label span');
      loginLabel.textContent=messageText('loginName','ログイン名');
      passwordLabel.textContent=messageText('password','パスワード');
      form.querySelector('button').textContent=messageText('signIn','ログイン');
      form.onsubmit=async event=>{event.preventDefault();const submit=form.querySelector('button');if(submit.disabled)return;message.textContent='';submit.disabled=true;try{await responseJson(await fetch('/auth/password/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({loginName:form.elements.loginName.value,password:form.elements.password.value})}));form.elements.password.value='';location.replace(returnTo)}catch(error){showError(error);submit.disabled=false}};
      methods.append(form);form.elements.loginName.focus();
    }
    const oidc=config.methods.find(method=>method.id==='oidc');
    if(oidc){
      if(methods.childElementCount){const separator=document.createElement('p');separator.textContent=messageText('or','または');methods.append(separator)}
      const button=document.createElement('button');button.id='external-login';button.type='button';button.textContent=messageText('providerLogin','{provider}でログイン').replace('{provider}',()=>oidc.displayName);
      button.onclick=()=>location.assign('/auth/oidc/start?return_to='+encodeURIComponent(returnTo));methods.append(button);
    }
  }
}catch(error){methods.replaceChildren();showError(error)}
`;
