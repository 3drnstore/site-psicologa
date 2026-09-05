import './admin-consultations-v2.css'
import './admin-navigation-patients-enhancer'

type Appointment={id:number;status:string;starts_at:string;ends_at:string;full_name:string;email:string;phone?:string|null;workflow_state?:string|null}
type Filter='confirmed'|'pending_payment'|'cancelled'|'expired'
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;' }[c]||c))
const dt=(v:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v))
const tm=(v:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(v))
const label=(s:string)=>s==='confirmed'?'Confirmada':s==='pending_payment'?'Pendente':s==='cancelled'?'Cancelada':s==='expired'?'Expirada':s
const waPhone=(v:unknown)=>{const digits=String(v??'').replace(/\D/g,'');if(!digits)return '';return digits.startsWith('55')?digits:`55${digits}`}
const communicationActions=(a:Appointment)=>{
  if(a.status!=='confirmed')return '—'
  const phone=waPhone(a.phone),email=String(a.email||'').trim()
  return `<span class="admin-consult-contact">${phone?`<a href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`:''}${email?`<a href="mailto:${esc(email)}">E-mail</a>`:''}</span>`
}
const managementActions=(a:Appointment)=>a.status==='confirmed'?`<span class="admin-consult-actions"><button type="button" class="admin-consult-reschedule" data-reschedule-id="${a.id}">Reagendar</button><button type="button" class="admin-consult-cancel" data-cancel-id="${a.id}">Cancelar consulta</button></span>`:'—'

function startOfWeek(date=new Date()){const d=new Date(date);const day=(d.getDay()+6)%7;d.setHours(0,0,0,0);d.setDate(d.getDate()-day);return d}
function endOfNextWeek(){const d=startOfWeek();d.setDate(d.getDate()+14);d.setMilliseconds(-1);return d}
async function appointments(){const r=await fetch('/api/admin/appointments',{credentials:'include',cache:'no-store'});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível carregar as sessões.');return (d.appointments||[]) as Appointment[]}
async function api(path:string,init?:RequestInit){const r=await fetch(path,{credentials:'include',cache:'no-store',headers:{'content-type':'application/json',...(init?.headers||{})},...init});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível concluir.');return d}

async function openAdminReschedule(a:Appointment){
  const from=new Date(),to=new Date(Date.now()+60*86400000)
  const data=await api(`/api/admin/availability-v2?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)
  const slots=(data.slots||[]).filter((s:any)=>s.status==='free').slice(0,250)
  if(!slots.length){alert('Não há horários livres nos próximos 60 dias.');return}
  const overlay=document.createElement('div');overlay.className='session-modal-overlay';overlay.innerHTML=`<div class="session-modal"><h2>Reagendar sessão</h2><p>${esc(a.full_name)} · ${esc(dt(a.starts_at))}</p><label>Novo horário<select data-slot>${slots.map((s:any)=>`<option value="${s.id}">${esc(dt(s.starts_at))}</option>`).join('')}</select></label><label>Justificativa ao paciente (opcional)<textarea data-reason rows="4"></textarea></label><div><button type="button" data-close>Cancelar</button><button type="button" data-confirm>Confirmar reagendamento</button></div></div>`;document.body.appendChild(overlay)
  overlay.querySelector('[data-close]')?.addEventListener('click',()=>overlay.remove())
  overlay.querySelector<HTMLButtonElement>('[data-confirm]')?.addEventListener('click',async()=>{const btn=overlay.querySelector<HTMLButtonElement>('[data-confirm]')!;btn.disabled=true;try{await api(`/api/admin/appointments/${a.id}/reschedule`,{method:'POST',body:JSON.stringify({slot_id:Number(overlay.querySelector<HTMLSelectElement>('[data-slot]')?.value),reason:overlay.querySelector<HTMLTextAreaElement>('[data-reason]')?.value||''})});overlay.remove();alert('Sessão reagendada e paciente notificado.');window.location.reload()}catch(e){alert(e instanceof Error?e.message:'Não foi possível reagendar.');btn.disabled=false}})
}

async function cancelAppointment(a:Appointment,button:HTMLButtonElement){
  if(a.status!=='confirmed'||button.disabled)return false
  if(!window.confirm(`Cancelar a consulta de ${a.full_name}? O horário será liberado.`))return false
  const reason=window.prompt('Motivo do cancelamento (opcional):','')||''
  button.disabled=true;const original=button.textContent||'Cancelar consulta';button.textContent='Cancelando...'
  try{
    const r=await fetch(`/api/admin/appointments/${a.id}/cancel`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({reason})})
    const d=await r.json().catch(()=>({})) as any
    if(!r.ok)throw new Error(d.message||'Não foi possível cancelar a consulta.')
    a.status='cancelled';a.workflow_state='admin_cancelled'
    alert('Consulta cancelada. O horário foi liberado e o paciente foi notificado.')
    return true
  }catch(error){alert(error instanceof Error?error.message:'Não foi possível cancelar a consulta.');button.disabled=false;button.textContent=original;return false}
}

let busy=false,lastHost:HTMLElement|null=null
async function enhance(){
  if(busy)return
  const title=(document.querySelector<HTMLElement>('.admin-topbar h1')?.textContent||'').trim();if(!['Consultas','Sessões'].includes(title))return
  const host=document.querySelector<HTMLElement>('.admin-custom-view');if(!host||host===lastHost&&host.dataset.consultV2==='1')return
  busy=true
  try{
    const all=await appointments();if(!host.isConnected)return
    lastHost=host;host.dataset.consultV2='1';host.classList.add('admin-consultations-v2')
    const weekStart=startOfWeek(),weekEnd=endOfNextWeek()
    let active:Filter='confirmed'
    const render=()=>{
      const counts:{[K in Filter]:number}={confirmed:all.filter(a=>a.status==='confirmed'&&new Date(a.starts_at)>=weekStart&&new Date(a.starts_at)<=weekEnd).length,pending_payment:all.filter(a=>a.status==='pending_payment').length,cancelled:all.filter(a=>a.status==='cancelled').length,expired:all.filter(a=>a.status==='expired').length}
      const list=all.filter(a=>active==='confirmed'?a.status==='confirmed'&&new Date(a.starts_at)>=weekStart&&new Date(a.starts_at)<=weekEnd:a.status===active).sort((a,b)=>active==='confirmed'?new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime():new Date(b.starts_at).getTime()-new Date(a.starts_at).getTime())
      host.innerHTML=`<div class="admin-consult-filter" role="tablist" aria-label="Filtrar sessões"><button data-filter="confirmed" class="${active==='confirmed'?'active':''}">Confirmado <span>${counts.confirmed}</span></button><button data-filter="pending_payment" class="${active==='pending_payment'?'active':''}">Pendente <span>${counts.pending_payment}</span></button><button data-filter="cancelled" class="${active==='cancelled'?'active':''}">Cancelado <span>${counts.cancelled}</span></button><button data-filter="expired" class="${active==='expired'?'active':''}">Expirado <span>${counts.expired}</span></button></div>${active==='confirmed'?`<div class="admin-consult-period"><strong>Sessões ativas desta semana e da próxima</strong><span>${weekStart.toLocaleDateString('pt-BR')} a ${weekEnd.toLocaleDateString('pt-BR')}</span></div>`:''}<section class="admin-table-card"><div class="admin-table-row header"><span>Paciente</span><span>Data e horário</span><span>Status</span><span>Comunicação</span><span>Ações</span></div>${list.length?list.map(a=>`<div class="admin-table-row" data-session-actions="1"><div><strong>${esc(a.full_name)}</strong><small>${esc(a.email)}</small></div><div><strong>${esc(dt(a.starts_at))}</strong><small>até ${esc(tm(a.ends_at))}</small></div><div class="admin-consult-status"><span class="admin-status-chip ${esc(a.status)}">${esc(label(a.status))}</span></div><div class="admin-consult-communication">${communicationActions(a)}</div><div class="admin-consult-management">${managementActions(a)}</div></div>`).join(''):`<div class="admin-consultations-empty">Nenhuma sessão nesta categoria.</div>`}</section>`
      host.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(btn=>btn.addEventListener('click',()=>{active=btn.dataset.filter as Filter;render()}))
      host.querySelectorAll<HTMLButtonElement>('[data-reschedule-id]').forEach(btn=>btn.addEventListener('click',()=>{const a=all.find(item=>item.id===Number(btn.dataset.rescheduleId));if(a)void openAdminReschedule(a)}))
      host.querySelectorAll<HTMLButtonElement>('[data-cancel-id]').forEach(btn=>btn.addEventListener('click',async()=>{const a=all.find(item=>item.id===Number(btn.dataset.cancelId));if(!a)return;if(await cancelAppointment(a,btn))render()}))
    }
    render()
  }catch(e){host.innerHTML=`<div class="error-box">${esc(e instanceof Error?e.message:'Não foi possível carregar as sessões.')}</div>`}finally{busy=false}
}
export function installAdminConsultationsV2(){const run=()=>void enhance();[0,120,350,800].forEach(ms=>setTimeout(run,ms));const root=document.getElementById('root');if(root)new MutationObserver(()=>run()).observe(root,{childList:true,subtree:true})}
