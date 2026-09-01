const dayLabel=(value:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long'}).format(new Date(value))
const timeOnly=(value:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(value))

let running=false
let scheduled:number|undefined

async function applyBlockedLabels(){
  if(running||!document.querySelector('.patient-page'))return
  running=true
  try{
    const r=await fetch('/api/availability',{credentials:'include'})
    if(!r.ok)return
    const data=await r.json().catch(()=>({})) as any
    const blocked=new Set<string>((data.slots||[]).filter((s:any)=>s.public_status==='blocked').map((s:any)=>`${dayLabel(s.starts_at)}|${timeOnly(s.starts_at)}`))
    document.querySelectorAll<HTMLElement>('.availability-day').forEach(section=>{
      const day=section.querySelector('h2')?.textContent?.trim()||''
      section.querySelectorAll<HTMLButtonElement>('.time.occupied').forEach(button=>{
        const text=button.textContent||''
        const match=text.match(/(\d{2}:\d{2})/)
        if(!match)return
        const label=button.querySelector('span')
        if(label)label.textContent=blocked.has(`${day}|${match[1]}`)?'Bloqueado':'Ocupado'
      })
    })
  }finally{running=false}
}

export function installPatientBlockedEnhancer(){
  const schedule=()=>{
    if(scheduled)window.clearTimeout(scheduled)
    scheduled=window.setTimeout(()=>{scheduled=undefined;applyBlockedLabels()},120)
  }
  schedule()
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true})
}
