let installed=false

const GENERIC_MESSAGES=new Set([
  'Não foi possível concluir a solicitação.',
  'Nao foi possível concluir a solicitação.',
  'Não foi possivel concluir a solicitação.',
  'Nao foi possivel concluir a solicitacao.',
])

function cleanGenericPatientMessage(){
  if(!document.querySelector('.patient-page'))return
  document.querySelectorAll<HTMLElement>('.patient-page .info-box').forEach(box=>{
    const text=(box.textContent||'').trim()
    if(GENERIC_MESSAGES.has(text))box.style.setProperty('display','none','important')
    else if(box.style.display==='none')box.style.removeProperty('display')
  })
}

function scheduleBurst(){
  ;[0,80,200,500].forEach(delay=>window.setTimeout(cleanGenericPatientMessage,delay))
}

export function installPatientMessageEnhancer(){
  if(installed)return
  installed=true
  scheduleBurst()
  document.addEventListener('click',event=>{
    const target=event.target as HTMLElement|null
    if(!target?.closest('.patient-page'))return
    window.setTimeout(cleanGenericPatientMessage,0)
    window.setTimeout(cleanGenericPatientMessage,180)
  },true)
  window.addEventListener('pageshow',scheduleBurst)
}
