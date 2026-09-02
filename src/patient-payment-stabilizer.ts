let installed=false
let paymentStage=false

function isGenericResidual(text:string){
  return text.trim()==='Não foi possível concluir a solicitação.'
}

function isMobile(){return window.matchMedia('(max-width: 900px)').matches}

function ensureStyle(){
  if(document.getElementById('patient-mobile-booking-stage-style'))return
  const style=document.createElement('style')
  style.id='patient-mobile-booking-stage-style'
  style.textContent=`
  @media(max-width:900px){
    .patient-page .booking-summary{
      position:static!important;
      left:auto!important;right:auto!important;bottom:auto!important;
      display:grid!important;grid-template-columns:1fr!important;
      gap:12px!important;width:100%!important;
    }
    .patient-page .booking-summary .patient-session-info{order:1!important}
    .patient-page .booking-summary>.primary-button,
    .patient-page .booking-summary>.mobile-reserve-static{
      order:2!important;position:static!important;left:auto!important;right:auto!important;bottom:auto!important;
      width:100%!important;max-width:none!important;margin:0!important;transform:none!important;
      box-shadow:none!important;justify-content:center!important;opacity:1!important;
    }
    .patient-page .booking-summary>.mobile-reserve-static:disabled{opacity:1!important;cursor:default!important}
    .patient-page .booking-summary>.mobile-booking-message{
      order:3!important;width:100%!important;margin:0!important;padding:11px 13px!important;
      border:1px solid rgba(88,120,111,.2)!important;border-radius:12px!important;
      background:rgba(88,120,111,.10)!important;color:#35554d!important;
      font-size:13px!important;line-height:1.45!important;opacity:.88!important;
      box-sizing:border-box!important;
    }
    .patient-page .booking-summary>.payment-actions{
      order:4!important;position:static!important;width:100%!important;margin:0!important;
      display:grid!important;grid-template-columns:1fr!important;gap:10px!important;
    }
    .patient-page .booking-summary>.payment-actions button{width:100%!important;margin:0!important}
    .patient-page:has(.patient-calendar-slot.selected) .booking-summary>.primary-button{
      position:static!important;left:auto!important;right:auto!important;bottom:auto!important;width:100%!important;
      box-shadow:none!important;
    }
  }
  `
  document.head.appendChild(style)
}

function moveMobileMessage(page:HTMLElement,summary:HTMLElement){
  const boxes=[...page.querySelectorAll<HTMLElement>('.info-box')]
  for(const box of boxes){
    const text=(box.textContent||'').trim()
    if(isGenericResidual(text)){box.remove();continue}
    if(!text)continue
    box.classList.add('mobile-booking-message')
    summary.appendChild(box)
  }
}

function ensureMobileReserve(summary:HTMLElement){
  const buttons=[...summary.querySelectorAll<HTMLButtonElement>('button')]
  let reserve=buttons.find(button=>{
    const text=(button.textContent||'').trim().toLowerCase()
    return text.includes('reservar horário')||text.includes('reservando')
  })
  if(!reserve){
    reserve=document.createElement('button')
    reserve.type='button'
    reserve.className='primary-button mobile-reserve-static'
    reserve.textContent='Reservar horário'
    summary.appendChild(reserve)
  }
  reserve.textContent='Reservar horário'
  reserve.classList.add('mobile-reserve-static')
  reserve.disabled=true
  reserve.setAttribute('aria-disabled','true')
}

function enforcePaymentStage(){
  const page=document.querySelector<HTMLElement>('.patient-page')
  if(!page)return
  ensureStyle()

  const summary=page.querySelector<HTMLElement>('.booking-summary')
  const actions=page.querySelector<HTMLElement>('.payment-actions')
  if(actions)paymentStage=true

  if(isMobile()&&summary){
    moveMobileMessage(page,summary)
    if(paymentStage)ensureMobileReserve(summary)
  }

  if(!paymentStage)return
  page.dataset.paymentStage='1'

  if(!isMobile()){
    page.querySelectorAll<HTMLButtonElement>('.booking-summary button').forEach(button=>{
      const text=(button.textContent||'').trim().toLowerCase()
      if(text.includes('reservar horário')||text.includes('reservando'))button.remove()
    })
  }

  page.querySelectorAll<HTMLElement>('.info-box').forEach(box=>{
    if(isGenericResidual(box.textContent||''))box.remove()
  })
}

function relevantMutation(records:MutationRecord[]){
  return records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>{
    if(!(node instanceof HTMLElement))return false
    return node.matches('.patient-page,.booking-summary,.payment-actions,.info-box')||Boolean(node.querySelector('.patient-page,.booking-summary,.payment-actions,.info-box'))
  }))
}

export function installPatientPaymentStabilizer(){
  if(installed)return
  installed=true
  ensureStyle()

  let frame=0
  const schedule=()=>{
    if(frame)return
    frame=window.requestAnimationFrame(()=>{frame=0;enforcePaymentStage()})
  }
  document.addEventListener('click',event=>{
    const target=event.target as HTMLElement|null
    const button=target?.closest<HTMLButtonElement>('.patient-page .booking-summary button')
    if(button&&(button.textContent||'').toLowerCase().includes('reservar horário')){
      window.setTimeout(schedule,0)
      window.setTimeout(schedule,150)
      window.setTimeout(schedule,600)
    }
  },true)

  const root=document.getElementById('root')
  if(root)new MutationObserver(records=>{if(relevantMutation(records))schedule()}).observe(root,{childList:true,subtree:true})
  window.addEventListener('resize',schedule,{passive:true})
  window.addEventListener('pageshow',schedule)
  schedule()
}
