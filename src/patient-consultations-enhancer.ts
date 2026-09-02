let installed=false
let scheduled:number|undefined

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]||c))
const dateLabel=(v:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date(v))
const timeLabel=(v:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(v))

async function loadAppointments(){
  const r=await fetch('/api/appointments/mine',{credentials:'include'})
  const d=await r.json().catch(()=>({})) as any
  if(!r.ok)throw new Error(d.message||'Não foi possível carregar suas consultas.')
  return (d.appointments||[]).filter((a:any)=>a.status==='confirmed')
}

function card(a:any,kind:'upcoming'|'history'){
  const starts=String(a.starts_at||'')
  const ends=String(a.ends_at||'')
  return `<article class="patient-consultation-card ${kind}">
    <div class="patient-consultation-date"><strong>${esc(dateLabel(starts))}</strong><span>${esc(timeLabel(starts))}${ends?` às ${esc(timeLabel(ends))}`:''}</span></div>
    <span class="patient-consultation-badge">${kind==='upcoming'?'Confirmada':'Realizada'}</span>
  </article>`
}

async function rebuild(force=false){
  const page=document.querySelector<HTMLElement>('.patient-page')
  if(!page)return
  const section=page.querySelector<HTMLElement>('.my-appointments')
  if(!section||(!force&&section.dataset.consultationsEnhanced==='1'))return
  section.dataset.consultationsEnhanced='1'
  section.classList.add('patient-consultations-enhanced')
  section.innerHTML='<div class="patient-consultations-loading">Carregando suas consultas...</div>'
  try{
    const list=await loadAppointments()
    const now=Date.now()
    const upcoming=list.filter((a:any)=>new Date(a.ends_at||a.starts_at).getTime()>=now).sort((a:any,b:any)=>new Date(a.starts_at).getTime()-new Date(b.starts_at).getTime())
    const history=list.filter((a:any)=>new Date(a.ends_at||a.starts_at).getTime()<now).sort((a:any,b:any)=>new Date(b.starts_at).getTime()-new Date(a.starts_at).getTime())
    section.innerHTML=`
      <div class="patient-consultations-block">
        <div class="patient-consultations-head"><span>Próxima sessão</span><small>Consultas confirmadas após pagamento</small></div>
        ${upcoming.length?upcoming.map((a:any)=>card(a,'upcoming')).join(''):'<p class="patient-consultations-empty">Você não possui consulta futura confirmada.</p>'}
      </div>
      <div class="patient-consultations-block">
        <div class="patient-consultations-head"><span>Histórico</span><small>Sessões anteriores confirmadas</small></div>
        ${history.length?history.map((a:any)=>card(a,'history')).join(''):'<p class="patient-consultations-empty">Ainda não há sessões anteriores no seu histórico.</p>'}
      </div>`
  }catch(err){
    section.innerHTML=`<div class="patient-consultations-error">${esc(err instanceof Error?err.message:String(err))}</div>`
  }
}

function schedule(force=false){
  if(scheduled)clearTimeout(scheduled)
  scheduled=window.setTimeout(()=>{scheduled=undefined;void rebuild(force)},100)
}

function relevantMutation(records:MutationRecord[]){
  return records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>{
    if(!(node instanceof HTMLElement))return false
    return node.matches('.patient-page,.my-appointments')||Boolean(node.querySelector('.patient-page,.my-appointments'))
  }))
}

export function installPatientConsultationsEnhancer(){
  if(installed)return
  installed=true
  schedule()
  const root=document.getElementById('root')
  if(root)new MutationObserver(records=>{if(relevantMutation(records))schedule()}).observe(root,{childList:true,subtree:true})
  document.addEventListener('click',event=>{
    const target=event.target as HTMLElement|null
    const tab=target?.closest<HTMLElement>('[data-patient-tab="consultas"]')
    if(tab)schedule(true)
  },true)
  window.addEventListener('pageshow',()=>schedule(true))
}
