import './admin-patient-workspace-enhancer.css'

const globalState=window as any
let installed=false

function esc(v:unknown){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))}
function fmtDate(v:string){try{return new Intl.DateTimeFormat('pt-BR').format(new Date(v+'T12:00:00'))}catch{return v}}
function fmtDateTime(v:string){try{return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v))}catch{return v}}

async function getJson(path:string){const r=await fetch(path,{credentials:'include',cache:'no-store'});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível carregar os dados.');return d}

function panel(){return document.querySelector<HTMLElement>('.record-panel')}
function activeCard(id:number){document.querySelectorAll('.patient-card').forEach(el=>el.classList.toggle('active',Number((el as HTMLElement).dataset.patientId||0)===id))}

function renderOverview(data:any){
  const p=panel();if(!p)return
  const patient=data.patient
  p.dataset.patientId=String(patient.id)
  globalState.__psSelectedAdminPatientId=Number(patient.id)
  p.innerHTML=`<div class="record-head"><div><span class="section-kicker">Paciente</span><h2>${esc(patient.full_name)}</h2><p>${esc(patient.email)} • ${esc(patient.phone||'')}<br>Nascimento: ${esc(patient.birth_date?fmtDate(patient.birth_date):'—')} • CPF: ${esc(patient.cpf||'—')}</p></div></div><div class="patient-workspace-actions"><button type="button" class="admin-primary" data-open-clinical-record>Abrir prontuário</button><span>O prontuário é protegido pelo cofre E2E e só será desbloqueado quando você abrir.</span></div><section class="patient-operational-summary"><h3>Resumo de atendimentos</h3><p>${Number(data.appointments?.length||0)} atendimento(s) encontrado(s).</p></section>`
  window.setTimeout(()=>document.dispatchEvent(new CustomEvent('ps:patient-overview-opened')),0)
}

function renderClinical(data:any){
  const p=panel();if(!p)return
  const patient=data.patient
  p.dataset.patientId=String(patient.id)
  const notes=Array.isArray(data.clinical_notes)?data.clinical_notes:[]
  p.innerHTML=`<div class="record-head"><div><span class="section-kicker">Prontuário privado</span><h2>${esc(patient.full_name)}</h2><p>${esc(patient.email)} • ${esc(patient.phone||'')}<br>Nascimento: ${esc(patient.birth_date?fmtDate(patient.birth_date):'—')} • CPF: ${esc(patient.cpf||'—')}</p></div></div><div class="patient-workspace-actions"><button type="button" class="secondary-button" data-back-patient-overview>Voltar aos dados do paciente</button></div><div class="record-warning">Estas anotações são exclusivas da área profissional. O paciente não possui acesso.</div><form class="admin-form"><label>Data da sessão<input name="session_date" type="date" required></label><label>Observações clínicas<textarea name="note_text" required rows="6"></textarea></label><button class="admin-primary" type="submit">Salvar anotação</button></form><div class="note-list"><h3>Histórico de anotações</h3>${notes.length?notes.map((n:any)=>`<article><strong>${esc(n.session_date)}</strong><p>${esc(n.note_text)}</p><small>Registrado em ${esc(fmtDateTime(n.created_at))}</small></article>`).join(''):'<p class="empty-state">Nenhuma anotação registrada.</p>'}</div>`
  window.setTimeout(()=>document.dispatchEvent(new CustomEvent('ps:clinical-record-opened')),0)
}

async function openOverview(id:number){
  const p=panel();if(!p)return
  globalState.__psSelectedAdminPatientId=id;p.dataset.patientId=String(id)
  p.innerHTML='<div class="empty-state">Carregando dados do paciente...</div>'
  try{renderOverview(await getJson(`/api/admin/patients/${id}/overview`))}catch(e){p.innerHTML=`<div class="empty-state">${esc(e instanceof Error?e.message:'Não foi possível carregar o paciente.')}</div>`}
}

async function openClinical(id:number){
  const p=panel();if(!p)return
  p.innerHTML='<div class="empty-state">Abrindo prontuário protegido...</div>'
  try{renderClinical(await getJson(`/api/admin/patients/${id}?clinical=1`))}catch(e){p.innerHTML=`<div class="empty-state">${esc(e instanceof Error?e.message:'Não foi possível abrir o prontuário.')}</div>`}
}

export function installAdminPatientWorkspaceEnhancer(){
  if(installed)return;installed=true
  document.addEventListener('click',event=>{
    const target=event.target as HTMLElement|null
    const card=target?.closest<HTMLButtonElement>('.patient-card')
    if(card){
      const cards=[...document.querySelectorAll<HTMLButtonElement>('.patient-card')]
      const id=Number(card.dataset.patientId||0)||Number(globalState.__psSelectedAdminPatientId||0)||Number(cards.indexOf(card)>=0?(globalState.__psPatientIds||[])[cards.indexOf(card)]:0)
      if(!id)return
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();activeCard(id);void openOverview(id);return
    }
    const open=target?.closest<HTMLButtonElement>('[data-open-clinical-record]')
    if(open){event.preventDefault();const id=Number(panel()?.dataset.patientId||globalState.__psSelectedAdminPatientId||0);if(id)void openClinical(id);return}
    const back=target?.closest<HTMLButtonElement>('[data-back-patient-overview]')
    if(back){event.preventDefault();const id=Number(panel()?.dataset.patientId||globalState.__psSelectedAdminPatientId||0);if(id)void openOverview(id)}
  },true)

  const tagCards=()=>{
    const cards=[...document.querySelectorAll<HTMLButtonElement>('.patient-card')]
    if(!cards.length)return
    fetch('/api/admin/patients',{credentials:'include',cache:'no-store'}).then(r=>r.json()).then((d:any)=>{
      const patients=d.patients||[];globalState.__psPatientIds=patients.map((x:any)=>Number(x.id))
      cards.forEach(card=>{const email=(card.querySelector('span')?.textContent||'').trim().toLowerCase();const found=patients.find((x:any)=>String(x.email||'').toLowerCase()===email);if(found)card.dataset.patientId=String(found.id)})
    }).catch(()=>{})
  }
  ;[0,100,300,800].forEach(ms=>setTimeout(tagCards,ms))
  const root=document.getElementById('root');if(root)new MutationObserver(tagCards).observe(root,{childList:true,subtree:true})
}
