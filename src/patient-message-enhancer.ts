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

export function installPatientMessageEnhancer(){
  if(installed)return
  installed=true
  cleanGenericPatientMessage()
  new MutationObserver(cleanGenericPatientMessage).observe(document.body,{childList:true,subtree:true,characterData:true})
}
