import './admin-consultations-v2.css'

type Appointment={id:number;status:string;starts_at:string;ends_at:string;full_name:string;email:string;phone?:string|null}
type Filter='confirmed'|'pending_payment'|'cancelled'|'expired'
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]||c))
const dt=(v:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v))
const tm=(v:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(v))
const label=(s:string)=>s==='confirmed'?'Confirmada':s==='pending_payment'?'Pendente':s==='cancelled'?'Cancelada':s==='expired'?'Expirada':s
const waPhone=(v:unknown)=>{const digits=String(v??'').replace(/\D/g,'');if(!digits)return '';return digits.startsWith('55')?digits:`55${digits}`}
const contactActions=(a:Appointment)=>{
  if(a.status!=='confirmed')return ''
  const phone=waPhone(a.phone),email=String(a.email||'').trim()
  return `<span class="admin-consult-contact">${phone?`<a href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`:''}${email?`<a href="mailto:${esc(email)}">E-mail</a>`:''}</span>`
}

function startOfWeek(date=new Date()){const d=new Date(date);const day=(d.getDay()+6)%7;d.setHours(0,0,0,0);d.setDate(d.getDate()-day);return d}
function endOfNextWeek(){const d=startOfWeek();d.setDate(d.getDate()+14);d.setMilliseconds(-1);return d}
async function appointments(){const r=await fetch('/api/admin/appointments',{credentials:'include',cache:'no-store'});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível carregar as consultas.');return (d.appointments||[]) as Appointment[]}

let busy=false,lastHost:HTMLElement|null=null
async function enhance(){
  if(busy)return
  const title=(document.querySelector<HTMLElement>('.admin-topbar h1')?.textContent||'').trim();if(title!=='Consultas')return
  const host=document.querySelector<HTMLElement>('.admin-custom-view');if(!host||host===lastHost&&host.dataset.consultV2==='1')return
  busy=true
  try{
    const all=await appointments();if(!host.isConnected)return
    lastHost=host;host.dataset.consultV2='1';host.classList.add('admin-consultations-v2')
    const weekStart=startOfWeek(),weekEnd=endOfNextWeek()
    const counts:{[K in Filter]:number}={confirmed:all.filter(a=>a.status==='confirmed'&&new Date(a.starts_at)>=weekStart&&new Date(a.starts_at)<=weekEnd).length,pending_payment:all.filter(a=>a.status==='pending_payment').length,cancelled:all.filter(a=>a.status==='cancelled').length,expired:all.filter(a=>a.status==='expired').length}
    let active:Filter='confirmed'
    const render=()=>{
      const list=all.filter(a=>active==='confirmed'?a.status==='confirmed'&&new Date(a.starts_at)>=weekStart&&new Date(a.starts_at)<=weekEnd:a.status===active).sort((a,b)=>active==='confirmed'?new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime():new Date(b.starts_at).getTime()-new Date(a.starts_at).getTime())
      host.innerHTML=`<div class="admin-consult-filter" role="tablist" aria-label="Filtrar consultas"><button data-filter="confirmed" class="${active==='confirmed'?'active':''}">Confirmado <span>${counts.confirmed}</span></button><button data-filter="pending_payment" class="${active==='pending_payment'?'active':''}">Pendente <span>${counts.pending_payment}</span></button><button data-filter="cancelled" class="${active==='cancelled'?'active':''}">Cancelado <span>${counts.cancelled}</span></button><button data-filter="expired" class="${active==='expired'?'active':''}">Expirado <span>${counts.expired}</span></button></div>${active==='confirmed'?`<div class="admin-consult-period"><strong>Consultas ativas desta semana e da próxima</strong><span>${weekStart.toLocaleDateString('pt-BR')} a ${weekEnd.toLocaleDateString('pt-BR')}</span></div>`:''}<section class="admin-table-card"><div class="admin-table-row header"><span>Paciente</span><span>Data e horário</span><span>Status</span></div>${list.length?list.map(a=>`<div class="admin-table-row"><div><strong>${esc(a.full_name)}</strong><small>${esc(a.email)}</small></div><div><strong>${esc(dt(a.starts_at))}</strong><small>até ${esc(tm(a.ends_at))}</small></div><div class="admin-consult-status"><span class="admin-status-chip ${esc(a.status)}">${esc(label(a.status))}</span>${contactActions(a)}</div></div>`).join(''):`<div class="admin-consultations-empty">Nenhuma consulta nesta categoria.</div>`}</section>`
      host.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(btn=>btn.addEventListener('click',()=>{active=btn.dataset.filter as Filter;render()}))
    }
    render()
  }catch(e){host.innerHTML=`<div class="error-box">${esc(e instanceof Error?e.message:'Não foi possível carregar as consultas.')}</div>`}finally{busy=false}
}
export function installAdminConsultationsV2(){const run=()=>void enhance();[0,120,350,800].forEach(ms=>setTimeout(run,ms));const root=document.getElementById('root');if(root)new MutationObserver(()=>run()).observe(root,{childList:true,subtree:true})}
