import './admin-patient-recurrence-enhancer.css'

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))
const dt=(v:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v))
async function getJson(path:string,init?:RequestInit){const r=await fetch(path,{credentials:'include',cache:'no-store',headers:{'content-type':'application/json',...(init?.headers||{})},...init});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível concluir.');return d}

let installed=false
let busy=false
let scheduled=0
const globalState=window as any

function installPatientIdCapture(){
  if(globalState.__psAdminPatientIdCaptureInstalled)return
  globalState.__psAdminPatientIdCaptureInstalled=true
  const previousFetch=window.fetch.bind(window)
  window.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    try{
      const raw=typeof input==='string'?input:input instanceof URL?input.toString():input.url
      const url=new URL(raw,window.location.origin)
      const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase()
      const match=url.pathname.match(/^\/api\/admin\/patients\/(\d+)$/)
      if(method==='GET'&&match){
        globalState.__psSelectedAdminPatientId=Number(match[1])
        queueMicrotask(()=>{const panel=document.querySelector<HTMLElement>('.record-panel');if(panel)panel.dataset.patientId=match[1]})
      }
    }catch{}
    return previousFetch(input as any,init)
  }) as typeof window.fetch
}

function selectedPatientEmail(panel:HTMLElement){
  const head=panel.querySelector<HTMLElement>('.record-head')
  return (head?.textContent||'').match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0]||''
}
function selectedPatientId(panel:HTMLElement){
  return Number(globalState.__psSelectedAdminPatientId||0)||Number(panel.dataset.patientId||0)||0
}
function localInputs(value?:string|null){
  if(!value)return{date:'',time:''}
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(value))
  const get=(type:string)=>parts.find(p=>p.type===type)?.value||''
  return{date:\`\${get('year')}-\${get('month')}-\${get('day')}\`,time:\`\${get('hour')}:\${get('minute')}\`}
}

function ensureVisibleBox(panel:HTMLElement,head:HTMLElement,email:string){
  let box=panel.querySelector<HTMLElement>('.patient-recurrence-admin')
  if(box&&box.dataset.patientEmail!==email.toLowerCase()){box.remove();box=null}
  if(!box){
    box=document.createElement('section')
    box.className='patient-recurrence-admin'
    box.dataset.patientEmail=email.toLowerCase()
    box.dataset.ready='0'
    box.innerHTML=\`<div class="patient-recurrence-heading"><div><span class="section-kicker">Agenda do paciente</span><h3>Recorrência de sessões</h3></div></div>
      <p>Defina se este paciente possui horário fixo. Você pode usar uma sessão confirmada como referência ou informar manualmente a próxima data e horário.</p>
      <div class="patient-recurrence-grid">
        <label>Periodicidade<select data-rec-cadence disabled><option value="0">Sem recorrência</option><option value="7">Semanal</option><option value="14">Quinzenal</option></select></label>
        <label>Referência<select data-rec-mode disabled><option value="session">Sessão confirmada</option><option value="manual">Data e horário manual</option></select></label>
        <label class="rec-source-field">Sessão confirmada de referência<select data-rec-source disabled><option value="">Carregando sessões...</option></select></label>
        <div class="rec-manual-fields" hidden>
          <label>Data<input type="date" data-rec-date></label>
          <label>Horário<input type="time" step="3600" data-rec-time></label>
        </div>
        <button type="button" data-rec-save disabled>Salvar recorrência</button>
      </div>
      <small class="patient-recurrence-status" data-rec-status>Carregando configuração de recorrência...</small>\`
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
    const patientId=selectedPatientId(panel)
    if(!patientId)throw new Error('Não foi possível identificar o paciente selecionado. Clique novamente no paciente da lista.')
    panel.dataset.patientId=String(patientId)
    const detail=await getJson(\`/api/admin/patients/\${patientId}\`)
    if(!panel.isConnected||selectedPatientId(panel)!==patientId)return

    const confirmed=(detail.appointments||[]).filter((a:any)=>a.status==='confirmed'&&a.starts_at).sort((a:any,b:any)=>new Date(b.starts_at).getTime()-new Date(a.starts_at).getTime())
    const rec=detail.recurrence
    const cadence=box.querySelector<HTMLSelectElement>('[data-rec-cadence]')!
    const mode=box.querySelector<HTMLSelectElement>('[data-rec-mode]')!
    const source=box.querySelector<HTMLSelectElement>('[data-rec-source]')!
    const sourceField=box.querySelector<HTMLElement>('.rec-source-field')!
    const manualFields=box.querySelector<HTMLElement>('.rec-manual-fields')!
    const date=box.querySelector<HTMLInputElement>('[data-rec-date]')!
    const time=box.querySelector<HTMLInputElement>('[data-rec-time]')!
    const save=box.querySelector<HTMLButtonElement>('[data-rec-save]')!
    const heading=box.querySelector<HTMLElement>('.patient-recurrence-heading')!

    heading.querySelector('.patient-recurrence-badge')?.remove()
    if(rec?.active){const badge=document.createElement('span');badge.className='patient-recurrence-badge';badge.textContent=Number(rec.cadence_days)===14?'Quinzenal':'Semanal';heading.appendChild(badge)}

    source.innerHTML=confirmed.length?confirmed.map((a:any)=>\`<option value="\${a.id}">\${esc(dt(a.starts_at))}</option>\`).join(''):'<option value="">Nenhuma sessão confirmada disponível</option>'
    cadence.disabled=false
    mode.disabled=false
    cadence.value=rec?.active?String(Number(rec.cadence_days)===14?14:7):'0'
    mode.value=rec?.active&&rec?.manual_reference_at&&!rec?.source_appointment_id?'manual':'session'

    if(rec?.source_appointment_id&&confirmed.some((a:any)=>Number(a.id)===Number(rec.source_appointment_id)))source.value=String(rec.source_appointment_id)
    else if(confirmed[0])source.value=String(confirmed[0].id)

    const manual=localInputs(rec?.manual_reference_at)
    date.value=manual.date
    time.value=manual.time

    const sync=()=>{
      const enabled=cadence.value!=='0'
      mode.disabled=!enabled
      const manualMode=enabled&&mode.value==='manual'
      sourceField.hidden=manualMode
      manualFields.hidden=!manualMode
      source.disabled=!enabled||manualMode||!confirmed.length
      date.disabled=!manualMode
      time.disabled=!manualMode
      save.disabled=enabled&&(manualMode?(!date.value||!time.value):!source.value)
    }
    cadence.onchange=sync
    mode.onchange=sync
    date.oninput=sync
    time.oninput=sync
    sync()

    save.onclick=async()=>{
      save.disabled=true
      status.classList.remove('error')
      status.textContent='Salvando...'
      try{
        if(cadence.value==='0'){
          await getJson(\`/api/admin/patients/\${patientId}/recurrence\`,{method:'DELETE'})
          status.textContent='Recorrência desativada.'
          heading.querySelector('.patient-recurrence-badge')?.remove()
        }else{
          const payload:any={cadence_days:Number(cadence.value),reference_mode:mode.value}
          if(mode.value==='manual'){
            if(!date.value||!time.value)throw new Error('Informe a data e o horário.')
            payload.manual_date=date.value
            payload.manual_time=time.value
          }else{
            if(!source.value)throw new Error('Selecione uma sessão confirmada como referência.')
            payload.source_appointment_id=Number(source.value)
          }
          const result=await getJson(\`/api/admin/patients/\${patientId}/recurrence\`,{method:'PUT',body:JSON.stringify(payload)})
          if(result.action==='rescheduled')status.textContent='Recorrência salva e a sessão que aguardava reagendamento foi movida para a data informada.'
          else if(result.action==='reserved')status.textContent='Recorrência salva e a próxima sessão foi reservada na data e horário informados.'
          else status.textContent=cadence.value==='7'?'Paciente configurado como semanal.':'Paciente configurado como quinzenal.'
          let badge=heading.querySelector<HTMLElement>('.patient-recurrence-badge')
          if(!badge){badge=document.createElement('span');badge.className='patient-recurrence-badge';heading.appendChild(badge)}
          badge.textContent=cadence.value==='14'?'Quinzenal':'Semanal'
        }
      }catch(err){
        status.classList.add('error')
        status.textContent=err instanceof Error?err.message:'Não foi possível salvar.'
      }finally{sync()}
    }

    status.textContent=rec?.active?\`Recorrência \${Number(rec.cadence_days)===14?'quinzenal':'semanal'} ativa.\`:'Sem recorrência configurada.'
    box.dataset.ready='1'
  }catch(error){
    console.error('Recurrence UI error',error)
    status.classList.add('error')
    status.textContent=\`Não foi possível carregar a recorrência: \${error instanceof Error?error.message:'erro inesperado'}\`
    box.dataset.ready='0'
  }finally{busy=false}
}

function schedule(delay=40){window.clearTimeout(scheduled);scheduled=window.setTimeout(()=>void enhance(),delay)}
export function installAdminPatientRecurrenceEnhancer(){
  installPatientIdCapture()
  if(installed){schedule(0);return}
  installed=true
  ;[0,50,150,300,700,1400].forEach(ms=>window.setTimeout(()=>void enhance(),ms))
  const root=document.getElementById('root')
  if(root)new MutationObserver(()=>schedule(60)).observe(root,{childList:true,subtree:true})
  document.addEventListener('click',event=>{const target=event.target as HTMLElement|null;if(target?.closest('.patient-card')||target?.closest('[data-admin-view="pacientes"]'))schedule(120)},true)
  window.addEventListener('pageshow',()=>schedule(80))
  window.setInterval(()=>{if(document.querySelector('.record-panel .record-head'))schedule(0)},1200)
}
queueMicrotask(()=>installAdminPatientRecurrenceEnhancer())
