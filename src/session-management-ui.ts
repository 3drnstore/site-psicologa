import './session-management-ui.css'

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))
const dt=(v:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v))
const dateLong=(v:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(v))
const money=(c:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(c)||0)/100)
async function api(path:string,init?:RequestInit){const r=await fetch(path,{credentials:'include',cache:'no-store',headers:{'content-type':'application/json',...(init?.headers||{})},...init});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível concluir.');return d}

function showPix(result:any){
  const overlay=document.createElement('div');overlay.className='session-modal-overlay';overlay.innerHTML=`<div class="session-modal pix-modal"><h2>Pagamento por Pix</h2><p>Use o QR Code ou o código copia e cola. A cobrança respeita o prazo da sua reserva recorrente.</p>${result.pix_qr_code?`<img src="${esc(result.pix_qr_code)}" alt="QR Code Pix">`:''}${result.pix_copy_paste?`<label>Pix copia e cola<textarea readonly rows="4">${esc(result.pix_copy_paste)}</textarea></label>`:''}<div><button type="button" data-copy ${result.pix_copy_paste?'':'disabled'}>Copiar código</button><button type="button" data-close>Fechar</button></div></div>`;document.body.appendChild(overlay)
  overlay.querySelector('[data-close]')?.addEventListener('click',()=>overlay.remove())
  overlay.querySelector<HTMLButtonElement>('[data-copy]')?.addEventListener('click',async()=>{if(!result.pix_copy_paste)return;await navigator.clipboard.writeText(String(result.pix_copy_paste));alert('Código Pix copiado.')})
}

let patientBusy=false
async function enhancePatientSessions(){
  if(patientBusy)return
  const title=document.querySelector<HTMLElement>('.patient-page-title')
  if(!title||!/^Minhas (consultas|sessões)$/i.test((title.textContent||'').trim()))return
  const panels=[...document.querySelectorAll<HTMLElement>('.patient-section-content .patient-panel')];if(!panels.length)return
  const first=panels[0];if(first.dataset.sessionManagement==='loading'||first.dataset.sessionManagement==='1')return
  first.dataset.sessionManagement='loading';patientBusy=true
  try{
    const data=await api('/api/appointments/mine'),all:any[]=data.appointments||[],now=Date.now()
    const future=all.filter(a=>new Date(a.ends_at||a.starts_at).getTime()>=now&&(['confirmed','pending_payment'].includes(a.status))).sort((a,b)=>new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime())
    const rows=future.map(a=>{
      if(a.status==='pending_payment'&&a.reservation_kind==='recurring'){
        return `<article class="patient-session-manage-row recurring"><div><strong>${esc(dateLong(a.starts_at))}</strong><span>Reserva recorrente</span><small>Pagamento até ${esc(dt(a.payment_deadline_at||a.reserved_until))} · ${esc(money(a.amount_cents))}</small></div><div class="patient-session-actions"><button type="button" data-rec-pay="pix" data-id="${a.id}">Pagar Pix</button><button type="button" data-rec-pay="card" data-id="${a.id}">Pagar cartão</button></div></article>`
      }
      const awaiting=a.workflow_state==='awaiting_reschedule',canReschedule=!awaiting&&new Date(a.starts_at).getTime()-now>=24*3600000
      return `<article class="patient-session-manage-row"><div><strong>${esc(dateLong(a.starts_at))}</strong><span>${awaiting?'Aguardando reagendamento pela profissional':'Confirmada'}</span>${awaiting?'<small>Seu pagamento continua válido. A profissional entrará em contato.</small>':''}</div><div class="patient-session-actions">${canReschedule?`<button type="button" data-patient-reschedule="${a.id}">Reagendar</button>`:!awaiting?'<small>Reagendamento online disponível até 24h antes.</small>':''}</div></article>`
    }).join('')
    first.innerHTML=`<div class="patient-panel-head"><strong>Próxima sessão</strong><small>Sessões confirmadas e reservas recorrentes</small></div>${rows||'<p class="patient-empty">Você não possui sessão futura confirmada.</p>'}`
    first.dataset.sessionManagement='1'
    first.querySelectorAll<HTMLButtonElement>('[data-patient-reschedule]').forEach(btn=>btn.addEventListener('click',()=>{sessionStorage.setItem('ps_reschedule_appointment',String(btn.dataset.patientReschedule));document.querySelector<HTMLButtonElement>('[data-patient-tab="agenda"]')?.click()}))
    first.querySelectorAll<HTMLButtonElement>('[data-rec-pay]').forEach(btn=>btn.addEventListener('click',async()=>{btn.disabled=true;try{const r=await api('/api/payments/checkout',{method:'POST',body:JSON.stringify({appointment_id:Number(btn.dataset.id),method:btn.dataset.recPay})});if(btn.dataset.recPay==='pix'&&(r.pix_qr_code||r.pix_copy_paste))showPix(r);else if(r.checkout_url)window.location.href=r.checkout_url;else alert('Pagamento iniciado. Aguarde a confirmação.')}catch(e){alert(e instanceof Error?e.message:'Não foi possível iniciar o pagamento.')}finally{btn.disabled=false}}))
  }catch{}finally{patientBusy=false}
}

function enhancePatientAgendaReschedule(){
  const appointmentId=Number(sessionStorage.getItem('ps_reschedule_appointment')||0);if(!appointmentId)return
  const box=document.querySelector<HTMLElement>('.patient-booking-box');if(!box)return
  const info=box.querySelector<HTMLElement>('.patient-booking-info');if(info)info.innerHTML='<p><strong>Reagendamento sem nova cobrança.</strong></p><p>Escolha o novo horário. O pagamento da sessão atual continuará válido.</p>'
  const original=box.querySelector<HTMLButtonElement>('[data-reserve]');if(!original||original.dataset.reschedulePatched==='1')return
  const button=original.cloneNode(true) as HTMLButtonElement;button.dataset.reschedulePatched='1';button.textContent='Confirmar reagendamento';original.replaceWith(button)
  button.addEventListener('click',async()=>{const selected=document.querySelector<HTMLButtonElement>('.patient-slot.selected[data-slot-id]');if(!selected)return;button.disabled=true;try{await api(`/api/appointments/${appointmentId}/reschedule`,{method:'POST',body:JSON.stringify({slot_id:Number(selected.dataset.slotId)})});sessionStorage.removeItem('ps_reschedule_appointment');alert('Sessão reagendada com sucesso.');document.querySelector<HTMLButtonElement>('[data-patient-tab="consultas"]')?.click()}catch(e){alert(e instanceof Error?e.message:'Não foi possível reagendar.');button.disabled=false}})
}

let adminBusy=false
async function enhanceAdminSessions(){
  if(adminBusy)return
  const title=(document.querySelector<HTMLElement>('.admin-topbar h1')?.textContent||'').trim();if(!['Sessões','Consultas'].includes(title))return
  const host=document.querySelector<HTMLElement>('.admin-consultations-v2');if(!host)return
  const active=host.querySelector<HTMLButtonElement>('[data-filter].active')?.dataset.filter;if(active&&active!=='confirmed')return
  const rows=[...host.querySelectorAll<HTMLElement>('.admin-table-row:not(.header)')];if(!rows.length||rows.every(r=>r.dataset.sessionActions==='1'))return
  adminBusy=true
  try{
    const data=await api('/api/admin/session-management/appointments'),all:any[]=data.appointments||[],start=new Date();start.setHours(0,0,0,0);const day=(start.getDay()+6)%7;start.setDate(start.getDate()-day);const end=new Date(start);end.setDate(end.getDate()+14);end.setMilliseconds(-1)
    const list=all.filter(a=>a.status==='confirmed'&&new Date(a.starts_at)>=start&&new Date(a.starts_at)<=end).sort((a,b)=>new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime())
    rows.forEach((row,index)=>{const a=list[index];if(!a)return;row.dataset.sessionActions='1';const target=row.lastElementChild as HTMLElement|null;if(!target)return;const wrap=document.createElement('div');wrap.className='session-admin-actions';wrap.innerHTML=`<button type="button" data-admin-reschedule>Reagendar</button><button type="button" data-admin-recurrence>Recorrência</button>`;target.appendChild(wrap);wrap.querySelector<HTMLButtonElement>('[data-admin-reschedule]')?.addEventListener('click',()=>void openAdminReschedule(a));wrap.querySelector<HTMLButtonElement>('[data-admin-recurrence]')?.addEventListener('click',()=>void configureRecurrence(a))})
  }catch{}finally{adminBusy=false}
}

async function openAdminReschedule(a:any){
  const from=new Date(),to=new Date(Date.now()+60*86400000),data=await api(`/api/admin/availability-v2?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),slots=(data.slots||[]).filter((s:any)=>s.status==='free').slice(0,250)
  if(!slots.length){alert('Não há horários livres nos próximos 60 dias.');return}
  const overlay=document.createElement('div');overlay.className='session-modal-overlay';overlay.innerHTML=`<div class="session-modal"><h2>Reagendar sessão</h2><p>${esc(a.full_name)} · ${esc(dt(a.starts_at))}</p><label>Novo horário<select data-slot>${slots.map((s:any)=>`<option value="${s.id}">${esc(dt(s.starts_at))}</option>`).join('')}</select></label><label>Justificativa ao paciente (opcional)<textarea data-reason rows="4"></textarea></label><div><button type="button" data-close>Cancelar</button><button type="button" data-confirm>Confirmar reagendamento</button></div></div>`;document.body.appendChild(overlay)
  overlay.querySelector('[data-close]')?.addEventListener('click',()=>overlay.remove())
  overlay.querySelector<HTMLButtonElement>('[data-confirm]')?.addEventListener('click',async()=>{const btn=overlay.querySelector<HTMLButtonElement>('[data-confirm]')!;btn.disabled=true;try{await api(`/api/admin/appointments/${a.id}/reschedule`,{method:'POST',body:JSON.stringify({slot_id:Number(overlay.querySelector<HTMLSelectElement>('[data-slot]')?.value),reason:overlay.querySelector<HTMLTextAreaElement>('[data-reason]')?.value||''})});overlay.remove();alert('Sessão reagendada e paciente notificado.');window.location.reload()}catch(e){alert(e instanceof Error?e.message:'Não foi possível reagendar.');btn.disabled=false}})
}

async function configureRecurrence(a:any){
  const answer=prompt('Recorrência deste paciente:\n1 = Semanal\n2 = Quinzenal\n0 = Desativar recorrência','1');if(answer===null)return
  if(answer==='0'){await api(`/api/admin/patients/${a.patient_id}/recurrence`,{method:'DELETE'});alert('Recorrência desativada.');return}
  const cadence=answer==='2'?14:7;await api(`/api/admin/patients/${a.patient_id}/recurrence`,{method:'PUT',body:JSON.stringify({cadence_days:cadence,source_appointment_id:a.id})});alert(cadence===7?'Paciente configurado como semanal. A próxima reserva foi criada.':'Paciente configurado como quinzenal. A próxima reserva foi criada.')
}

function localYmd(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function enhanceCancelDay(){
  const title=(document.querySelector<HTMLElement>('.admin-topbar h1')?.textContent||'').trim();if(title!=='Agenda')return
  const actions=document.querySelector<HTMLElement>('.agenda-actions');if(!actions||actions.querySelector('[data-cancel-day]'))return
  const button=document.createElement('button');button.type='button';button.dataset.cancelDay='1';button.className='admin-cancel-day';button.textContent='Cancelar agenda do dia';actions.appendChild(button)
  button.addEventListener('click',async()=>{const date=prompt('Qual dia da agenda precisa ser cancelado? Use AAAA-MM-DD.',localYmd());if(!date)return;const reason=prompt('Informe o motivo para os pacientes, ou deixe em branco para não informar.','')??'';if(!confirm(`Cancelar a agenda de ${date}? Os pacientes confirmados serão avisados e ficarão aguardando reagendamento.`))return;button.disabled=true;try{const r=await api('/api/admin/agenda/cancel-day',{method:'POST',body:JSON.stringify({date,reason})});alert(`Agenda cancelada. ${r.affected} paciente(s) confirmado(s) afetado(s).`);window.location.reload()}catch(e){alert(e instanceof Error?e.message:'Não foi possível cancelar a agenda.');button.disabled=false}})
}

export function installSessionManagementUi(){
  const run=()=>{void enhancePatientSessions();enhancePatientAgendaReschedule();void enhanceAdminSessions();enhanceCancelDay()}
  ;[100,350,800,1500].forEach(ms=>setTimeout(run,ms));const root=document.getElementById('root');if(root)new MutationObserver(()=>setTimeout(run,40)).observe(root,{childList:true,subtree:true})
  document.addEventListener('click',e=>{const btn=(e.target as HTMLElement).closest<HTMLElement>('[data-patient-tab]');if(btn&&btn.dataset.patientTab!=='agenda'&&btn.dataset.patientTab!=='consultas')sessionStorage.removeItem('ps_reschedule_appointment')})
}
