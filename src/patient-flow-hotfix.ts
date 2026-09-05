const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))
const TZ='America/Sao_Paulo'
const dateLong=(v:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric',timeZone:TZ}).format(new Date(v))
const dt=(v:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:TZ}).format(new Date(v))
const timeOnly=(v:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:TZ}).format(new Date(v))
const money=(c:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(c)||0)/100)
function localDay(v:string|Date){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(v instanceof Date?v:new Date(v));const y=Number(parts.find(p=>p.type==='year')?.value||0),m=Number(parts.find(p=>p.type==='month')?.value||0),d=Number(parts.find(p=>p.type==='day')?.value||0);return Math.floor(Date.UTC(y,m-1,d)/86400000)}
const daysUntil=(v:string)=>localDay(v)-localDay(new Date())

async function api(path:string,init?:RequestInit){
  const r=await fetch(path,{credentials:'include',cache:'no-store',headers:{'content-type':'application/json',...(init?.headers||{})},...init})
  const d=await r.json().catch(()=>({})) as any
  if(!r.ok)throw new Error(d.message||'Não foi possível concluir a solicitação.')
  return d
}

function openSessions(message?:string){
  sessionStorage.removeItem('ps_reschedule_appointment')
  sessionStorage.removeItem('ps_last_held_appointment')
  localStorage.setItem('patientPortalTab','consultas')
  const button=document.querySelector<HTMLButtonElement>('[data-patient-tab="consultas"]')
  if(button)button.click();else window.location.href='/paciente'
  if(message)setTimeout(()=>alert(message),120)
}

function showPix(result:any,appointmentId:number){
  document.querySelector('.patient-pix-hotfix')?.remove()
  const overlay=document.createElement('div')
  overlay.className='session-modal-overlay patient-pix-hotfix'
  overlay.innerHTML=`<div class="session-modal pix-modal"><h2>Pagamento por Pix</h2><p>Use o QR Code ou o código Pix copia e cola. Esta tela confirma o pagamento automaticamente.</p>${result.pix_qr_code?`<img src="${esc(result.pix_qr_code)}" alt="QR Code Pix">`:''}${result.pix_copy_paste?`<label>Pix copia e cola<textarea readonly rows="4">${esc(result.pix_copy_paste)}</textarea></label>`:''}<p class="pix-payment-status" data-pix-status>Aguardando confirmação do pagamento...</p><div><button type="button" data-copy ${result.pix_copy_paste?'':'disabled'}>Copiar código</button><button type="button" data-close>Fechar</button></div></div>`
  document.body.appendChild(overlay)
  let closed=false
  overlay.querySelector('[data-close]')?.addEventListener('click',()=>{closed=true;overlay.remove()})
  overlay.querySelector<HTMLButtonElement>('[data-copy]')?.addEventListener('click',async()=>{if(!result.pix_copy_paste)return;await navigator.clipboard.writeText(String(result.pix_copy_paste));alert('Código Pix copiado.')})
  const status=overlay.querySelector<HTMLElement>('[data-pix-status]')
  let attempts=0
  const poll=async()=>{
    if(closed||!document.body.contains(overlay))return
    attempts+=1
    try{
      const r=await api(`/api/payments/status/${appointmentId}`)
      if(r.appointment?.status==='confirmed'){
        if(status)status.textContent='Pagamento confirmado.'
        closed=true
        setTimeout(()=>{overlay.remove();openSessions('Agendamento confirmado!')},400)
        return
      }
      if(r.appointment?.status==='cancelled'){
        if(status)status.textContent='A reserva foi cancelada porque o prazo de pagamento terminou.'
        closed=true
        setTimeout(()=>{overlay.remove();openSessions()},800)
        return
      }
    }catch{}
    if(attempts<120)setTimeout(poll,2500)
    else if(status)status.textContent='O pagamento ainda não foi confirmado. Você pode fechar esta janela e consultar Minhas sessões depois.'
  }
  setTimeout(poll,1800)
}

function patchFetchReservationTracking(){
  const marker='__psPatientFlowFetchPatched'
  const w=window as any
  if(w[marker])return
  w[marker]=true
  const nativeFetch=window.fetch.bind(window)
  window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const response=await nativeFetch(input,init)
    try{
      const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url
      const method=String(init?.method||(typeof input!=='string'&&!(input instanceof URL)?input.method:'GET')).toUpperCase()
      if(method==='POST'&&new URL(url,window.location.origin).pathname==='/api/appointments/reserve'&&response.ok){
        const data=await response.clone().json().catch(()=>({})) as any
        if(data.appointment_id)sessionStorage.setItem('ps_last_held_appointment',String(data.appointment_id))
      }
    }catch{}
    return response
  }
}

function patchRescheduleAgenda(){
  const appointmentId=Number(sessionStorage.getItem('ps_reschedule_appointment')||0)
  if(!appointmentId)return
  const box=document.querySelector<HTMLElement>('.patient-booking-box')
  if(!box)return
  const info=box.querySelector<HTMLElement>('.patient-booking-info')
  if(info&&info.dataset.rescheduleInfo!=='1'){
    info.dataset.rescheduleInfo='1'
    info.innerHTML='<p><strong>Reagendamento sem nova cobrança.</strong></p><p>Escolha o novo horário. O pagamento da sessão atual continuará válido.</p><p>Ao confirmar, a agenda será atualizada imediatamente.</p>'
  }
  const button=box.querySelector<HTMLButtonElement>('[data-reserve]')
  if(button)button.textContent='Confirmar reagendamento'
}

function sessionRow(a:any){
  if(a.status==='pending_payment'){
    const recurring=a.reservation_kind==='recurring'
    return `<article class="patient-consult-row ${recurring?'patient-consult-row-recurring':''}"><div><strong>${esc(dateLong(a.starts_at))}</strong><span>${esc(timeOnly(a.starts_at))}</span><small>${recurring?'Reserva recorrente':'Reserva'} · pagamento até ${esc(dt(a.payment_deadline_at||a.reserved_until))} · ${esc(money(a.amount_cents))}</small></div><div class="patient-consult-actions"><span class="patient-consult-status pending">Aguardando pagamento</span><button type="button" data-rec-pay="pix" data-id="${a.id}">Pagar Pix</button><button type="button" data-rec-pay="card" data-id="${a.id}">Pagar cartão</button></div></article>`
  }
  const awaiting=a.workflow_state==='awaiting_reschedule'
  const canReschedule=!awaiting&&a.status==='confirmed'&&daysUntil(a.starts_at)>1
  return `<article class="patient-consult-row"><div><strong>${esc(dateLong(a.starts_at))}</strong><span>${esc(timeOnly(a.starts_at))}</span>${awaiting?'<small>Seu pagamento continua válido. A profissional entrará em contato para definir um novo horário.</small>':''}</div><div class="patient-consult-actions"><span class="patient-consult-status ${awaiting?'awaiting':'confirmed'}">${awaiting?'Aguardando reagendamento':'Confirmada'}</span>${canReschedule?`<button type="button" data-patient-reschedule="${a.id}">Reagendar</button>`:''}</div></article>`
}

function historyRow(a:any){
  const cancelled=a.status==='cancelled'
  const note=cancelled?(a.workflow_state==='payment_deadline_missed'?'Pagamento não realizado até o prazo.':a.workflow_state==='admin_cancelled'?'Cancelada pela profissional.':(a.cancellation_reason||'Consulta cancelada.')):''
  return `<article class="patient-consult-row"><div><strong>${esc(dateLong(a.starts_at))}</strong><span>${esc(timeOnly(a.starts_at))}</span>${note?`<small>${esc(note)}</small>`:''}</div><div class="patient-consult-actions"><span class="patient-consult-status ${cancelled?'cancelled':'confirmed'}">${cancelled?'Cancelada':'Confirmada'}</span></div></article>`
}

let sessionRenderBusy=false
async function renderReliablePatientSessions(){
  if(sessionRenderBusy)return
  const title=document.querySelector<HTMLElement>('.patient-page-title')
  if(!title||!/^Minhas (consultas|sessões)$/i.test((title.textContent||'').trim()))return
  const panels=[...document.querySelectorAll<HTMLElement>('.patient-section-content .patient-panel')]
  const first=panels[0],historyPanel=panels[1]
  if(!first)return
  sessionRenderBusy=true
  try{
    const data=await api('/api/appointments/mine'),all:any[]=data.appointments||[],now=Date.now()
    const future=all.filter(a=>new Date(a.ends_at||a.starts_at).getTime()>=now&&['confirmed','pending_payment'].includes(a.status)).sort((a,b)=>new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime())
    const history=all.filter(a=>a.status==='cancelled'||(a.status==='confirmed'&&new Date(a.ends_at||a.starts_at).getTime()<now)).sort((a,b)=>new Date(b.starts_at).getTime()-new Date(a.starts_at).getTime())
    const key=JSON.stringify(future.map(a=>[a.id,a.status,a.workflow_state,a.reservation_kind,a.starts_at,a.payment_deadline_at,a.reserved_until]))
    if(first.dataset.patientFlowKey!==key||first.dataset.finalPatientSessions!=='1'){
      first.dataset.patientFlowKey=key
      first.dataset.finalPatientSessions='1'
      first.innerHTML=`<div class="patient-panel-head"><strong>Próxima sessão</strong><small>Reservas aguardam pagamento até o prazo informado</small></div>${future.length?future.map(a=>sessionRow(a)).join(''):'<p class="patient-empty">Você não possui sessão futura confirmada.</p>'}`
    }
    if(historyPanel){
      const historyKey=JSON.stringify(history.map(a=>[a.id,a.status,a.workflow_state,a.starts_at,a.cancellation_reason]))
      if(historyPanel.dataset.patientHistoryKey!==historyKey||historyPanel.dataset.finalPatientHistory!=='1'){
        historyPanel.dataset.patientHistoryKey=historyKey
        historyPanel.dataset.finalPatientHistory='1'
        historyPanel.innerHTML=`<div class="patient-panel-head"><strong>Histórico</strong><small>Sessões anteriores e reservas canceladas</small></div>${history.length?history.map(historyRow).join(''):'<p class="patient-empty">Ainda não há sessões anteriores no seu histórico.</p>'}`
      }
    }
    first.querySelectorAll<HTMLButtonElement>('[data-patient-reschedule]').forEach(btn=>{if(btn.dataset.bound==='1')return;btn.dataset.bound='1';btn.addEventListener('click',()=>{sessionStorage.setItem('ps_reschedule_appointment',String(btn.dataset.patientReschedule));document.querySelector<HTMLButtonElement>('[data-patient-tab="agenda"]')?.click()})})
  }catch{}finally{sessionRenderBusy=false}
}

function installCaptureFlow(){
  document.addEventListener('click',async event=>{
    const target=event.target as HTMLElement
    const reserve=target.closest<HTMLButtonElement>('[data-reserve]')
    const rescheduleId=Number(sessionStorage.getItem('ps_reschedule_appointment')||0)
    if(reserve&&rescheduleId){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation()
      const selected=document.querySelector<HTMLButtonElement>('.patient-slot.selected[data-slot-id]')
      if(!selected)return
      reserve.disabled=true
      try{
        await api(`/api/appointments/${rescheduleId}/reschedule`,{method:'POST',body:JSON.stringify({slot_id:Number(selected.dataset.slotId)})})
        openSessions('Sessão reagendada com sucesso. Nenhum novo pagamento foi necessário.')
      }catch(e){alert(e instanceof Error?e.message:'Não foi possível reagendar.');reserve.disabled=false}
      return
    }

    const recurring=target.closest<HTMLButtonElement>('[data-rec-pay]')
    if(recurring){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation()
      const appointmentId=Number(recurring.dataset.id||0);if(!appointmentId)return
      const method=recurring.dataset.recPay as 'pix'|'card'
      recurring.disabled=true
      try{
        const result=await api('/api/payments/checkout',{method:'POST',body:JSON.stringify({appointment_id:appointmentId,method})})
        if(method==='pix'&&(result.pix_qr_code||result.pix_copy_paste))showPix(result,appointmentId)
        else if(result.checkout_url)window.location.href=result.checkout_url
      }catch(e){alert(e instanceof Error?e.message:'Não foi possível iniciar o pagamento.')}finally{recurring.disabled=false}
      return
    }

    const pix=target.closest<HTMLButtonElement>('[data-pay="pix"]')
    if(pix&&!rescheduleId){
      const appointmentId=Number(sessionStorage.getItem('ps_last_held_appointment')||0)
      if(!appointmentId)return
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation()
      pix.disabled=true
      try{
        const result=await api('/api/payments/checkout',{method:'POST',body:JSON.stringify({appointment_id:appointmentId,method:'pix'})})
        if(result.pix_qr_code||result.pix_copy_paste)showPix(result,appointmentId)
        else if(result.checkout_url)window.location.href=result.checkout_url
      }catch(e){alert(e instanceof Error?e.message:'Não foi possível iniciar o Pix.')}finally{pix.disabled=false}
    }
  },true)
}

export function installPatientFlowHotfix(){
  patchFetchReservationTracking()
  installCaptureFlow()
  const run=()=>{patchRescheduleAgenda();void renderReliablePatientSessions()}
  ;[50,150,350,700,1300,2200].forEach(ms=>setTimeout(run,ms))
  let timer=0
  const observer=new MutationObserver(records=>{
    const relevant=records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node instanceof HTMLElement&&(node.matches('.patient-stable-view,.patient-section-content,.patient-panel,.patient-booking-box')||Boolean(node.querySelector?.('.patient-stable-view,.patient-section-content,.patient-panel,.patient-booking-box')))))
    if(!relevant)return
    window.clearTimeout(timer);timer=window.setTimeout(run,25)
  })
  observer.observe(document.body,{childList:true,subtree:true})
  document.addEventListener('click',event=>{const target=event.target as HTMLElement|null;if(target?.closest('[data-patient-tab="consultas"]'))window.setTimeout(run,25)},true)
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)run()})
  window.addEventListener('pageshow',run)
}
