import './admin-clinical-notes-enhancer.css'

async function api(path:string,init?:RequestInit){
  const response=await fetch(path,{credentials:'include',cache:'no-store',headers:{'content-type':'application/json',...(init?.headers||{})},...init})
  const data=await response.json().catch(()=>({})) as any
  if(!response.ok)throw new Error(data.message||'Não foi possível concluir a solicitação.')
  return data
}

function currentRecord(){
  const panel=document.querySelector<HTMLElement>('.record-panel')
  const head=panel?.querySelector<HTMLElement>('.record-head')
  const email=(head?.textContent||'').match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0]||''
  return {panel,head,email}
}

async function currentPatientId(email:string){
  if(!email)return 0
  const list=await api('/api/admin/patients')
  const patient=(list.patients||[]).find((p:any)=>String(p.email||'').toLowerCase()===email.toLowerCase())
  return Number(patient?.id||0)
}

async function reloadCurrentPatient(){
  const active=document.querySelector<HTMLButtonElement>('.patient-card.active')
  if(active){active.click();return}
  window.location.reload()
}

let decorateBusy=false
async function decorateNotes(){
  if(decorateBusy)return
  const {panel,email}=currentRecord()
  const list=panel?.querySelector<HTMLElement>('.note-list')
  if(!panel||!list||!email)return
  const articles=[...list.querySelectorAll<HTMLElement>('article')]
  if(!articles.length||articles.every(article=>article.dataset.noteId))return
  decorateBusy=true
  try{
    const patientId=await currentPatientId(email)
    if(!patientId)return
    const detail=await api(`/api/admin/patients/${patientId}`)
    const notes:any[]=detail.clinical_notes||[]
    articles.forEach((article,index)=>{
      const note=notes[index]
      if(!note||article.dataset.noteId)return
      article.dataset.noteId=String(note.id)
      const actions=document.createElement('div')
      actions.className='clinical-note-actions'
      actions.innerHTML='<button type="button" data-delete-clinical-note>Excluir anotação</button>'
      article.appendChild(actions)
    })
  }catch(error){console.error('Clinical note decoration error',error)}finally{decorateBusy=false}
}

async function saveNote(form:HTMLFormElement){
  if(form.dataset.noteSaving==='1')return
  const {email}=currentRecord()
  if(!email)return
  const button=form.querySelector<HTMLButtonElement>('button[type="submit"]')
  let status=form.querySelector<HTMLElement>('[data-note-save-status]')
  if(!status){status=document.createElement('small');status.dataset.noteSaveStatus='1';status.className='clinical-note-save-status';button?.insertAdjacentElement('afterend',status)}
  form.dataset.noteSaving='1'
  if(button){button.disabled=true;button.dataset.originalText=button.textContent||'Salvar anotação';button.textContent='Salvando...'}
  status.textContent=''
  const fd=new FormData(form)
  try{
    const patientId=await currentPatientId(email)
    if(!patientId)throw new Error('Paciente não encontrado.')
    const sessionDate=String(fd.get('session_date')||'').trim()
    const noteText=String(fd.get('note_text')||'').trim()
    if(!sessionDate||!noteText)throw new Error('Informe a data da sessão e a anotação.')
    await api(`/api/admin/patients/${patientId}/notes`,{method:'POST',body:JSON.stringify({session_date:sessionDate,note_text:noteText})})
    form.reset()
    status.textContent='Anotação clínica salva.'
    await reloadCurrentPatient()
  }catch(error){
    status.textContent=error instanceof Error?error.message:'Não foi possível salvar.'
    form.dataset.noteSaving='0'
    if(button){button.disabled=false;button.textContent=button.dataset.originalText||'Salvar anotação'}
  }
}

function installSubmitGuard(){
  document.addEventListener('submit',event=>{
    const form=event.target as HTMLFormElement|null
    if(!form?.closest('.record-panel')||!form.querySelector('[name="session_date"]')||!form.querySelector('[name="note_text"]'))return
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation()
    if(form.dataset.noteSaving==='1')return
    void saveNote(form)
  },true)
}

function installDelete(){
  document.addEventListener('click',event=>{
    const target=event.target as HTMLElement|null
    const button=target?.closest<HTMLButtonElement>('[data-delete-clinical-note]')
    if(!button)return
    event.preventDefault();event.stopPropagation()
    const article=button.closest<HTMLElement>('article[data-note-id]')
    const id=article?.dataset.noteId
    if(!id)return
    if(!window.confirm('Excluir esta anotação clínica? Esta ação não poderá ser desfeita.'))return
    button.disabled=true;button.textContent='Excluindo...'
    void api(`/api/admin/notes/${encodeURIComponent(id)}`,{method:'DELETE'}).then(()=>{
      article?.remove()
      const list=document.querySelector<HTMLElement>('.record-panel .note-list')
      if(list&&!list.querySelector('article'))list.insertAdjacentHTML('beforeend','<p class="empty-state">Nenhuma anotação registrada.</p>')
    }).catch(error=>{
      alert(error instanceof Error?error.message:'Não foi possível excluir a anotação.')
      button.disabled=false;button.textContent='Excluir anotação'
    })
  },true)
}

export function installAdminClinicalNotesEnhancer(){
  installSubmitGuard();installDelete()
  const run=()=>void decorateNotes()
  ;[100,350,800,1500].forEach(ms=>window.setTimeout(run,ms))
  const root=document.getElementById('root')
  if(root){let timer=0;new MutationObserver(()=>{window.clearTimeout(timer);timer=window.setTimeout(run,60)}).observe(root,{childList:true,subtree:true})}
  document.addEventListener('click',event=>{const target=event.target as HTMLElement|null;if(target?.closest('.patient-card'))window.setTimeout(run,120)},true)
}
