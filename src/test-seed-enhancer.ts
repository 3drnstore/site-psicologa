let running=false
let done=false
let attempts=0

export function installTestSeedEnhancer(){
  const run=async()=>{
    if(done||running||!document.querySelector('.admin-page'))return
    running=true
    attempts++
    try{
      const r=await fetch('/api/admin/test-appointments',{method:'POST',credentials:'include'})
      const data=await r.json().catch(()=>({})) as any
      if(r.ok){
        done=true
        if(!data.already_done)window.setTimeout(()=>window.location.reload(),300)
        return
      }
      console.warn('Test appointment seed pending:',data.message||r.status)
      if(attempts<12)window.setTimeout(()=>{running=false;void run()},1000)
      else running=false
    }catch(error){
      console.warn('Test appointment seed failed:',error)
      if(attempts<12)window.setTimeout(()=>{running=false;void run()},1000)
      else running=false
      return
    }
    running=false
  }

  void run()
  new MutationObserver(()=>{void run()}).observe(document.body,{childList:true,subtree:true})
}
