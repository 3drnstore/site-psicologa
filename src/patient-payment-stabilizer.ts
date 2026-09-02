let installed=false
let paymentStage=false

function isGenericResidual(text:string){
  return text.trim()==='Não foi possível concluir a solicitação.'
}

function enforcePaymentStage(){
  const page=document.querySelector<HTMLElement>('.patient-page')
  if(!page)return

  const actions=page.querySelector<HTMLElement>('.payment-actions')
  if(actions)paymentStage=true
  if(!paymentStage)return

  page.dataset.paymentStage='1'

  page.querySelectorAll<HTMLButtonElement>('.booking-summary button').forEach(button=>{
    const text=(button.textContent||'').trim().toLowerCase()
    if(text.includes('reservar horário')||text.includes('reservando'))button.remove()
  })

  page.querySelectorAll<HTMLElement>('.info-box').forEach(box=>{
    if(isGenericResidual(box.textContent||''))box.remove()
  })
}

export function installPatientPaymentStabilizer(){
  if(installed)return
  installed=true

  const schedule=()=>window.requestAnimationFrame(enforcePaymentStage)
  document.addEventListener('click',event=>{
    const target=event.target as HTMLElement|null
    const button=target?.closest<HTMLButtonElement>('.patient-page .booking-summary button')
    if(button&&(button.textContent||'').toLowerCase().includes('reservar horário')){
      window.setTimeout(schedule,0)
      window.setTimeout(schedule,150)
      window.setTimeout(schedule,600)
    }
  },true)

  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,characterData:true})
  schedule()
}
