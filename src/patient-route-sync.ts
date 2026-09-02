let installed=false

function syncPatientRoute(){
  const patient=document.querySelector('.patient-page')
  const publicSite=document.querySelector('.site-shell')
  const path=window.location.pathname

  if(patient&&path!=='/paciente'&&path!=='/paciente/'){
    window.history.replaceState({},'',`/paciente${window.location.search}`)
    return
  }

  if(publicSite&&(path==='/paciente'||path==='/paciente/')){
    window.history.replaceState({},'','/')
  }
}

function relevantMutation(records:MutationRecord[]){
  return records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>{
    if(!(node instanceof HTMLElement))return false
    return node.matches('.patient-page,.site-shell')||Boolean(node.querySelector('.patient-page,.site-shell'))
  }))
}

export function installPatientRouteSync(){
  if(installed)return
  installed=true
  syncPatientRoute()
  const root=document.getElementById('root')
  if(root)new MutationObserver(records=>{if(relevantMutation(records))syncPatientRoute()}).observe(root,{childList:true,subtree:true})
  window.addEventListener('pageshow',syncPatientRoute)
  window.addEventListener('popstate',syncPatientRoute)
}
