import './admin-desktop.css'

const STORAGE_KEY = 'psicogestao.admin.view'

type AdminView = 'dashboard' | 'agenda' | 'consultas' | 'pagamentos' | 'pacientes' | 'configuracoes'
type Appointment = {
  id:number
  status:string
  amount_cents:number
  payment_method?:string|null
  payment_provider?:string|null
  paid_at?:string|null
  reserved_until?:string|null
  starts_at:string
  ends_at:string
  full_name:string
  email:string
  phone?:string|null
}
type Patient = { id:number; full_name:string; email:string; phone?:string|null; appointment_count?:number }

const labelToView = (label: string):AdminView|null => {
  if (label === 'Painel') return 'dashboard'
  if (label === 'Agenda') return 'agenda'
  if (label === 'Consultas' || label === 'Sessões') return 'consultas'
  if (label === 'Pagamentos' || label === 'Financeiro') return 'pagamentos'
  if (label === 'Pacientes') return 'pacientes'
  if (label === 'Configurações') return 'configuracoes'
  return null
}

const viewToLabel = (view: AdminView) => view === 'dashboard' ? 'Painel' : view === 'agenda' ? 'Agenda' : view === 'consultas' ? 'Consultas' : view === 'pagamentos' ? 'Pagamentos' : view === 'pacientes' ? 'Pacientes' : 'Configurações'
const isAdminView=(value:string|null):value is AdminView=>!!value&&['dashboard','agenda','consultas','pagamentos','pacientes','configuracoes'].includes(value)
const queryViewToAdminView=(value:string|null):AdminView|null=>value==='dashboard'?'dashboard':value==='sessions'?'consultas':value==='agenda'?'agenda':value==='finance'?'pagamentos':value==='patients'?'pacientes':null
function desiredInitialView():AdminView{
  const queryView=queryViewToAdminView(new URLSearchParams(window.location.search).get('view'))
  if(queryView){localStorage.setItem(STORAGE_KEY,queryView);return queryView}
  const stored=localStorage.getItem(STORAGE_KEY)
  return isAdminView(stored)?stored:'dashboard'
}
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] || c))
const money = (cents:number) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(cents)||0)/100)
const dateTime = (value:string) => new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))
const dateOnly = (value:string) => new Intl.DateTimeFormat('pt-BR',{weekday:'short',day:'2-digit',month:'short'}).format(new Date(value))
const timeOnly = (value:string) => new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(value))
const sameLocalDay=(a:Date,b:Date)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()
const sameMonth=(a:Date,b:Date)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()
const statusLabel=(status:string)=>status==='confirmed'?'Confirmada':status==='pending_payment'?'Aguardando pagamento':status==='cancelled'?'Cancelada':status==='expired'?'Expirada':status==='failed'?'Falhou':status||'—'
const statusClass=(status:string)=>['confirmed','pending_payment','cancelled','expired','failed'].includes(status)?status:'other'
const paymentMethod=(a:Appointment)=>a.payment_method==='pix'?'Pix':a.payment_method==='credit_card'||a.payment_method==='card'?'Cartão':a.payment_provider==='mercadopago'?'Pix':a.payment_provider==='infinitepay'?'Cartão':'—'

async function getJson(path:string){
  const response=await fetch(path,{credentials:'include',cache:'no-store'})
  const data=await response.json().catch(()=>({})) as any
  if(!response.ok)throw new Error(data.message||'Não foi possível carregar os dados.')
  return data
}

function sidebarButtons(sidebar:HTMLElement){return [...sidebar.querySelectorAll<HTMLButtonElement>('nav button')]}
function buttonByLabel(sidebar:HTMLElement,label:string){
  const wanted=labelToView(label)
  return sidebarButtons(sidebar).find(button=>{
    const text=(button.textContent||'').trim()
    return text===label || (wanted!==null && labelToView(text)===wanted)
  })
}

function setSidebarActive(sidebar:HTMLElement,label:string){
  const wanted=labelToView(label)
  sidebarButtons(sidebar).forEach(button=>{
    const text=(button.textContent||'').trim()
    button.classList.toggle('active',text===label || (wanted!==null && labelToView(text)===wanted))
  })
}

function setHeader(main:HTMLElement,title:string,kicker:string){
  const topbar=main.querySelector<HTMLElement>('.admin-topbar')
  const heading=topbar?.querySelector<HTMLElement>('h1')
  const eyebrow=topbar?.querySelector<HTMLElement>('.section-kicker')
  if(heading)heading.textContent=title
  if(eyebrow)eyebrow.textContent=kicker
}

function removeCustomView(main:HTMLElement){
  main.classList.remove('admin-custom-mode')
  main.querySelector('.admin-custom-view')?.remove()
}

function empty(message:string){return `<div class="admin-dashboard-empty">${esc(message)}</div>`}

function quickActions(){
  return `<div class="admin-dashboard-actions">
    <button type="button" data-admin-open="Agenda">Abrir agenda</button>
    <button type="button" data-admin-open="Pacientes">Pacientes</button>
    <button type="button" data-admin-open="Pagamentos">Pagamentos</button>
    <button type="button" data-admin-open="Configurações">Configurações</button>
  </div>`
}

function dashboardMarkup(appointments:Appointment[],patients:Patient[]){
  const now=new Date()
  const tomorrow=new Date(now)
  tomorrow.setDate(tomorrow.getDate()+1)
  const active=appointments.filter(a=>!['cancelled','expired'].includes(String(a.status)))
  const today=active.filter(a=>sameLocalDay(new Date(a.starts_at),now))
  const tomorrowSessions=active.filter(a=>sameLocalDay(new Date(a.starts_at),tomorrow))
  const pending=appointments.filter(a=>a.status==='pending_payment')
  const receivedMonth=appointments.filter(a=>a.status==='confirmed'&&a.paid_at&&sameMonth(new Date(a.paid_at),now)).reduce((sum,a)=>sum+Number(a.amount_cents||0),0)
  const upcoming=appointments.filter(a=>a.status==='confirmed'&&new Date(a.starts_at).getTime()>=Date.now()).sort((a,b)=>new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime()).slice(0,6)

  return `${quickActions()}
    <section class="admin-kpi-grid" aria-label="Resumo do painel">
      <div class="admin-dashboard-sessions-split">
        <article class="admin-kpi"><small>Sessões hoje</small><strong>${today.length}</strong><span>Atendimentos previstos para hoje</span></article>
        <article class="admin-kpi"><small>Sessões amanhã</small><strong>${tomorrowSessions.length}</strong><span>Atendimentos previstos para amanhã</span></article>
      </div>
      <article class="admin-kpi attention"><small>Aguardando pagamento</small><strong>${pending.length}</strong><span>Reservas ainda não confirmadas</span></article>
      <article class="admin-kpi"><small>Pacientes</small><strong>${patients.length}</strong><span>Cadastros no banco de pacientes</span></article>
      <article class="admin-kpi success"><small>Recebido no mês</small><strong>${esc(money(receivedMonth))}</strong><span>Consultas pagas no mês atual</span></article>
    </section>
    <section class="admin-dashboard-grid">
      <article class="admin-dashboard-card">
        <div class="admin-dashboard-card-head"><div><h2>Próximas consultas</h2><span>Agenda confirmada</span></div><span>${upcoming.length} exibida(s)</span></div>
        <div class="admin-dashboard-list">${upcoming.length?upcoming.map(a=>`<div class="admin-dashboard-row"><div class="admin-dashboard-row-main"><strong>${esc(a.full_name)}</strong><span>${esc(dateOnly(a.starts_at))} • ${esc(timeOnly(a.starts_at))}–${esc(timeOnly(a.ends_at))}</span><small>${esc(a.email)}</small></div><div class="admin-dashboard-row-side"><span class="admin-status-chip confirmed">Confirmada</span><strong>${esc(money(a.amount_cents))}</strong></div></div>`).join(''):empty('Nenhuma consulta confirmada futura.')}</div>
      </article>
    </section>`
}

function paymentsMarkup(appointments:Appointment[]){
  const now=new Date()
  const paid=appointments.filter(a=>a.status==='confirmed'&&a.paid_at)
  const paidMonth=paid.filter(a=>sameMonth(new Date(a.paid_at as string),now))
  const pending=appointments.filter(a=>a.status==='pending_payment')
  const monthTotal=paidMonth.reduce((sum,a)=>sum+Number(a.amount_cents||0),0)
  const pendingTotal=pending.reduce((sum,a)=>sum+Number(a.amount_cents||0),0)
  const ordered=[...appointments].filter(a=>a.amount_cents>0).sort((a,b)=>new Date(b.paid_at||b.starts_at).getTime()-new Date(a.paid_at||a.starts_at).getTime())
  return `${quickActions()}
    <section class="admin-finance-summary">
      <article class="admin-kpi success"><small>Recebido no mês</small><strong>${esc(money(monthTotal))}</strong><span>${paidMonth.length} pagamento(s) confirmado(s)</span></article>
      <article class="admin-kpi attention"><small>A receber</small><strong>${esc(money(pendingTotal))}</strong><span>${pending.length} reserva(s) aguardando pagamento</span></article>
      <article class="admin-kpi"><small>Pagamentos confirmados</small><strong>${paid.length}</strong><span>Total histórico de consultas pagas</span></article>
    </section>
    <div class="admin-section-title"><div><h2>Pagamentos</h2><p>Pix via Mercado Pago e cartão via InfinitePay.</p></div><span>${ordered.length} lançamento(s)</span></div>
    <section class="admin-table-card admin-payments-table">
      <div class="admin-table-row header"><span>Paciente</span><span>Referência</span><span>Pagamento</span><span>Valor</span></div>
      ${ordered.length?ordered.map(a=>`<div class="admin-table-row"><div><strong>${esc(a.full_name)}</strong><small>${esc(a.email)}</small></div><div><strong>${esc(dateTime(a.starts_at))}</strong><small>${esc(a.payment_provider||'')}</small></div><div><span class="admin-status-chip ${a.paid_at?'paid':a.status==='pending_payment'?'pending':statusClass(a.status)}">${a.paid_at?'Pago':esc(statusLabel(a.status))}</span><small>${esc(paymentMethod(a))}${a.paid_at?` • ${esc(dateTime(a.paid_at))}`:''}</small></div><div><strong>${esc(money(a.amount_cents))}</strong></div></div>`).join(''):`<div style="padding:18px">${empty('Nenhum pagamento registrado.')}</div>`}
    </section>`
}

async function renderCustom(view:'dashboard'|'consultas'|'pagamentos',sidebar:HTMLElement){
  const main=document.querySelector<HTMLElement>('.admin-main')
  if(!main)return
  removeCustomView(main)
  main.classList.add('admin-custom-mode')
  setSidebarActive(sidebar,viewToLabel(view))
  localStorage.setItem(STORAGE_KEY,view)
  setHeader(main,view==='dashboard'?'Visão geral':view==='consultas'?'Consultas':'Pagamentos','Gestão profissional')

  const host=document.createElement('div')
  host.className='admin-custom-view'
  host.innerHTML=empty('Carregando informações...')
  main.appendChild(host)

  if(view==='consultas'){
    return
  }

  try{
    const [appointmentData,patientData]=await Promise.all([
      getJson('/api/admin/appointments'),
      view==='dashboard'?getJson('/api/admin/patients'):Promise.resolve({patients:[]}),
    ])
    const appointments=(appointmentData.appointments||[]) as Appointment[]
    const patients=(patientData.patients||[]) as Patient[]
    if(!host.isConnected)return
    host.innerHTML=view==='dashboard'?dashboardMarkup(appointments,patients):paymentsMarkup(appointments)
    host.querySelectorAll<HTMLButtonElement>('[data-admin-open]').forEach(button=>button.addEventListener('click',()=>{
      const target=buttonByLabel(sidebar,String(button.dataset.adminOpen||''))
      target?.click()
    }))
  }catch(error){
    host.innerHTML=`<div class="error-box">${esc(error instanceof Error?error.message:'Não foi possível carregar esta área.')}</div>`
  }
}

function restoreNativeHeader(view:AdminView){
  const main=document.querySelector<HTMLElement>('.admin-main')
  if(!main)return
  if(view==='agenda')setHeader(main,'Agenda','Gestão profissional')
  if(view==='pacientes')setHeader(main,'Pacientes e prontuários','Gestão profissional')
  if(view==='configuracoes')setHeader(main,'Configurações','Gestão profissional')
}

export function installAdminStateEnhancer() {
  let restoring=false

  const bind = () => {
    const page=document.querySelector<HTMLElement>('.admin-page')
    const sidebar = document.querySelector<HTMLElement>('.admin-sidebar')
    if (!page||!sidebar) return false
    page.classList.add('admin-desktop-enhanced')

    if (!sidebar.dataset.desktopNavBound) {
      sidebar.dataset.desktopNavBound='1'
      sidebarButtons(sidebar).forEach(button=>{
        const label=(button.textContent||'').trim()
        const view=labelToView(label)
        if(!view)return
        button.dataset.adminView=view
        if(['dashboard','consultas','pagamentos'].includes(view)){
          button.addEventListener('click',event=>{
            event.preventDefault()
            event.stopPropagation()
            void renderCustom(view as 'dashboard'|'consultas'|'pagamentos',sidebar)
          })
        }else{
          button.addEventListener('click',()=>{
            const main=document.querySelector<HTMLElement>('.admin-main')
            if(main)removeCustomView(main)
            localStorage.setItem(STORAGE_KEY,view)
            window.setTimeout(()=>restoreNativeHeader(view),0)
          })
        }
      })
    }

    if (!sidebar.dataset.desktopNavRestored&&!restoring) {
      sidebar.dataset.desktopNavRestored='1'
      restoring=true
      const wanted=desiredInitialView()
      window.setTimeout(()=>{
        const target=buttonByLabel(sidebar,viewToLabel(wanted))
        target?.click()
        restoring=false
      },0)
    }
    return true
  }

  let attempts=0
  const retry=()=>{
    attempts+=1
    if(bind()||attempts>=30)return
    window.setTimeout(retry,80)
  }
  retry()

  const root=document.getElementById('root')
  if(root)new MutationObserver(records=>{
    const relevant=records.some(record=>[...record.addedNodes].some(node=>node instanceof HTMLElement&&(node.matches('.admin-page,.admin-sidebar')||Boolean(node.querySelector('.admin-page,.admin-sidebar')))))
    if(relevant)window.setTimeout(bind,60)
  }).observe(root,{childList:true,subtree:true})

  window.addEventListener('pageshow',()=>window.setTimeout(bind,60))
}
