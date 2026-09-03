type Patient={id:number;full_name:string;birth_date:string;cpf:string;phone:string;email:string}
type PatientTab='agenda'|'consultas'|'dados'|'seguranca'
let installed=false
let scheduled:number|undefined
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]||c))
const digits=(v:string)=>v.replace(/\D/g,'')
const dateLabel=(v:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date(v))
const timeLabel=(v:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(v))
async function jsonRequest(path:string,init?:RequestInit){const r=await fetch(path,{credentials:'include',headers:{'content-type':'application/json',...(init?.headers||{})},...init});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível concluir a solicitação.');return d}
function currentTab():PatientTab{const v=localStorage.getItem('patientPortalTab') as PatientTab|null;return v&&['agenda','consultas','dados','seguranca'].includes(v)?v:'agenda'}
function closeMenu(page:HTMLElement){page.classList.remove('patient-menu-open');document.querySelector<HTMLButtonElement>('.patient-mobile-menu-button')?.setAttribute('aria-expanded','false')}
function formatCpf(v:string){const d=digits(v);return d.length===11?`${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`:v}
function setMsg(panel:HTMLElement,msg:string,error=false){let box=panel.querySelector<HTMLElement>('.patient-account-message');if(!box){box=document.createElement('div');box.className='patient-account-message';panel.prepend(box)}box.className=`patient-account-message${error?' error':''}`;box.textContent=msg}

function ensureSidebar(page:HTMLElement){
  let sidebar=document.querySelector<HTMLElement>('.patient-sidebar[data-safe-portal="1"]')
  if(!sidebar){
    sidebar=document.createElement('aside');sidebar.className='patient-sidebar';sidebar.dataset.safePortal='1'
    sidebar.innerHTML='<div class="patient-sidebar-brand"><span>Minha área</span><strong>Portal do paciente</strong></div><nav><button data-patient-tab="agenda">Agenda</button><button data-patient-tab="consultas">Minhas consultas</button><button data-patient-tab="dados">Meus dados</button><button data-patient-tab="seguranca">Segurança</button></nav><div class="patient-sidebar-foot"><small>Seus dados são privados e protegidos.</small></div>'
    document.body.appendChild(sidebar)
    sidebar.querySelectorAll<HTMLButtonElement>('[data-patient-tab]').forEach(b=>b.addEventListener('click',()=>renderTab(page,b.dataset.patientTab as PatientTab,true)))
  }
  if(!document.querySelector('.patient-mobile-menu-button')){
    const b=document.createElement('button');b.className='patient-mobile-menu-button patient-mobile-menu-floating';b.type='button';b.setAttribute('aria-label','Abrir menu do paciente');b.setAttribute('aria-expanded','false');b.innerHTML='<span></span><span></span><span></span>';b.addEventListener('click',()=>{const open=!page.classList.contains('patient-menu-open');page.classList.toggle('patient-menu-open',open);b.setAttribute('aria-expanded',String(open))});document.body.appendChild(b)
  }
  if(!document.querySelector('.patient-menu-backdrop[data-safe-portal="1"]')){const bg=document.createElement('button');bg.className='patient-menu-backdrop';bg.dataset.safePortal='1';bg.type='button';bg.setAttribute('aria-label','Fechar menu');bg.addEventListener('click',()=>closeMenu(page));document.body.appendChild(bg)}
}

async function ensureConsultations(main:HTMLElement){
  let panel=main.querySelector<HTMLElement>('[data-safe-consultations="1"]')
  if(!panel){panel=document.createElement('section');panel.className='patient-safe-consultations';panel.dataset.safeConsultations='1';main.appendChild(panel)}
  panel.innerHTML='<div class="patient-consultations-loading">Carregando suas consultas...</div>'
  try{
    const data=await jsonRequest('/api/appointments/mine')
    const confirmed=(data.appointments||[]).filter((a:any)=>a.status==='confirmed')
    const now=Date.now()
    const upcoming=confirmed.filter((a:any)=>new Date(a.ends_at||a.starts_at).getTime()>=now).sort((a:any,b:any)=>new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime())
    const history=confirmed.filter((a:any)=>new Date(a.ends_at||a.starts_at).getTime()<now).sort((a:any,b:any)=>new Date(b.starts_at).getTime()-new Date(a.starts_at).getTime())
    const card=(a:any,kind:'upcoming'|'history')=>`<article class="patient-consultation-card ${kind}"><div><strong>${esc(dateLabel(a.starts_at))}</strong><span>${esc(timeLabel(a.starts_at))}${a.ends_at?` às ${esc(timeLabel(a.ends_at))}`:''}</span></div><span class="patient-consultation-badge">${kind==='upcoming'?'Confirmada':'Realizada'}</span></article>`
    panel.innerHTML=`<h1 class="patient-safe-page-title">Minhas consultas</h1><div class="patient-consultations-block"><div class="patient-consultations-head"><span>Próxima sessão</span><small>Consultas confirmadas após pagamento</small></div>${upcoming.length?upcoming.map((a:any)=>card(a,'upcoming')).join(''):'<p class="patient-consultations-empty">Você não possui consulta futura confirmada.</p>'}</div><div class="patient-consultations-block"><div class="patient-consultations-head"><span>Histórico</span><small>Sessões anteriores confirmadas</small></div>${history.length?history.map((a:any)=>card(a,'history')).join(''):'<p class="patient-consultations-empty">Ainda não há sessões anteriores no seu histórico.</p>'}</div>`
  }catch(err){panel.innerHTML=`<div class="patient-consultations-error">${esc(err instanceof Error?err.message:String(err))}</div>`}
}

async function ensureAccountPanels(main:HTMLElement,p:Patient){
  let dataPanel=main.querySelector<HTMLElement>('[data-safe-account="dados"]')
  if(!dataPanel){dataPanel=document.createElement('section');dataPanel.className='patient-account-panel';dataPanel.dataset.safeAccount='dados';dataPanel.innerHTML=`<div class="patient-account-card"><div class="patient-account-head"><div><span>Dados pessoais</span><h2>Informações do paciente</h2></div><p>Mantenha seus dados de contato atualizados.</p></div><form class="patient-account-form" data-profile-form><div class="patient-form-grid"><label>Nome completo<input name="full_name" required value="${esc(p.full_name)}"></label><label>Data de nascimento<input name="birth_date" type="date" required value="${esc(p.birth_date)}"></label><label>Telefone<input name="phone" required value="${esc(p.phone)}"></label><label>CPF<input value="${esc(formatCpf(p.cpf))}" disabled><small>O CPF não pode ser alterado pelo portal.</small></label></div><button class="primary-button" type="submit">Salvar alterações</button></form></div>`;main.appendChild(dataPanel);dataPanel.querySelector<HTMLFormElement>('[data-profile-form]')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,fd=new FormData(f),btn=f.querySelector<HTMLButtonElement>('button[type=submit]')!;btn.disabled=true;try{const r=await jsonRequest('/api/me/profile',{method:'PATCH',body:JSON.stringify({full_name:String(fd.get('full_name')||''),birth_date:String(fd.get('birth_date')||''),phone:String(fd.get('phone')||'')})});setMsg(dataPanel!,r.message||'Dados atualizados.')}catch(err){setMsg(dataPanel!,err instanceof Error?err.message:String(err),true)}finally{btn.disabled=false}})}
  let sec=main.querySelector<HTMLElement>('[data-safe-account="seguranca"]')
  if(!sec){sec=document.createElement('section');sec.className='patient-account-panel';sec.dataset.safeAccount='seguranca';sec.innerHTML=`<div class="patient-security-grid"><div class="patient-account-card"><div class="patient-account-head"><div><span>Acesso</span><h2>Alterar e-mail</h2></div></div><form class="patient-account-form" data-email-form><label>Novo e-mail<input name="email" type="email" required value="${esc(p.email)}"></label><label>Senha atual<input name="current_password" type="password" required></label><button class="primary-button" type="submit">Alterar e-mail</button></form></div><div class="patient-account-card"><div class="patient-account-head"><div><span>Segurança</span><h2>Alterar senha</h2></div></div><form class="patient-account-form" data-password-form><label>Senha atual<input name="current_password" type="password" required></label><label>Nova senha<input name="new_password" type="password" minlength="10" required></label><label>Confirmar nova senha<input name="confirm_password" type="password" minlength="10" required></label><button class="primary-button" type="submit">Alterar senha</button></form></div></div>`;main.appendChild(sec)}
}

function renderTab(page:HTMLElement,tab:PatientTab,close=true){
  const main=page.querySelector<HTMLElement>('.patient-content');if(!main)return
  localStorage.setItem('patientPortalTab',tab);page.dataset.patientTab=tab
  document.querySelectorAll<HTMLElement>('.patient-sidebar [data-patient-tab]').forEach(b=>b.classList.toggle('active',b.dataset.patientTab===tab))
  const agendaSelectors=['.patient-heading','.availability-list','.booking-summary','.patient-calendar-toolbar']
  agendaSelectors.forEach(s=>main.querySelectorAll<HTMLElement>(s).forEach(el=>el.style.display=tab==='agenda'?'':'none'))
  main.querySelectorAll<HTMLElement>('.my-appointments').forEach(el=>el.style.display='none')
  main.querySelectorAll<HTMLElement>('[data-safe-consultations="1"]').forEach(el=>el.style.display=tab==='consultas'?'':'none')
  main.querySelectorAll<HTMLElement>('[data-safe-account]').forEach(el=>el.style.display=el.dataset.safeAccount===tab?'':'none')
  if(tab==='consultas')void ensureConsultations(main)
  if(close)closeMenu(page)
}

async function enhance(){
  const page=document.querySelector<HTMLElement>('.patient-page'),main=page?.querySelector<HTMLElement>('.patient-content');if(!page||!main)return
  page.classList.add('patient-portal-enhanced','patient-portal-safe');ensureSidebar(page)
  try{const me=await jsonRequest('/api/me');await ensureAccountPanels(main,me.patient)}catch{}
  renderTab(page,currentTab(),false)
}

export function installPatientPortalEnhancer(){
  if(installed)return;installed=true
  const schedule=()=>{if(scheduled)clearTimeout(scheduled);scheduled=window.setTimeout(()=>{scheduled=undefined;void enhance()},100)}
  schedule();const root=document.getElementById('root');if(root)new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n instanceof HTMLElement&&(n.matches('.patient-page')||Boolean(n.querySelector?.('.patient-page'))))))schedule()}).observe(root,{childList:true,subtree:true});window.addEventListener('pageshow',schedule)
}
