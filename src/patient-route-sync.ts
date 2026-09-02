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

export function installPatientRouteSync(){
  if(installed)return
  installed=true
  syncPatientRoute()
  new MutationObserver(syncPatientRoute).observe(document.body,{childList:true,subtree:true})
}
