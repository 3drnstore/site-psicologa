let attempted=false

export function installTestSeedEnhancer(){
  const run=async()=>{
    if(attempted||!document.querySelector('.admin-page'))return
    attempted=true
    try{
      const r=await fetch('/api/admin/test-appointments',{method:'POST',credentials:'include'})
      const data=await r.json().catch(()=>({})) as any
      if(!r.ok){
        console.warn('Test appointment seed skipped:',data.message||r.status)
        return
      }
      if(!data.already_done){
        window.setTimeout(()=>window.location.reload(),300)
      }
    }catch(error){
      console.warn('Test appointment seed failed:',error)
    }
  }
  void run()
  new MutationObserver(()=>{void run()}).observe(document.body,{childList:true,subtree:true})
}
