let running=false
let done=false
let attempts=0

function show(message:string,isError=false){
  const host=document.querySelector<HTMLElement>('.google-calendar-admin')
  if(!host)return
  let el=host.querySelector<HTMLElement>('.test-seed-status')
  if(!el){
    el=document.createElement('div')
    el.className=`gc-notice test-seed-status${isError?' error':''}`
    const help=host.querySelector('.gc-help')
    help?.after(el)
  }
  el.className=`gc-notice test-seed-status${isError?' error':''}`
  el.textContent=message
}

export function installTestSeedEnhancer(){
  const run=async()=>{
    if(done||running||!document.querySelector('.admin-page'))return
    running=true
    attempts++
    try{
      const r=await fetch('/api/admin/test-appointments',{method:'POST',credentials:'include',headers:{'content-type':'application/json'}})
      const data=await r.json().catch(()=>({})) as any
      if(r.ok){
        done=true
        if(data.already_done){
          show('3 agendamentos de teste verificados em 02/09/2026.')
          window.setTimeout(()=>document.querySelector('.test-seed-status')?.remove(),2500)
        }else{
          show('3 agendamentos de teste criados em 02/09/2026. Atualizando a Agenda...')
          window.setTimeout(()=>window.location.reload(),500)
        }
        return
      }
      const detail=data.detail?` — ${data.detail}`:''
      const free=typeof data.free_slots==='number'?` (${data.free_slots} horários livres encontrados)`:''
      show(`Teste não criado: ${data.message||`erro ${r.status}`}${free}${detail}`,true)
      if(attempts<5)window.setTimeout(()=>{running=false;void run()},1200)
      else running=false
    }catch(error){
      show(`Falha ao criar testes: ${error instanceof Error?error.message:String(error)}`,true)
      if(attempts<5)window.setTimeout(()=>{running=false;void run()},1200)
      else running=false
    }
  }

  const schedule=()=>{
    if(done||running)return
    if(document.querySelector('.google-calendar-admin'))void run()
  }
  schedule()
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true})
}
