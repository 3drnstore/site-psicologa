import './admin-navigation-patients-enhancer.css'

type Patient={id:number;full_name:string;email:string;phone?:string|null}
type View='dashboard'|'sessions'|'agenda'|'finance'|'patients'

let installed=false
let patientsCache:Patient[]|null=null
let patientsLoading:Promise<Patient[]>|null=null
let timer=0
let restoring=false

const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
const viewByLabel=(label:string):View|null=>{const t=label.trim();if(t==='Painel')return'dashboard';if(t==='Sessões'||t==='Consultas')return'sessions';if(t==='Agenda')return'agenda';if(t==='Financeiro'||t==='Pagamentos')return'finance';if(t==='Pacientes')return'patients';return null}
const labelsByView:Record<View,string[]>={dashboard:['Painel'],sessions:['Sessões','Consultas'],agenda:['Agenda'],finance:['Financeiro','Pagamentos'],patients:['Pacientes']}

function sidebar(){return document.querySelector<HTMLElement>('.admin-sidebar')}
function sidebarButtons(){return [...document.querySelectorAll<HTMLButtonElement>('.admin-sidebar nav button')]}
function buttonFor(view:View){const labels=labelsByView[view];return sidebarButtons().find(b=>labels.includes((b.textContent||'').trim()))||null}
function desiredView():View{const raw=new URLSearchParams(location.search).get('view');return(['dashboard','sessions','agenda','finance','patients'] as View[]).includes(raw as View)?raw as View:'dashboard'}
function patientParam(){const raw=new URLSearchParams(location.search).get('patient');const id=Number(raw||0);return Number.isFinite(id)&&id>0?id:0}
function writeView(view:View,patientId?:number,replace=false){if(location.pathname.startsWith('/admin/configuracoes/'))return;const url=new URL(location.href);url.pathname='/admin';url.searchParams.set('view',view);if(view==='patients'&&patientId)url.searchParams.set('patient',String(patientId));else url.searchParams.delete('patient');history[replace?'replaceState':'pushState']({},'',url.pathname+url.search+url.hash)}

async function getPatients(){
  if(patientsCache)return patientsCache
  if(patientsLoading)return patientsLoading
  patientsLoading=fetch('/api/admin/patients',{credentials:'include',cache:'no-store'}).then(async r=>{const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível carregar pacientes.');const list=(d.patients||[]) as Patient[];list.sort((a,b)=>String(a.full_name||'').localeCompare(String(b.full_name||''),'pt-BR',{sensitivity:'base'}));patientsCache=list;return list}).finally(()=>{patientsLoading=null})
  return patientsLoading
}

function cardEmail(card:HTMLElement){return (card.textContent||'').match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0]?.toLowerCase()||''}

async function enhancePatientBank(){
  const list=document.querySelector<HTMLElement>('.patient-list')
  if(!list)return
  const cards=[...list.querySelectorAll<HTMLButtonElement>('.patient-card')]
  if(!cards.length)return
  let patients:Patient[]
  try{patients=await getPatients()}catch{return}
  if(!list.isConnected)return
  const byEmail=new Map(patients.map(p=>[String(p.email||'').toLowerCase(),p]))
  cards.forEach(card=>{const p=byEmail.get(cardEmail(card));if(p){card.dataset.patientId=String(p.id);card.dataset.searchText=normalize(`${p.full_name} ${p.email} ${p.phone||''}`)}})
  cards.sort((a,b)=>normalize(a.querySelector('strong')?.textContent||'').localeCompare(normalize(b.querySelector('strong')?.textContent||''),'pt-BR'))
  cards.forEach(card=>list.appendChild(card))

  let search=list.querySelector<HTMLElement>('.admin-patient-search')
  if(!search){
    search=document.createElement('div');search.className='admin-patient-search';search.innerHTML='<label for="admin-patient-search-input">Pesquisar paciente</label><input id="admin-patient-search-input" type="search" autocomplete="off" placeholder="Nome, e-mail ou telefone"><small data-patient-search-count></small>'
    list.querySelector('.admin-section-head')?.insertAdjacentElement('afterend',search)
    const input=search.querySelector<HTMLInputElement>('input')!
    input.addEventListener('input',()=>filterPatientCards(list,input.value))
  }
  const input=search.querySelector<HTMLInputElement>('input')
  filterPatientCards(list,input?.value||'')
  const targetId=patientParam()
  if(targetId){const target=list.querySelector<HTMLButtonElement>(`.patient-card[data-patient-id="${targetId}"]`);if(target&&!target.classList.contains('active'))window.setTimeout(()=>target.click(),0)}
}

function filterPatientCards(list:HTMLElement,query:string){
  const q=normalize(query),cards=[...list.querySelectorAll<HTMLButtonElement>('.patient-card')];let visible=0
  cards.forEach(card=>{const match=!q||normalize(card.dataset.searchText||card.textContent||'').includes(q);card.hidden=!match;if(match)visible++})
  const counter=list.querySelector<HTMLElement>('[data-patient-search-count]');if(counter)counter.textContent=q?`${visible} paciente(s) encontrado(s)`:`${cards.length} paciente(s) em ordem alfabética`
}

async function enhanceSessionPatientLinks(){
  const host=document.querySelector<HTMLElement>('.admin-consultations-v2');if(!host)return
  const rows=[...host.querySelectorAll<HTMLElement>('.admin-table-row:not(.header)')];if(!rows.length)return
  let patients:Patient[]
  try{patients=await getPatients()}catch{return}
  const byEmail=new Map(patients.map(p=>[String(p.email||'').toLowerCase(),p]))
  rows.forEach(row=>{
    const cell=row.firstElementChild as HTMLElement|null;if(!cell||cell.querySelector('.admin-patient-name-link'))return
    const email=(cell.querySelector('small')?.textContent||'').trim().toLowerCase(),patient=byEmail.get(email),name=cell.querySelector<HTMLElement>('strong');if(!patient||!name)return
    const link=document.createElement('a');link.className='admin-patient-name-link';link.href=`/admin?view=patients&patient=${patient.id}`;link.textContent=name.textContent||patient.full_name;name.replaceWith(link)
  })
}

function restoreFromUrl(){
  if(restoring||location.pathname.startsWith('/admin/configuracoes/'))return
  const side=sidebar();if(!side)return
  const view=desiredView(),button=buttonFor(view);if(!button)return
  restoring=true
  if(!button.classList.contains('active')||view==='dashboard'||view==='sessions'||view==='finance')button.click()
  window.setTimeout(()=>{restoring=false;if(view==='patients')void enhancePatientBank()},120)
}

function onDocumentClick(event:Event){
  const target=event.target as HTMLElement|null
  const patientLink=target?.closest<HTMLAnchorElement>('.admin-patient-name-link')
  if(patientLink)return
  const patientCard=target?.closest<HTMLButtonElement>('.patient-card')
  if(patientCard?.dataset.patientId){writeView('patients',Number(patientCard.dataset.patientId),true);return}
  const navButton=target?.closest<HTMLButtonElement>('.admin-sidebar nav button')
  if(!navButton)return
  const label=(navButton.textContent||'').trim();if(label==='Configurações')return
  const view=viewByLabel(label);if(view&&!restoring)writeView(view,undefined,false)
}

function schedule(delay=60){window.clearTimeout(timer);timer=window.setTimeout(()=>{restoreFromUrl();void enhancePatientBank();void enhanceSessionPatientLinks()},delay)}

export function installAdminNavigationPatientsEnhancer(){
  if(installed){schedule(0);return}
  installed=true
  document.addEventListener('click',onDocumentClick,true)
  ;[80,220,500,1000,1800].forEach(ms=>window.setTimeout(()=>schedule(0),ms))
  const root=document.getElementById('root');if(root)new MutationObserver(()=>schedule(80)).observe(root,{childList:true,subtree:true})
  window.addEventListener('pageshow',()=>schedule(60));window.addEventListener('popstate',()=>schedule(30))
}

queueMicrotask(()=>installAdminNavigationPatientsEnhancer())
