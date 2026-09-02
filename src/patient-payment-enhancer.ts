let installed=false
let pollTimer:number|undefined
let lastSelected:{date:string;time:string}|null=null

const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((cents||0)/100)
const timeOnly=(value:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(value))

async function getJson(path:string,init?:RequestInit){
  const r=await fetch(path,{credentials:'include',headers:{'content-type':'application/json',...(init?.headers||{})},...init})
  const d=await r.json().catch(()=>({})) as any
  if(!r.ok)throw new Error(d.message||'Não foi possível concluir a solicitação.')
  return d
}

function ensureStyle(){
  if(document.getElementById('patient-payment-style'))return
  const style=document.createElement('style')
  style.id='patient-payment-style'
  style.textContent=`
  .patient-payment-backdrop{position:fixed;inset:0;z-index:300;background:rgba(20,43,37,.48);display:grid;place-items:center;padding:18px}
  .patient-payment-modal{width:min(560px,100%);max-height:min(760px,calc(100vh - 36px));overflow:auto;background:#fff;border-radius:22px;border:1px solid #d9e3dd;box-shadow:0 24px 70px rgba(20,50,42,.25);padding:26px;color:#29463f}
  .patient-payment-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:20px}.patient-payment-head span{display:block;text-transform:uppercase;letter-spacing:.12em;font-size:11px;font-weight:800;color:#6c8079;margin-bottom:5px}.patient-payment-head h2{font-family:Georgia,'Times New Roman',serif;margin:0;color:#173f38;font-size:28px}.patient-payment-close{border:0;background:#edf3ef;color:#3f5e55;width:38px;height:38px;border-radius:50%;font-size:23px;cursor:pointer}
  .patient-payment-amount{padding:13px 15px;background:#edf5f0;border:1px solid #d5e5db;border-radius:12px;margin-bottom:18px;display:flex;justify-content:space-between;gap:16px;align-items:center}.patient-payment-amount strong{font-size:18px;color:#244f44}
  .patient-payment-qr{display:grid;place-items:center;margin:10px 0 18px}.patient-payment-qr img{width:min(270px,72vw);height:auto;aspect-ratio:1;object-fit:contain;border:1px solid #e0e7e3;border-radius:14px;background:#fff;padding:10px}
  .patient-payment-code{display:grid;gap:8px}.patient-payment-code label{font-size:13px;font-weight:800;color:#3a544d}.patient-payment-code textarea{width:100%;min-height:92px;resize:none;border:1px solid #d8e2dc;border-radius:12px;padding:12px;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;color:#29463f;background:#f9fbfa}.patient-payment-copy{border:0;border-radius:12px;background:#58786f;color:#fff;font-weight:800;padding:12px 16px;cursor:pointer}
  .patient-payment-note{font-size:13px;line-height:1.5;color:#677970;margin:16px 0 0}.patient-payment-status{margin-top:16px;padding:11px 13px;border-radius:11px;background:#f3f6f4;color:#52675f;font-size:13px}.patient-payment-status.success{background:#e8f5ec;color:#245b3e;font-weight:700}.patient-payment-status.error{background:#fff0ed;color:#983e31}
  @media(max-width:560px){.patient-payment-modal{padding:20px;border-radius:18px}.patient-payment-head h2{font-size:25px}.patient-payment-backdrop{padding:10px}}
  `
  document.head.appendChild(style)
}

function showMessage(text:string){
  let box=document.querySelector<HTMLElement>('.patient-page .info-box')
  if(!box){box=document.createElement('div');box.className='info-box';document.querySelector('.patient-page .patient-content')?.prepend(box)}
  box.textContent=text
}

function closeModal(){document.querySelector('.patient-payment-backdrop')?.remove();if(pollTimer){clearInterval(pollTimer);pollTimer=undefined}}
function setStatus(text:string,type:'normal'|'success'|'error'='normal'){const el=document.querySelector<HTMLElement>('.patient-payment-status');if(!el)return;el.className=`patient-payment-status${type==='normal'?'':` ${type}`}`;el.textContent=text}
async function latestPendingAppointment(){const data=await getJson('/api/appointments/mine');const list=(data.appointments||[]).filter((a:any)=>a.status==='pending_payment'&&(!a.reserved_until||new Date(a.reserved_until).getTime()>Date.now()));list.sort((a:any,b:any)=>Number(b.id)-Number(a.id));return list[0]||null}
async function currentAppointmentId(){
  const summary=document.querySelector<HTMLElement>('.patient-page .booking-summary')
  const stored=Number(summary?.dataset.appointmentId||0)
  if(stored>0)return stored
  const ap=await latestPendingAppointment()
  return Number(ap?.id||0)
}
async function syncAppointment(appointmentId:number){try{return await getJson(`/api/payments/status/${appointmentId}`)}catch{return null}}

async function resolveSelectedSlot(){
  const selected=document.querySelector<HTMLButtonElement>('.patient-page .time.selected')
  const button=selected||document.querySelector<HTMLButtonElement>('.patient-page .time[data-payment-selected="1"]')
  const section=button?.closest<HTMLElement>('.availability-day')
  const rawDate=section?.dataset.patientDate||lastSelected?.date||''
  const match=(button?.textContent||lastSelected?.time||'').match(/(\d{2}:\d{2})/)
  const wantedTime=match?.[1]||lastSelected?.time||''
  if(!rawDate||!wantedTime)throw new Error('Selecione um horário disponível antes de reservar.')
  const data=await getJson('/api/availability')
  const day=new Date(rawDate); const y=day.getFullYear(),m=day.getMonth(),d=day.getDate()
  const slot=(data.slots||[]).find((s:any)=>{const sd=new Date(s.starts_at);return sd.getFullYear()===y&&sd.getMonth()===m&&sd.getDate()===d&&timeOnly(s.starts_at)===wantedTime&&s.public_status==='free'&&sd.getTime()>Date.now()})
  if(!slot)throw new Error('Esse horário não está mais disponível. Atualize a agenda e escolha outro horário.')
  return slot
}

function renderPaymentChoices(appointmentId?:number){
  const summary=document.querySelector<HTMLElement>('.patient-page .booking-summary')
  if(!summary)return
  if(appointmentId)summary.dataset.appointmentId=String(appointmentId)
  summary.querySelectorAll('.payment-actions').forEach(el=>el.remove())
  summary.querySelectorAll<HTMLButtonElement>('button').forEach(b=>{if((b.textContent||'').toLowerCase().includes('reservar horário'))b.remove()})
  const actions=document.createElement('div')
  actions.className='payment-actions'
  actions.innerHTML='<button type="button" class="primary-button" data-payment-method="pix">Pix • Mercado Pago</button><button type="button" class="secondary-button" data-payment-method="card">Cartão • InfinitePay</button>'
  summary.appendChild(actions)
}

async function reserve(button:HTMLButtonElement){
  if(button.disabled)return
  const old=button.textContent||'Reservar horário';button.disabled=true;button.textContent='Reservando…'
  try{
    const slot=await resolveSelectedSlot()
    const r=await getJson('/api/appointments/reserve',{method:'POST',body:JSON.stringify({slot_id:slot.id})})
    const appointmentId=Number(r.appointment_id||0)
    showMessage('Horário reservado temporariamente. Escolha a forma de pagamento para confirmar o agendamento.')
    renderPaymentChoices(appointmentId)
    document.querySelector<HTMLElement>('.patient-page .booking-summary')?.scrollIntoView({behavior:'smooth',block:'center'})
    return r
  }catch(err){showMessage(err instanceof Error?err.message:String(err));button.disabled=false;button.textContent=old}
}

function openPixModal(data:any,appointmentId:number){
  closeModal()
  const bg=document.createElement('div');bg.className='patient-payment-backdrop'
  bg.innerHTML=`<section class="patient-payment-modal" role="dialog" aria-modal="true" aria-label="Pagamento por Pix">
    <div class="patient-payment-head"><div><span>Pagamento</span><h2>Pix</h2></div><button type="button" class="patient-payment-close" aria-label="Fechar">×</button></div>
    <div class="patient-payment-amount"><span>Valor da sessão</span><strong>${money(Number(data.amount_cents||0))}</strong></div>
    ${data.pix_qr_code?`<div class="patient-payment-qr"><img src="${data.pix_qr_code}" alt="QR Code Pix"></div>`:''}
    ${data.pix_copy_paste?`<div class="patient-payment-code"><label>Pix copia e cola</label><textarea readonly>${String(data.pix_copy_paste).replace(/</g,'&lt;')}</textarea><button type="button" class="patient-payment-copy">Copiar código Pix</button></div>`:''}
    <p class="patient-payment-note">O Pix é processado pelo Mercado Pago. Após realizar o pagamento, aguarde nesta tela. O horário somente fica confirmado após a validação automática do pagamento.</p>
    <div class="patient-payment-status">Aguardando confirmação do pagamento…</div>
  </section>`
  document.body.appendChild(bg)
  bg.querySelector<HTMLButtonElement>('.patient-payment-close')?.addEventListener('click',closeModal)
  bg.addEventListener('click',e=>{if(e.target===bg)closeModal()})
  const copy=bg.querySelector<HTMLButtonElement>('.patient-payment-copy')
  copy?.addEventListener('click',async()=>{const code=String(data.pix_copy_paste||'');try{await navigator.clipboard.writeText(code);copy.textContent='Código copiado'}catch{const ta=bg.querySelector<HTMLTextAreaElement>('textarea');ta?.select();document.execCommand('copy');copy.textContent='Código copiado'}})
  const check=async()=>{const sync=await syncAppointment(appointmentId);const status=sync?.appointment?.status;if(status==='confirmed'){if(pollTimer){clearInterval(pollTimer);pollTimer=undefined}setStatus('Pagamento confirmado. Seu horário está confirmado e garantido.','success');window.setTimeout(()=>window.location.reload(),1600)}else if(status==='expired'||status==='cancelled'){if(pollTimer){clearInterval(pollTimer);pollTimer=undefined}setStatus('Esta reserva não está mais ativa. Volte à agenda e escolha um novo horário.','error')}}
  void check();pollTimer=window.setInterval(check,4000)
}

async function startPix(button:HTMLButtonElement){
  if(button.disabled)return
  const old=button.textContent||'Pix';button.disabled=true;button.textContent='Gerando Pix…'
  try{
    const appointmentId=await currentAppointmentId()
    if(!appointmentId)throw new Error('Não encontrei a reserva criada. Selecione o horário novamente.')
    const data=await getJson('/api/payments/checkout',{method:'POST',body:JSON.stringify({appointment_id:appointmentId,method:'pix'})})
    if(data.status==='approved'){window.location.reload();return}
    openPixModal(data,appointmentId)
  }catch(err){showMessage(err instanceof Error?err.message:String(err))}
  finally{button.disabled=false;button.textContent=old}
}

async function startCard(button:HTMLButtonElement){
  if(button.disabled)return
  const old=button.textContent||'Cartão';button.disabled=true;button.textContent='Abrindo pagamento…'
  try{
    const appointmentId=await currentAppointmentId()
    if(!appointmentId)throw new Error('Não encontrei a reserva criada. Selecione o horário novamente.')
    const data=await getJson('/api/payments/checkout',{method:'POST',body:JSON.stringify({appointment_id:appointmentId,method:'card'})})
    if(!data.checkout_url)throw new Error('A InfinitePay não retornou o link de pagamento.')
    window.location.href=data.checkout_url
  }catch(err){showMessage(err instanceof Error?err.message:String(err));button.disabled=false;button.textContent=old}
}

export function installPatientPaymentEnhancer(){
  if(installed)return;installed=true;ensureStyle()
  document.addEventListener('click',e=>{
    const target=e.target as HTMLElement|null
    const slot=target?.closest<HTMLButtonElement>('.patient-page .time')
    if(slot&&slot.dataset.publicStatus==='free'&&!slot.disabled){
      document.querySelectorAll<HTMLButtonElement>('.patient-page .time[data-payment-selected="1"]').forEach(b=>delete b.dataset.paymentSelected)
      slot.dataset.paymentSelected='1'
      const section=slot.closest<HTMLElement>('.availability-day')
      const tm=(slot.textContent||'').match(/(\d{2}:\d{2})/)?.[1]||''
      if(section?.dataset.patientDate&&tm)lastSelected={date:section.dataset.patientDate,time:tm}
      return
    }
    const reserveButton=target?.closest<HTMLButtonElement>('.patient-page .booking-summary button')
    if(reserveButton&&(reserveButton.textContent||'').toLowerCase().includes('reservar horário')){
      e.preventDefault();e.stopPropagation();(e as any).stopImmediatePropagation?.();void reserve(reserveButton);return
    }
    const button=target?.closest<HTMLButtonElement>('.patient-page .payment-actions button')
    if(!button)return
    const method=button.dataset.paymentMethod
    const text=(button.textContent||'').trim().toLowerCase()
    e.preventDefault();e.stopPropagation();(e as any).stopImmediatePropagation?.()
    if(method==='pix'||text.startsWith('pix'))void startPix(button)
    else if(method==='card'||text.startsWith('cartão')||text.startsWith('cartao'))void startCard(button)
  },true)
}
