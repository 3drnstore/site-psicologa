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
  style.textContent=`.patient-sidebar-welcome{margin-top:7px;font-size:13px;line-height:1.4;color:rgba(255,255,255,.82);font-weight:500}.patient-sidebar-welcome strong{font-size:inherit;color:#fff;font-weight:700}`
  document.head.appendChild(style)
}

async function enhance(){
  if(running)return
  const sidebar=document.querySelector<HTMLElement>('.patient-sidebar')
  const brand=sidebar?.querySelector<HTMLElement>('.patient-sidebar-brand')
  if(!sidebar||!brand||brand.querySelector('.patient-sidebar-welcome'))return
  running=true
  try{
    const response=await fetch('/api/me',{credentials:'include'})
    if(!response.ok)return
    const data=await response.json().catch(()=>({})) as any
    const name=displayName(data?.patient?.full_name||'')
    const welcome=document.createElement('div')
    welcome.className='patient-sidebar-welcome'
    welcome.innerHTML=`Bem vindo, <strong>${name.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":'&#39;'}[c]||c))}</strong>`
    brand.appendChild(welcome)
  }finally{running=false}
}

export function installPatientWelcomeEnhancer(){
  const schedule=()=>{
    if(scheduled)clearTimeout(scheduled)
    scheduled=window.setTimeout(()=>{scheduled=undefined;void enhance()},100)
  }
  ensureStyle()
  schedule()
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true})
}
