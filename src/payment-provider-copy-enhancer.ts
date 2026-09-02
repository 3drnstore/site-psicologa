let installed=false

function update(){
  document.querySelectorAll<HTMLElement>('.site-shell p,.patient-page button').forEach(el=>{
    const text=el.textContent||''
    if(text.includes('Pix SumUp'))el.textContent=text.replace('Pix SumUp','Pix Mercado Pago')
    if(text.includes('Pix • SumUp'))el.textContent=text.replace('Pix • SumUp','Pix • Mercado Pago')
  })
}

export function installPaymentProviderCopyEnhancer(){
  if(installed)return
  installed=true
  update()
  new MutationObserver(update).observe(document.body,{childList:true,subtree:true})
}
