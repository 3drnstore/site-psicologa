import './session-management-ui.css'

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))
const dt=(v:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v))
async function api(path:string,init?:RequestInit){const r=await fetch(path,{credentials:'include',cache:'no-store',headers:{'content-type':'application/json',...(init?.headers||{})},...init});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível concluir.');return d}

let adminBusy=false
async function enhanceAdminSessions(){
  if(adminBusy)return
  const title=(document.querySelector<HTMLElement>('.admin-topbar h1')?.textContent||'').trim();if(!['Sessões','Consultas'].includes(title))return
  const host=document.querySelector<HTMLElement>('.admin-consultations-v2');if(!host)return
  const active=host.querySelector<HTMLButtonElement>('[data-filter].active')?.dataset.filter;if(active&&active!=='confirmed')return
  const rows=[...host.querySelectorAll<HTMLElement>('.admin-table-row:not(.header)')];if(!rows.length)return
  adminBusy=true
  try{
    const data=await api('/api/admin/session-management/appointments'),all:any[]=data.appointments||[],start=new Date();start.setHours(0,0,0,0);const day=(start.getDay()+6)%7;start.setDate(start.getDate()-day);const end=new Date(start);end.setDate(end.getDate()+14);end.setMilliseconds(-1)
    const list=all.filter(a=>a.status==='confirmed'&&new Date(a.starts_at)>=start&&new Date(a.starts_at)<=end).sort((a,b)=>new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime())
    rows.forEach((row,index)=>{const a=list[index];if(!a||row.dataset.sessionActions==='1')return;row.dataset.sessionActions='1';const target=row.lastElementChild as HTMLElement|null;if(!target)return;if(a.workflow_state==='awaiting_reschedule'){const chip=target.querySelector<HTMLElement>('.admin-status-chip');if(chip){chip.textContent='Aguardando reagendamento';chip.classList.remove('confirmed');chip.classList.add('pending')}}const wrap=document.createElement('div');wrap.className='session-admin-actions';wrap.innerHTML='<button type="button" data-admin-reschedule>Reagendar</button>';target.appendChild(wrap);wrap.querySelector<HTMLButtonElement>('[data-admin-reschedule]')?.addEventListener('click',()=>void openAdminReschedule(a))})
  }catch{}finally{adminBusy=false}
}

async function openAdminReschedule(a:any){
  const from=new Date(),to=new Date(Date.now()+60*86400000),data=await api(`/api/admin/availability-v2?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),slots=(data.slots||[]).filter((s:any)=>s.status==='free').slice(0,250)
  if(!slots.length){alert('Não há horários livres nos próximos 60 dias.');return}
  const overlay=document.createElement('div');overlay.className='session-modal-overlay';overlay.innerHTML=`<div class="session-modal"><h2>Reagendar sessão</h2><p>${esc(a.full_name)} · ${esc(dt(a.starts_at))}</p><label>Novo horário<select data-slot>${slots.map((s:any)=>`<option value="${s.id}">${esc(dt(s.starts_at))}</option>`).join('')}</select></label><label>Justificativa ao paciente (opcional)<textarea data-reason rows="4"></textarea></label><div><button type="button" data-close>Cancelar</button><button type="button" data-confirm>Confirmar reagendamento</button></div></div>`;document.body.appendChild(overlay)
  overlay.querySelector('[data-close]')?.addEventListener('click',()=>overlay.remove())
  overlay.querySelector<HTMLButtonElement>('[data-confirm]')?.addEventListener('click',async()=>{const btn=overlay.querySelector<HTMLButtonElement>('[data-confirm]')!;btn.disabled=true;try{await api(`/api/admin/appointments/${a.id}/reschedule`,{method:'POST',body:JSON.stringify({slot_id:Number(overlay.querySelector<HTMLSelectElement>('[data-slot]')?.value),reason:overlay.querySelector<HTMLTextAreaElement>('[data-reason]')?.value||''})});overlay.remove();alert('Sessão reagendada e paciente notificado.');window.location.reload()}catch(e){alert(e instanceof Error?e.message:'Não foi possível reagendar.');btn.disabled=false}})
}

function localBrDate(d=new Date()){return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(-2)}`}
function brDateToYmd(value:string){
  const match=value.trim().match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);if(!match)return null
  const day=Number(match[1]),month=Number(match[2]),rawYear=match[3],year=rawYear.length===2?2000+Number(rawYear):Number(rawYear)
  const test=new Date(year,month-1,day)
  if(test.getFullYear()!==year||test.getMonth()!==month-1||test.getDate()!==day)return null
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}
function enhanceCancelDay(){
  const title=(document.querySelector<HTMLElement>('.admin-topbar h1')?.textContent||'').trim();if(title!=='Agenda')return
  const actions=document.querySelector<HTMLElement>('.agenda-actions');if(!actions)return
  const stateButtons=actions.querySelector<HTMLElement>('.agenda-state-buttons');if(!stateButtons||stateButtons.querySelector('[data-cancel-day]'))return
  const button=document.createElement('button');button.type='button';button.dataset.cancelDay='1';button.className='admin-cancel-day';button.textContent='Cancelar agenda do dia';stateButtons.appendChild(button)
  button.addEventListener('click',async()=>{const entered=prompt('Qual dia da agenda precisa ser cancelado? Use DD/MM/AA ou DD/MM/AAAA.',localBrDate());if(!entered)return;const date=brDateToYmd(entered);if(!date){alert('Data inválida. Informe no formato DD/MM/AA ou DD/MM/AAAA, por exemplo 14/09/26 ou 14/09/2026.');return}const reason=prompt('Informe o motivo para os pacientes, ou deixe em branco para não informar.','')??'';if(!confirm(`Cancelar a agenda de ${entered.trim()}? Os pacientes confirmados serão avisados e ficarão aguardando reagendamento.`))return;button.disabled=true;try{const r=await api('/api/admin/agenda/cancel-day',{method:'POST',body:JSON.stringify({date,reason})});alert(`Agenda cancelada. ${r.affected} paciente(s) confirmado(s) afetado(s).`);window.location.reload()}catch(e){alert(e instanceof Error?e.message:'Não foi possível cancelar a agenda.');button.disabled=false}})
}

export function installSessionManagementUi(){
  const run=()=>{void enhanceAdminSessions();enhanceCancelDay()}
  ;[100,350,800,1500].forEach(ms=>setTimeout(run,ms));const root=document.getElementById('root');if(root)new MutationObserver(()=>setTimeout(run,40)).observe(root,{childList:true,subtree:true})
}
