type Appointment = {
  id:number
  status:string
  amount_cents:number
  payment_method?:string|null
  paid_at?:string|null
  reserved_until?:string|null
  availability_id:number
  starts_at:string
  ends_at:string
  patient_id:number
  full_name:string
  email:string
  phone:string
}

const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((cents||0)/100)
const fmtDateTime=(value:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))
const esc=(value:unknown)=>String(value??'').replace(/[&<>'"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]||ch))
const appointmentStatus=(a:Appointment)=>a.status==='confirmed'?'Confirmada':a.status==='pending_payment'?'Aguardando pagamento':a.status==='cancelled'?'Cancelada':a.status==='expired'?'Expirada':a.status
const paymentStatus=(a:Appointment)=>a.paid_at?'Pago':a.status==='pending_payment'?'Aguardando pagamento':'—'
const paymentMethod=(a:Appointment)=>a.payment_method==='pix'?'Pix':a.payment_method==='credit_card'?'Cartão':a.payment_method||'—'

let scheduled:number|undefined
let loading=false

function findPatientCard(email:string){
  let attempts=0
  const tryOpen=()=>{
    attempts++
    const card=[...document.querySelectorAll<HTMLButtonElement>('.patient-card')].find(el=>(el.textContent||'').includes(email))
    if(card){card.click();return}
    if(attempts<25)window.setTimeout(tryOpen,100)
  }
  const patientsButton=[...document.querySelectorAll<HTMLButtonElement>('.admin-sidebar nav button')].find(b=>(b.textContent||'').trim()==='Pacientes')
  patientsButton?.click()
  window.setTimeout(tryOpen,50)
}

function renderDetail(host:HTMLElement,a:Appointment){
  let panel=host.querySelector<HTMLElement>('.gc-appointment-detail')
  if(!panel){
    panel=document.createElement('div')
    panel.className='gc-appointment-detail'
    const body=host.querySelector('.gc-body')
    body?.after(panel)
  }
  panel.innerHTML=`
    <div class="gc-appointment-main">
      <span class="section-kicker">Consulta na agenda</span>
      <strong>${esc(a.full_name)}</strong>
      <span>${esc(fmtDateTime(a.starts_at))} – ${esc(new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(a.ends_at)))}</span>
    </div>
    <div class="gc-appointment-info">
      <span><small>Status</small><strong>${esc(appointmentStatus(a))}</strong></span>
      <span><small>Pagamento</small><strong>${esc(paymentStatus(a))}</strong></span>
      <span><small>Forma</small><strong>${esc(paymentMethod(a))}</strong></span>
      <span><small>Valor</small><strong>${esc(money(Number(a.amount_cents||0)))}</strong></span>
      <span><small>Telefone</small><strong>${esc(a.phone||'—')}</strong></span>
      <span><small>E-mail</small><strong>${esc(a.email||'—')}</strong></span>
    </div>
    <button type="button" class="gc-open-patient">Ver paciente</button>
  `
  panel.querySelector<HTMLButtonElement>('.gc-open-patient')?.addEventListener('click',()=>findPatientCard(a.email))
}

async function enrichGrid(grid:HTMLElement){
  if(grid.dataset.appointmentsBound==='1'||loading)return
  grid.dataset.appointmentsBound='1'
  loading=true
  try{
    const r=await fetch('/api/admin/appointments',{credentials:'include'})
    if(!r.ok)return
    const data=await r.json().catch(()=>({})) as any
    const appointments=(data.appointments||[]).filter((a:Appointment)=>['pending_payment','confirmed'].includes(String(a.status))) as Appointment[]
    const byStart=new Map<string,Appointment>()
    for(const a of appointments)byStart.set(new Date(a.starts_at).toISOString(),a)

    const host=grid.closest<HTMLElement>('.google-calendar-admin')
    if(!host)return

    grid.querySelectorAll<HTMLButtonElement>('.work-cell[data-cell]').forEach(cell=>{
      const starts=String(cell.dataset.cell||'').split('|')[0]
      const a=byStart.get(starts)
      if(!a)return
      cell.classList.add('has-appointment')
      cell.dataset.appointmentId=String(a.id)
      cell.innerHTML=`<span class="gc-patient-name">${esc(a.full_name)}</span><small class="gc-patient-status">${esc(appointmentStatus(a))}</small>`
      cell.addEventListener('click',()=>renderDetail(host,a))
    })
  }finally{loading=false}
}

function scan(){
  document.querySelectorAll<HTMLElement>('.google-calendar-admin .work-grid').forEach(grid=>{void enrichGrid(grid)})
}

export function installAdminAppointmentEnhancer(){
  const schedule=()=>{
    if(scheduled)window.clearTimeout(scheduled)
    scheduled=window.setTimeout(()=>{scheduled=undefined;scan()},120)
  }
  schedule()
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true})
}
