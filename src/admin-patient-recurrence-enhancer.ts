import './admin-patient-recurrence-enhancer.css'

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))
const dt=(v:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v))
async function getJson(path:string,init?:RequestInit){const r=await fetch(path,{credentials:'include',cache:'no-store',headers:{'content-type':'application/json',...(init?.headers||{})},...init});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível concluir.');return d}

let installed=false
let busy=false
let scheduled=0

function selectedPatientEmail(panel:HTMLElement){
  const head=panel.querySelector<HTMLElement>('.record-head')
  const fromHead=(head?.textContent||'').match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0]
  if(fromHead)return fromHead
  const active=document.querySelector<HTMLElement>('.patient-card.active')
  return (active?.textContent||'').match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0]||''
}

function ensureVisibleBox(panel:HTMLElement,head:HTMLElement,email:string){
  let box=panel.querySelector<HTMLElement>('.patient-recurrence-admin')
  if(box&&box.dataset.patientEmail!==email.toLowerCase()){box.remove();box=null}
  if(!box){
    box=document.createElement('section')
    box.className='patient-recurrence-admin'
    box.dataset.patientEmail=email.toLowerCase()
    box.dataset.ready='0'
    box.innerHTML=`<div class="patient-recurrence-heading"><div><span class="section-kicker">Agenda do paciente</span><h3>Recorrência de sessões</h3></div></div><p>Defina se este paciente possui horário fixo. O sistema reserva somente a próxima sessão e exige o pagamento até 48h antes.</p><div class="patient-recurrence-grid"><label>Periodicidade<select data-rec-cadence disabled><option value="0">Sem recorrência</option><option value="7">Semanal</option><option value="14">Quinzenal</option></select></label><label>Sessão confirmada de referência<select data-rec-source disabled><option value="">Carregando sessões...</option></select></label><button type="button" data-rec-save disabled>Salvar recorrência</button></div><small class="patient-recurrence-status" data-rec-status>Carregando configuração de recorrência...</small>`
    head.insertAdjacentElement('afterend',box)
  }
  return box
}

async function enhance(){
  const panel=document.querySelector<HTMLElement>('.record-panel')
  const head=panel?.querySelector<HTMLElement>('.record-head')
  if(!panel||!head)return
  const email=selectedPatientEmail(panel)
  if(!email)return
  const box=ensureVisibleBox(panel,head,email)
  if(box.dataset.ready==='1'||busy)return
  busy=true
  const status=box.querySelector<HTMLElement>('[data-rec-status]')!
  try{
    status.classList.remove('error')
    status.textContent='Carregando configuração de recorrência...'
    const list=await getJson('/api/admin/patients')
    const patient=(list.patients||[]).find((p:any)=>String(p.email||'').toLowerCase()===email.toLowerCase())
    if(!patient)throw new Error('Paciente não encontrado para configurar recorrência.')
    const detail=await getJson(`/api/admin/patients/${patient.id}`)
    if(!panel.isConnected||selectedPatientEmail(panel).toLowerCase()!==email.toLowerCase())return
    const confirmed=(detail.appointments||[]).filter((a:any)=>a.status==='confirmed'&&a.starts_at).sort((a:any,b:any)=>new Date(b.starts_at).getTime()-new Date(a.starts_at).getTime())
    const rec=detail.recurrence
    const cadence=box.querySelector<HTMLSelectElement>('[data-rec-cadence]')!
    const source=box.querySelector<HTMLSelectElement>('[data-rec-source]')!
    const save=box.querySelector<HTMLButtonElement>('[data-rec-save]')!
    const heading=box.querySelector<HTMLElement>('.patient-recurrence-heading')!
    heading.querySelector('.patient-recurrence-badge')?.remove()
    if(rec?.active){const badge=document.createElement('span');badge.className='patient-recurrence-badge';badge.textContent=Number(rec.cadence_days)===14?'Quinzenal':'Semanal';heading.appendChild(badge)}
    source.innerHTML=confirmed.length?confirmed.map((a:any)=>`<option value="${a.id}">${esc(dt(a.starts_at))}</option>`).join(''):'<option value="">Nenhuma sessão confirmada disponível</option>'
    cadence.disabled=false
    cadence.value=rec?.active?String(Number(rec.cadence_days)===14?14:7):'0'
    if(rec?.source_appointment_id&&confirmed.some((a:any)=>Number(a.id)===Number(rec.source_appointment_id)))source.value=String(rec.source_appointment_id)
    else if(confirmed[0])source.value=String(confirmed[0].id)
    const sync=()=>{source.disabled=cadence.value==='0'||!confirmed.length;save.disabled=cadence.value!=='0'&&!confirmed.length}
    cadence.onchange=sync
    sync()
    save.onclick=async()=>{
      save.disabled=true;status.classList.remove('error');status.textContent='Salvando...'
      try{
        if(cadence.value==='0'){
          await getJson(`/api/admin/patients/${patient.id}/recurrence`,{method:'DELETE'})
          status.textContent='Recorrência desativada.'
          heading.querySelector('.patient-recurrence-badge')?.remove()
        }else{
          if(!source.value)throw new Error('Selecione uma sessão confirmada como referência.')
          await getJson(`/api/admin/patients/${patient.id}/recurrence`,{method:'PUT',body:JSON.stringify({cadence_days:Number(cadence.value),source_appointment_id:Number(source.value)})})
          status.textContent=cadence.value==='7'?'Paciente configurado como semanal. A próxima reserva será criada automaticamente.':'Paciente configurado como quinzenal. A próxima reserva será criada automaticamente.'
          let badge=heading.querySelector<HTMLElement>('.patient-recurrence-badge')
          if(!badge){badge=document.createElement('span');badge.className='patient-recurrence-badge';heading.appendChild(badge)}
          badge.textContent=cadence.value==='14'?'Quinzenal':'Semanal'
        }
      }catch(err){status.classList.add('error');status.textContent=err instanceof Error?err.message:'Não foi possível salvar.'}
      finally{sync()}
    }
    status.textContent=!confirmed.length?'Confirme ao menos uma sessão deste paciente para usar como referência.':rec?.active?`Recorrência ${Number(rec.cadence_days)===14?'quinzenal':'semanal'} ativa.`:'Sem recorrência configurada.'
    box.dataset.ready='1'
  }catch(error){
    console.error('Recurrence UI error',error)
    status.classList.add('error')
    status.textContent=`Não foi possível carregar a recorrência: ${error instanceof Error?error.message:'erro inesperado'}. O controle permanecerá visível e tentará novamente.`
    box.dataset.ready='0'
  }finally{busy=false}
}

function schedule(delay=40){window.clearTimeout(scheduled);scheduled=window.setTimeout(()=>void enhance(),delay)}

export function installAdminPatientRecurrenceEnhancer(){
  if(installed){schedule(0);return}
  installed=true
  ;[0,50,150,300,700,1400].forEach(ms=>window.setTimeout(()=>void enhance(),ms))
  const root=document.getElementById('root')
  if(root)new MutationObserver(()=>schedule(60)).observe(root,{childList:true,subtree:true})
  document.addEventListener('click',event=>{const target=event.target as HTMLElement|null;if(target?.closest('.patient-card')||target?.closest('[data-admin-view="pacientes"]'))schedule(80)},true)
  window.addEventListener('pageshow',()=>schedule(80))
  window.setInterval(()=>{if(document.querySelector('.record-panel .record-head'))schedule(0)},1200)
}

// Fallback independente da ordem de inicialização do restante do painel.
queueMicrotask(()=>installAdminPatientRecurrenceEnhancer())
