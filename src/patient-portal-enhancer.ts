type Patient = { id:number; full_name:string; birth_date:string; cpf:string; phone:string; email:string }
type PatientTab='agenda'|'consultas'|'dados'|'seguranca'

let scheduled:number|undefined
let running=false

const esc=(value:unknown)=>String(value??'').replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':'&quot;'}[c]||c))
const digits=(value:string)=>value.replace(/\D/g,'')

async function jsonRequest(path:string,init?:RequestInit){
  const response=await fetch(path,{credentials:'include',headers:{'content-type':'application/json',...(init?.headers||{})},...init})
  const data=await response.json().catch(()=>({})) as any
  if(!response.ok)throw new Error(data.message||'Não foi possível concluir a solicitação.')
  return data
}

function setPanelMessage(panel:HTMLElement,message:string,kind:'ok'|'error'='ok'){
  let box=panel.querySelector<HTMLElement>('.patient-account-message')
  if(!box){box=document.createElement('div');box.className='patient-account-message';panel.prepend(box)}
  box.className=`patient-account-message ${kind}`
  box.textContent=message
}

function currentTab():PatientTab{
  const saved=localStorage.getItem('patientPortalTab') as PatientTab|null
  return saved&&['agenda','consultas','dados','seguranca'].includes(saved)?saved:'agenda'
}

function closeMobileMenu(page:HTMLElement){
  page.classList.remove('patient-menu-open')
  page.querySelector<HTMLButtonElement>('.patient-mobile-menu-button')?.setAttribute('aria-expanded','false')
}

function applyTab(page:HTMLElement,tab:PatientTab){
  localStorage.setItem('patientPortalTab',tab)
  page.dataset.patientTab=tab
  page.querySelectorAll<HTMLElement>('[data-patient-tab]').forEach(button=>button.classList.toggle('active',button.dataset.patientTab===tab))
  const main=page.querySelector<HTMLElement>('.patient-content')
  if(!main)return
  const agendaNodes=['.patient-heading','.patient-calendar-toolbar','.availability-list','.booking-summary']
  agendaNodes.forEach(selector=>main.querySelectorAll<HTMLElement>(selector).forEach(el=>el.style.display=tab==='agenda'?'':'none'))
  main.querySelectorAll<HTMLElement>('.my-appointments').forEach(el=>el.style.display=tab==='consultas'?'':'none')
  main.querySelectorAll<HTMLElement>('.patient-account-panel').forEach(el=>el.style.display=el.dataset.accountPanel===tab?'':'none')
  const title=main.querySelector<HTMLElement>('.patient-portal-section-title')
  if(title){
    const labels:Record<PatientTab,string>={agenda:'Agenda',consultas:'Minhas consultas',dados:'Meus dados',seguranca:'Segurança'}
    title.textContent=labels[tab]
    title.style.display=tab==='agenda'?'none':''
  }
  closeMobileMenu(page)
}

function formatCpf(value:string){const d=digits(value);return d.length===11?`${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`:value}

async function buildAccountPanels(page:HTMLElement,patient:Patient){
  const main=page.querySelector<HTMLElement>('.patient-content')
  if(!main)return
  if(!main.querySelector('.patient-portal-section-title')){
    const title=document.createElement('h1');title.className='patient-portal-section-title';title.style.display='none';main.prepend(title)
  }

  let dataPanel=main.querySelector<HTMLElement>('[data-account-panel="dados"]')
  if(!dataPanel){
    dataPanel=document.createElement('section');dataPanel.className='patient-account-panel';dataPanel.dataset.accountPanel='dados'
    dataPanel.innerHTML=`<div class="patient-account-card"><div class="patient-account-head"><div><span>Dados pessoais</span><h2>Informações do paciente</h2></div><p>Mantenha seus dados de contato atualizados.</p></div><form class="patient-account-form" data-profile-form><div class="patient-form-grid"><label>Nome completo<input name="full_name" required value="${esc(patient.full_name)}"></label><label>Data de nascimento<input name="birth_date" type="date" required value="${esc(patient.birth_date)}"></label><label>Telefone<input name="phone" required value="${esc(patient.phone)}"></label><label>CPF<input value="${esc(formatCpf(patient.cpf))}" disabled><small>O CPF não pode ser alterado pelo portal.</small></label></div><button class="primary-button" type="submit">Salvar alterações</button></form></div>`
    main.appendChild(dataPanel)
    dataPanel.querySelector<HTMLFormElement>('[data-profile-form]')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,fd=new FormData(form),button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;button.disabled=true
      try{const r=await jsonRequest('/api/me/profile',{method:'PATCH',body:JSON.stringify({full_name:String(fd.get('full_name')||''),birth_date:String(fd.get('birth_date')||''),phone:String(fd.get('phone')||'')})});setPanelMessage(dataPanel!,r.message||'Dados atualizados.');const name=page.querySelector<HTMLElement>('.portal-user span');if(name)name.textContent=String(fd.get('full_name')||'Paciente')}
      catch(error){setPanelMessage(dataPanel!,error instanceof Error?error.message:String(error),'error')}finally{button.disabled=false}
    })
  }

  let securityPanel=main.querySelector<HTMLElement>('[data-account-panel="seguranca"]')
  if(!securityPanel){
    securityPanel=document.createElement('section');securityPanel.className='patient-account-panel';securityPanel.dataset.accountPanel='seguranca'
    securityPanel.innerHTML=`<div class="patient-security-grid"><div class="patient-account-card"><div class="patient-account-head"><div><span>Acesso</span><h2>Alterar e-mail</h2></div><p>Confirme sua senha atual para trocar o e-mail de acesso.</p></div><form class="patient-account-form" data-email-form><label>Novo e-mail<input name="email" type="email" required value="${esc(patient.email)}"></label><label>Senha atual<input name="current_password" type="password" autocomplete="current-password" required></label><button class="primary-button" type="submit">Alterar e-mail</button></form></div><div class="patient-account-card"><div class="patient-account-head"><div><span>Segurança</span><h2>Alterar senha</h2></div><p>A nova senha deve ter pelo menos 10 caracteres.</p></div><form class="patient-account-form" data-password-form><label>Senha atual<input name="current_password" type="password" autocomplete="current-password" required></label><label>Nova senha<input name="new_password" type="password" minlength="10" autocomplete="new-password" required></label><label>Confirmar nova senha<input name="confirm_password" type="password" minlength="10" autocomplete="new-password" required></label><button class="primary-button" type="submit">Alterar senha</button></form></div></div>`
    main.appendChild(securityPanel)
    securityPanel.querySelector<HTMLFormElement>('[data-email-form]')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,fd=new FormData(form),button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;button.disabled=true
      try{const r=await jsonRequest('/api/me/email',{method:'PATCH',body:JSON.stringify({email:String(fd.get('email')||''),current_password:String(fd.get('current_password')||'')})});setPanelMessage(securityPanel!,r.message||'E-mail atualizado.');(form.elements.namedItem('current_password') as HTMLInputElement).value=''}
      catch(error){setPanelMessage(securityPanel!,error instanceof Error?error.message:String(error),'error')}finally{button.disabled=false}
    })
    securityPanel.querySelector<HTMLFormElement>('[data-password-form]')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,fd=new FormData(form),newPassword=String(fd.get('new_password')||''),confirm=String(fd.get('confirm_password')||''),button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;if(newPassword!==confirm){setPanelMessage(securityPanel!,'As novas senhas não coincidem.','error');return}button.disabled=true
      try{const r=await jsonRequest('/api/me/password',{method:'PATCH',body:JSON.stringify({current_password:String(fd.get('current_password')||''),new_password:newPassword})});setPanelMessage(securityPanel!,r.message||'Senha alterada.');form.reset()}
      catch(error){setPanelMessage(securityPanel!,error instanceof Error?error.message:String(error),'error')}finally{button.disabled=false}
    })
  }
}

function ensureMobileMenu(page:HTMLElement){
  const header=page.querySelector<HTMLElement>('.portal-header')
  if(!header)return
  if(!header.querySelector('.patient-mobile-menu-button')){
    const button=document.createElement('button')
    button.className='patient-mobile-menu-button'
    button.type='button'
    button.setAttribute('aria-label','Abrir menu do paciente')
    button.setAttribute('aria-expanded','false')
    button.innerHTML='<span></span><span></span><span></span>'
    button.addEventListener('click',()=>{
      const open=page.classList.toggle('patient-menu-open')
      button.setAttribute('aria-expanded',String(open))
    })
    header.prepend(button)
  }
  if(!page.querySelector('.patient-menu-backdrop')){
    const backdrop=document.createElement('button')
    backdrop.className='patient-menu-backdrop'
    backdrop.type='button'
    backdrop.setAttribute('aria-label','Fechar menu')
    backdrop.addEventListener('click',()=>closeMobileMenu(page))
    page.appendChild(backdrop)
  }
}

async function enhance(){
  if(running)return
  const page=document.querySelector<HTMLElement>('.patient-page')
  const main=page?.querySelector<HTMLElement>('.patient-content')
  if(!page||!main)return
  running=true
  try{
    page.classList.add('patient-portal-enhanced')
    main.querySelectorAll<HTMLElement>('.price-card').forEach(el=>el.style.display='none')
    main.querySelectorAll<HTMLElement>('.patient-heading p').forEach(el=>el.remove())
    let sidebar=page.querySelector<HTMLElement>('.patient-sidebar')
    if(!sidebar){
      sidebar=document.createElement('aside');sidebar.className='patient-sidebar';sidebar.innerHTML=`<div class="patient-sidebar-brand"><span>Minha área</span><strong>Portal do paciente</strong></div><nav><button data-patient-tab="agenda">Agenda</button><button data-patient-tab="consultas">Minhas consultas</button><button data-patient-tab="dados">Meus dados</button><button data-patient-tab="seguranca">Segurança</button></nav><div class="patient-sidebar-foot"><small>Seus dados são privados e protegidos.</small></div>`
      const header=page.querySelector('.portal-header');header?.after(sidebar)
      sidebar.querySelectorAll<HTMLButtonElement>('[data-patient-tab]').forEach(button=>button.addEventListener('click',()=>applyTab(page,button.dataset.patientTab as PatientTab)))
    }
    ensureMobileMenu(page)
    if(!main.querySelector('[data-account-panel="dados"]')){
      const me=await jsonRequest('/api/me')
      await buildAccountPanels(page,me.patient)
    }
    applyTab(page,currentTab())
  }catch(error){console.error('Patient portal enhancer:',error)}finally{running=false}
}

export function installPatientPortalEnhancer(){
  const schedule=()=>{if(scheduled)window.clearTimeout(scheduled);scheduled=window.setTimeout(()=>{scheduled=undefined;void enhance()},80)}
  schedule();new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true})
}
