import './admin-2fa.css'

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]||c))
async function request(path:string,init?:RequestInit){const r=await fetch(path,{credentials:'include',headers:{'content-type':'application/json',...(init?.headers||{})},...init});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível concluir.');return d}
let mountingPanel=false

function injectLoginField(){
  if(location.pathname!=='/admin'&&location.pathname!=='/admin/')return
  if(document.querySelector('.admin-page'))return
  const form=document.querySelector<HTMLFormElement>('.auth-card form');if(!form||form.querySelector('[name=totp_code]'))return
  const password=form.querySelector<HTMLInputElement>('input[name=password]')?.closest('label');if(!password)return
  const label=document.createElement('label');label.className='admin-2fa-login-field';label.innerHTML='Código 2FA <small>Se a autenticação em dois fatores estiver ativada.</small><input name="totp_code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000">';password.after(label)
}

function statusMarkup(enabled:boolean){return `<section class="admin-2fa-card" data-admin-2fa-card><div><span class="section-kicker">Proteção adicional</span><h3>Autenticação em dois fatores</h3><p>Use um aplicativo autenticador para gerar um código de 6 dígitos além da sua senha.</p></div><div class="admin-2fa-status ${enabled?'on':'off'}"><strong>${enabled?'Ativada':'Desativada'}</strong><span>${enabled?'Sua conta exige senha + código 2FA no login.':'Ative para proteger ainda mais o acesso profissional.'}</span></div><div data-admin-2fa-actions>${enabled?'<button type="button" class="secondary-button danger" data-disable-2fa>Desativar 2FA</button>':'<button type="button" class="admin-primary" data-setup-2fa>Ativar 2FA</button>'}</div></section>`}

async function mountPanel(){
  const security=document.querySelector<HTMLElement>('.admin-security-panel');if(!security)return
  const existing=[...security.querySelectorAll<HTMLElement>('[data-admin-2fa-card]')]
  if(existing.length>1)existing.slice(1).forEach(card=>card.remove())
  if(existing.length||mountingPanel)return
  mountingPanel=true
  try{
    const state=await request('/api/admin/security/2fa')
    if(!security.isConnected||security.querySelector('[data-admin-2fa-card]'))return
    const wrap=document.createElement('div');wrap.innerHTML=statusMarkup(Boolean(state.enabled));const card=wrap.firstElementChild as HTMLElement;security.querySelector('.admin-security-heading')?.after(card);bindCard(card)
  }catch{}finally{mountingPanel=false}
}
function message(card:HTMLElement,text:string,error=false){let n=card.querySelector<HTMLElement>('.admin-2fa-notice');if(!n){n=document.createElement('div');n.className='admin-2fa-notice';card.appendChild(n)}n.className=`admin-2fa-notice ${error?'error':'success'}`;n.textContent=text}
function bindCard(card:HTMLElement){
  card.addEventListener('click',async e=>{
    const target=e.target as HTMLElement
    if(target.closest('[data-setup-2fa]')){try{const d=await request('/api/admin/security/2fa/setup',{method:'POST'});const actions=card.querySelector<HTMLElement>('[data-admin-2fa-actions]')!;actions.innerHTML=`<div class="admin-2fa-setup"><p>1. Abra Google Authenticator, Microsoft Authenticator ou outro aplicativo TOTP.</p><p>2. Adicione uma conta manualmente usando esta chave:</p><code>${esc(d.secret)}</code><a class="secondary-button" href="${esc(d.uri)}">Abrir no autenticador</a><label>Código de 6 dígitos<input data-2fa-code inputmode="numeric" maxlength="6" placeholder="000000"></label><button type="button" class="admin-primary" data-enable-2fa>Confirmar e ativar</button></div>`}catch(err){message(card,err instanceof Error?err.message:'Erro ao iniciar configuração.',true)}return}
    if(target.closest('[data-enable-2fa]')){const code=card.querySelector<HTMLInputElement>('[data-2fa-code]')?.value||'';try{const d=await request('/api/admin/security/2fa/enable',{method:'POST',body:JSON.stringify({code})});message(card,d.message||'2FA ativado.');window.setTimeout(()=>{card.replaceWith(htmlToNode(statusMarkup(true)))},800)}catch(err){message(card,err instanceof Error?err.message:'Código inválido.',true)}return}
    if(target.closest('[data-disable-2fa]')){const pwd=window.prompt('Digite sua senha atual para desativar o 2FA:');if(pwd===null)return;try{const d=await request('/api/admin/security/2fa/disable',{method:'POST',body:JSON.stringify({current_password:pwd})});message(card,d.message||'2FA desativado.');window.setTimeout(()=>{card.replaceWith(htmlToNode(statusMarkup(false)))},800)}catch(err){message(card,err instanceof Error?err.message:'Não foi possível desativar.',true)}}
  })
}
function htmlToNode(html:string){const w=document.createElement('div');w.innerHTML=html;const el=w.firstElementChild as HTMLElement;bindCard(el);return el}
export function installAdmin2faEnhancer(){let timer:number|undefined;const scan=()=>{if(timer)clearTimeout(timer);timer=window.setTimeout(()=>{injectLoginField();void mountPanel()},100)};scan();const root=document.getElementById('root');if(root)new MutationObserver(scan).observe(root,{childList:true,subtree:true});window.addEventListener('pageshow',scan)}
