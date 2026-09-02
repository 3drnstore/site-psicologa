let installed=false

function reserveButton(){
  const buttons=[...document.querySelectorAll<HTMLButtonElement>('.patient-page .booking-summary button')]
  return buttons.find(b=>(b.textContent||'').toLowerCase().includes('reservar horário'))||null
}

function enableReserve(){
  const selected=document.querySelector<HTMLButtonElement>('.patient-page .time.selected, .patient-page .time[data-payment-selected="1"]')
  const reserve=reserveButton()
  if(!reserve)return
  const enabled=Boolean(selected)
  reserve.disabled=!enabled
  reserve.setAttribute('aria-disabled',String(!enabled))
}

function selectImmediately(slot:HTMLButtonElement){
  document.querySelectorAll<HTMLButtonElement>('.patient-page .time.selected').forEach(button=>{
    if(button!==slot)button.classList.remove('selected')
  })
  document.querySelectorAll<HTMLButtonElement>('.patient-page .time[data-payment-selected="1"]').forEach(button=>{
    if(button!==slot)delete button.dataset.paymentSelected
  })
  slot.classList.add('selected')
  slot.dataset.paymentSelected='1'
  const reserve=reserveButton()
  if(reserve){
    reserve.disabled=false
    reserve.setAttribute('aria-disabled','false')
  }
}

function scheduleEnable(){
  window.requestAnimationFrame(enableReserve)
  window.setTimeout(enableReserve,120)
}

export function installPatientSelectionEnhancer(){
  if(installed)return
  installed=true

  const handle=(event:Event)=>{
    const target=event.target as HTMLElement|null
    const slot=target?.closest<HTMLButtonElement>('.patient-page .time[data-public-status="free"]')
    if(!slot||slot.disabled)return
    selectImmediately(slot)
    scheduleEnable()
  }

  document.addEventListener('pointerdown',handle,true)
  document.addEventListener('click',handle,true)
  document.addEventListener('click',event=>{
    const target=event.target as HTMLElement|null
    if(target?.closest('.patient-page'))scheduleEnable()
  },true)
  window.addEventListener('pageshow',scheduleEnable)
  scheduleEnable()
}
