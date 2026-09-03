import './admin-session-security.css'

type AdminSession={id:string;created_at:string;expires_at:string;current:boolean}
type SecurityEvent={id:string;action:string;entity_type:string;entity_id?:string|null;created_at:string}

const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))
const dateTime=(value:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))

async function request(path:string,init?:RequestInit){
  const response=await fetch(path,{credentials:'include',headers:{'content-type':'application/json',...(init?.headers||{})},...init})
  const data=await response.json().catch(()=>({})) as any
  if(!response.ok)throw new Error(data.message||'Não foi possível concluir a solicitação.')
  return data
}

function actionLabel(action:string){
  const labels:Record<string,string>={
    admin_login:'Login realizado',
    admin_email_changed:'E-mail de acesso alterado',
    admin_password_changed:'Senha alterada',
    admin_session_revoked:'Sessão encerrada',
    admin_other_sessions_revoked:'Outras sessões encerradas',
    admin_user_created:'Novo usuário administrativo criado',
    admin_user_updated:'Usuário administrativo atualizado',
    clinical_note_created:'Anotação clínica criada',
    clinical_note_deleted:'Anotação clínica excluída',
    settings_updated:'Configurações alteradas',
    appointment_status_changed:'Status de consulta alterado',
  }
  return labels[action]||action.replace(/_/g,' ').replace(/^./,c=>c.toUpperCase())
}

function markup(){
  return `<div class="admin-session-security" data-admin-session-security>
    <section class="admin-security-subpanel">
      <div class="admin-session-security-head"><div><h3>Sessões ativas</h3><p>Confira os acessos que ainda podem usar sua conta profissional.</p></div><button type="button" class="secondary-button" data-end-other-sessions>Encerrar outras sessões</button></div>
      <div class="admin-session-list" data-session-list><div class="empty-state">Carregando sessões...</div></div>
    </section>
    <section class="admin-security-subpanel">
      <div class="admin-session-security-head"><div><h3>Histórico de segurança</h3><p>Atividades recentes realizadas com este acesso.</p></div><button type="button" class="secondary-button" data-refresh-security>Atualizar</button></div>
      <div class="admin-security-history" data-security-history><div class="empty-state">Carregando histórico...</div></div>
    </section>
  </div>`
}

async function loadSessions(host:HTMLElement){
  const list=host.querySelector<HTMLElement>('[data-session-list]');if(!list)return
  try{
    const data=await request('/api/admin/security/sessions')
    const sessions=(data.sessions||[]) as AdminSession[]
    list.innerHTML=sessions.length?sessions.map(session=>`<article class="admin-session-row" data-session-id="${esc(session.id)}">
      <div><div class="admin-session-title"><strong>${session.current?'Sessão atual':'Outra sessão ativa'}</strong>${session.current?'<span>Este dispositivo</span>':''}</div><small>Iniciada em ${esc(dateTime(session.created_at))} • expira em ${esc(dateTime(session.expires_at))}</small></div>
      ${session.current?'':`<button type="button" class="secondary-button danger" data-end-session>Encerrar</button>`}
    </article>`).join(''):'<div class="empty-state">Nenhuma sessão ativa encontrada.</div>'
  }catch(error){list.innerHTML=`<div class="error-box">${esc(error instanceof Error?error.message:'Não foi possível carregar as sessões.')}</div>`}
}

async function loadHistory(host:HTMLElement){
  const list=host.querySelector<HTMLElement>('[data-security-history]');if(!list)return
  try{
    const data=await request('/api/admin/security/activity')
    const events=(data.events||[]) as SecurityEvent[]
    list.innerHTML=events.length?events.map(event=>`<article class="admin-security-event"><span class="admin-security-event-dot"></span><div><strong>${esc(actionLabel(event.action))}</strong><small>${esc(dateTime(event.created_at))}</small></div></article>`).join(''):'<div class="empty-state">Ainda não há atividades registradas para este acesso.</div>'
  }catch(error){list.innerHTML=`<div class="error-box">${esc(error instanceof Error?error.message:'Não foi possível carregar o histórico.')}</div>`}
}

function notice(host:HTMLElement,message:string,error=false){
  const old=host.querySelector('.admin-session-notice');old?.remove()
  const el=document.createElement('div');el.className=`admin-session-notice ${error?'error':'success'}`;el.textContent=message;host.prepend(el)
  window.setTimeout(()=>el.remove(),4500)
}

function bind(host:HTMLElement){
  if(host.dataset.bound)return;host.dataset.bound='1'
  host.addEventListener('click',async event=>{
    const target=event.target as HTMLElement
    const end=target.closest<HTMLButtonElement>('[data-end-session]')
    if(end){
      const row=end.closest<HTMLElement>('[data-session-id]');if(!row)return
      end.disabled=true
      try{const result=await request(`/api/admin/security/sessions/${encodeURIComponent(String(row.dataset.sessionId||''))}`,{method:'DELETE'});notice(host,result.message||'Sessão encerrada.');await Promise.all([loadSessions(host),loadHistory(host)])}
      catch(error){notice(host,error instanceof Error?error.message:'Não foi possível encerrar a sessão.',true)}finally{end.disabled=false}
      return
    }
    const others=target.closest<HTMLButtonElement>('[data-end-other-sessions]')
    if(others){
      others.disabled=true
      try{const result=await request('/api/admin/security/sessions/others',{method:'DELETE'});notice(host,result.message||'Outras sessões encerradas.');await Promise.all([loadSessions(host),loadHistory(host)])}
      catch(error){notice(host,error instanceof Error?error.message:'Não foi possível encerrar as outras sessões.',true)}finally{others.disabled=false}
      return
    }
    if(target.closest('[data-refresh-security]'))await Promise.all([loadSessions(host),loadHistory(host)])
  })
}

function mount(){
  const panel=document.querySelector<HTMLElement>('.admin-security-panel')
  if(!panel||panel.querySelector('[data-admin-session-security]'))return
  const wrapper=document.createElement('div');wrapper.innerHTML=markup();const host=wrapper.firstElementChild as HTMLElement|null;if(!host)return
  panel.appendChild(host);bind(host);void Promise.all([loadSessions(host),loadHistory(host)])
}

export function installAdminSessionSecurityEnhancer(){
  let timer:number|undefined
  const schedule=()=>{if(timer)window.clearTimeout(timer);timer=window.setTimeout(()=>{timer=undefined;mount()},90)}
  schedule()
  const root=document.getElementById('root');if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true})
  window.addEventListener('pageshow',schedule)
}
