const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))
const money=(c:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(c)||0)/100)
const dateOnly=(v:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'short',day:'2-digit',month:'short'}).format(new Date(v))
const timeOnly=(v:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(v))
const sameDay=(a:Date,b:Date)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()
let busy=false
async function sync(){
  const title=(document.querySelector<HTMLElement>('.admin-topbar h1')?.textContent||'').trim();if(title!=='Visão geral'||busy)return
  const host=document.querySelector<HTMLElement>('.admin-custom-view');if(!host)return
  busy=true
  try{
    const r=await fetch('/api/admin/session-management/appointments',{credentials:'include',cache:'no-store'});if(!r.ok)return
    const d=await r.json().catch(()=>({})) as any,all:any[]=d.appointments||[],now=new Date()
    const active=all.filter(a=>a.status==='confirmed'&&a.workflow_state!=='awaiting_reschedule')
    const today=active.filter(a=>sameDay(new Date(a.starts_at),now))
    const kpi=host.querySelector<HTMLElement>('.admin-kpi-grid .admin-kpi:first-child strong');if(kpi)kpi.textContent=String(today.length)
    const upcoming=active.filter(a=>new Date(a.starts_at).getTime()>=Date.now()).sort((a,b)=>new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime()).slice(0,6)
    const list=host.querySelector<HTMLElement>('.admin-dashboard-list');if(list)list.innerHTML=upcoming.length?upcoming.map(a=>`<div class="admin-dashboard-row"><div class="admin-dashboard-row-main"><strong>${esc(a.full_name)}</strong><span>${esc(dateOnly(a.starts_at))} • ${esc(timeOnly(a.starts_at))}–${esc(timeOnly(a.ends_at))}</span><small>${esc(a.email)}</small></div><div class="admin-dashboard-row-side"><span class="admin-status-chip confirmed">Confirmada</span><strong>${esc(money(a.amount_cents))}</strong></div></div>`).join(''):'<div class="admin-dashboard-empty">Nenhuma sessão confirmada futura.</div>'
    const shown=host.querySelector<HTMLElement>('.admin-dashboard-card-head > span:last-child');if(shown)shown.textContent=`${upcoming.length} exibida(s)`
  }catch{}finally{busy=false}
}
export function installAdminDashboardSessionState(){const run=()=>void sync();[100,300,700,1400].forEach(ms=>setTimeout(run,ms));const root=document.getElementById('root');if(root)new MutationObserver(()=>setTimeout(run,50)).observe(root,{childList:true,subtree:true});window.addEventListener('pageshow',run)}
