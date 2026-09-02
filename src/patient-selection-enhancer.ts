let installed=false

function enableReserve(){
  const selected=document.querySelector<HTMLButtonElement>('.patient-page .time.selected, .patient-page .time[data-payment-selected="1"]')
  if(!selected)return
  const buttons=[...document.querySelectorAll<HTMLButtonElement>('.patient-page .booking-summary button')]
  const reserve=buttons.find(b=>(b.textContent||'').toLowerCase().includes('reservar horário'))
  if(!reserve)return
  reserve.disabled=false
  reserve.setAttribute('aria-disabled','false')
}

export function installPatientSelectionEnhancer(){
  if(installed)return
  installed=true
  document.addEventListener('click',event=>{
    const target=event.target as HTMLElement|null
    const slot=target?.closest<HTMLButtonElement>('.patient-page .time[data-public-status="free"]')
    if(!slot||slot.disabled)return
    window.requestAnimationFrame(enableReserve)
  },true)
  new MutationObserver(()=>window.requestAnimationFrame(enableReserve)).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','disabled','data-payment-selected']})
}
