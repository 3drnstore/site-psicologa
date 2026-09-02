let scheduled:number|undefined
let running=false

function displayName(fullName:string){
  const parts=String(fullName||'').trim().split(/\s+/).filter(Boolean)
  if(parts.length<=1)return parts[0]||'Paciente'
  if(parts.length===2)return parts[0]
  return parts.slice(0,-1).join(' ')
}

function ensureStyle(){
  if(document.getElementById('patient-welcome-style'))return
  const style=document.createElement('style')
  style.id='patient-welcome-style'
  style.textContent=`
  .patient-sidebar-brand .patient-sidebar-welcome{display:block!important;visibility:visible!important;opacity:1!important;width:100%;margin-top:7px;font-size:13px!important;line-height:1.4;color:rgba(255,255,255,.82)!important;font-weight:500!important;white-space:normal}
  .patient-sidebar-brand .patient-sidebar-welcome strong{display:inline!important;font-size:inherit!important;color:#fff!important;font-weight:700!important}
  @media(min-width:901px){.patient-sidebar-brand{overflow:visible!important}.patient-sidebar-brand .patient-sidebar-welcome{position:relative!important;z-index:2!important}}
  `
  document.head.appendChild(style)
}

function cachedPatient(){
  try{
    const raw=sessionStorage.getItem('ps_recent_patient')
    return raw?JSON.parse(raw):null
  }catch{return null}
}

function appendWelcome(brand:HTMLElement,fullName:string){
  if(brand.querySelector('.patient-sidebar-welcome'))return
  const name=displayName(fullName)
  const welcome=document.createElement('div')
  welcome.className='patient-sidebar-welcome'
  welcome.innerHTML=`Bem vindo, <strong>${name.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":'&#39;'}[c]||c))}</strong>`
  brand.appendChild(welcome)
}

async function enhance(){
  if(running)return
  const sidebar=document.querySelector<HTMLElement>('.patient-sidebar')
  const brand=sidebar?.querySelector<HTMLElement>('.patient-sidebar-brand')
  if(!sidebar||!brand||brand.querySelector('.patient-sidebar-welcome'))return

  const cached=cachedPatient()
  if(cached?.full_name){appendWelcome(brand,String(cached.full_name));return}

  running=true
  try{
    const response=await fetch('/api/me',{credentials:'include',cache:'no-store'})
    if(!response.ok)return
    const data=await response.json().catch(()=>({})) as any
    appendWelcome(brand,String(data?.patient?.full_name||''))
  }finally{running=false}
}

function relevantMutation(records:MutationRecord[]){
  return records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>{
    if(!(node instanceof HTMLElement))return false
    return node.matches('.patient-page,.patient-sidebar,.patient-sidebar-brand')||Boolean(node.querySelector('.patient-page,.patient-sidebar,.patient-sidebar-brand'))
  }))
}

export function installPatientWelcomeEnhancer(){
  const schedule=()=>{
    if(scheduled)clearTimeout(scheduled)
    scheduled=window.setTimeout(()=>{scheduled=undefined;void enhance()},100)
  }
  ensureStyle()
  schedule()
  const root=document.getElementById('root')
  if(root)new MutationObserver(records=>{if(relevantMutation(records))schedule()}).observe(root,{childList:true,subtree:true})
  window.addEventListener('pageshow',schedule)
}
