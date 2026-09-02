let scheduled:number|undefined
let running=false

const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((cents||0)/100)
async function getJson(path:string){const r=await fetch(path,{credentials:'include'});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível carregar os valores.');return d}
async function putJson(path:string,data:any){const r=await fetch(path,{method:'PUT',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível salvar os valores.');return d}

function ensureStyle(){
  if(document.getElementById('pricing-v2-style'))return
  const style=document.createElement('style');style.id='pricing-v2-style';style.textContent=`
  .booking-summary[data-pricing-v2]{background:#e7f0eb!important;border-color:#cfddd5!important}
  .booking-summary[data-pricing-v2] .patient-session-info{display:none!important}
  .booking-summary[data-pricing-v2] .pricing-v2-copy{display:grid;gap:4px;flex:1 1 520px;color:#3f5750;font-size:14px;line-height:1.55;font-weight:500}
  .booking-summary[data-pricing-v2] .pricing-v2-copy p{margin:0;display:block}
  .booking-summary[data-pricing-v2] .pricing-v2-copy .pricing-v2-values{color:#294b44;font-weight:700;margin-top:3px}
  .pricing-v2-admin{display:grid;gap:18px}.pricing-v2-admin .pricing-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.pricing-v2-admin label{display:grid;gap:7px;font-weight:700}.pricing-v2-admin input{width:100%;border:1px solid #d6dfda;border-radius:11px;padding:12px 13px;background:#fff;font:inherit}.pricing-v2-note{padding:12px 14px;border-radius:10px;background:#f4f7f5;color:#5f6e68;font-size:13px;line-height:1.5}.pricing-v2-msg{padding:10px 12px;border-radius:9px;background:#edf6f0;color:#245a45}.pricing-v2-msg.error{background:#fff1ef;color:#9b3d31}.pricing-v2-title{margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:26px;color:#173f38}
  @media(max-width:700px){.pricing-v2-admin .pricing-grid{grid-template-columns:1fr}.booking-summary[data-pricing-v2] .pricing-v2-copy{flex-basis:100%;text-align:left}}
  `;document.head.appendChild(style)
}

function relabelLegacyForm(form:HTMLFormElement|null){
  if(!form)return
  const labels=[...form.querySelectorAll<HTMLLabelElement>('label')]
  const first=labels[0],second=labels[1]
  if(first){const input=first.querySelector('input');first.childNodes.forEach(n=>{if(n.nodeType===Node.TEXT_NODE)n.textContent=''}) ;first.insertBefore(document.createTextNode('Valor Pix (R$)'),input||first.firstChild)}
  if(second){const input=second.querySelector('input');second.childNodes.forEach(n=>{if(n.nodeType===Node.TEXT_NODE)n.textContent=''}) ;second.insertBefore(document.createTextNode('Valor Cartão (R$)'),input||second.firstChild)}
}

async function enhanceAdmin(){
  const panel=document.querySelector<HTMLElement>('.settings-panel')
  if(!panel||panel.querySelector('.pricing-v2-admin'))return
  const oldForm=panel.querySelector<HTMLFormElement>('form.admin-form')
  relabelLegacyForm(oldForm)
  let s:any={}
  try{const data=await getJson('/api/admin/settings');s=data.settings||{}}
  catch(err){
    let msg=panel.querySelector<HTMLElement>('.pricing-v2-load-error')
    if(!msg){msg=document.createElement('div');msg.className='pricing-v2-msg error pricing-v2-load-error';panel.prepend(msg)}
    msg.textContent=err instanceof Error?err.message:String(err)
    if(oldForm)oldForm.style.display='grid'
    return
  }

  panel.querySelector('.pricing-v2-load-error')?.remove()
  if(oldForm)oldForm.style.display='none'
  const legacy=Number(s.consultation_price_cents||0)
  const pix=Number(s.pix_price_cents??legacy)
  const card=Number(s.card_price_cents??legacy)
  const form=document.createElement('form');form.className='pricing-v2-admin'
  form.innerHTML=`<div><h2 class="pricing-v2-title">Atendimento e cobrança</h2><div class="pricing-v2-note">Defina separadamente os valores cobrados conforme a forma de pagamento. Eles serão apresentados ao paciente de forma informativa no fluxo de agendamento, sem linguagem promocional.</div></div><div class="pricing-grid"><label>Valor Pix (R$)<input name="pix" type="number" min="0" step="0.01" required value="${(pix/100).toFixed(2)}"></label><label>Valor Cartão (R$)<input name="card" type="number" min="0" step="0.01" required value="${(card/100).toFixed(2)}"></label><label>Duração padrão (minutos)<input name="duration" type="number" min="10" value="${Number(s.appointment_duration_minutes||50)}"></label><label>Tempo de reserva aguardando pagamento (minutos)<input name="hold" type="number" min="5" value="${Number(s.hold_minutes||15)}"></label></div><button class="admin-primary" type="submit">Salvar configurações</button>`
  panel.appendChild(form)
  form.addEventListener('submit',async e=>{
    e.preventDefault();const fd=new FormData(form),btn=form.querySelector<HTMLButtonElement>('button')!;btn.disabled=true
    form.querySelector('.pricing-v2-msg')?.remove()
    try{
      await putJson('/api/admin/settings',{pix_price_cents:Math.round(Number(fd.get('pix')||0)*100),card_price_cents:Math.round(Number(fd.get('card')||0)*100),appointment_duration_minutes:Number(fd.get('duration')||50),hold_minutes:Number(fd.get('hold')||15)})
      const msg=document.createElement('div');msg.className='pricing-v2-msg';msg.textContent='Valores e condições de atendimento salvos.';form.prepend(msg)
    }catch(err){const msg=document.createElement('div');msg.className='pricing-v2-msg error';msg.textContent=err instanceof Error?err.message:String(err);form.prepend(msg)}finally{btn.disabled=false}
  })
}

async function enhancePatient(){
  const summary=document.querySelector<HTMLElement>('.patient-page .booking-summary')
  if(!summary||summary.dataset.pricingV2Loaded==='1')return
  summary.dataset.pricingV2Loaded='1'
  try{
    const data=await getJson('/api/availability')
    const pix=Number(data.pix_price_cents??data.consultation_price_cents??0)
    const card=Number(data.card_price_cents??data.consultation_price_cents??0)
    summary.dataset.pricingV2='1'
    let copy=summary.querySelector<HTMLElement>('.pricing-v2-copy')
    if(!copy){copy=document.createElement('div');copy.className='pricing-v2-copy';summary.prepend(copy)}
    copy.innerHTML=`<p>Sessão online com duração de 50 minutos.</p><p>O agendamento será confirmado após a confirmação do pagamento.</p><p>O pagamento deverá ser realizado na próxima etapa.</p><p class="pricing-v2-values">Valor da sessão: Pix: ${money(pix)} - Cartão: ${money(card)}</p>`
    const actions=summary.querySelector('.payment-actions')
    const buttons=actions?.querySelectorAll<HTMLButtonElement>('button')
    if(buttons&&buttons.length>=2){
      const pixText=`Pix — ${money(pix)}`;const cardText=`Cartão — ${money(card)}`
      if(buttons[0].textContent!==pixText)buttons[0].textContent=pixText
      if(buttons[1].textContent!==cardText)buttons[1].textContent=cardText
    }
  }catch(err){
    delete summary.dataset.pricingV2Loaded
    throw err
  }
}

async function enhance(){if(running)return;running=true;try{ensureStyle();if(document.querySelector('.admin-page'))await enhanceAdmin();if(document.querySelector('.patient-page'))await enhancePatient()}catch(err){console.error('Pricing UI enhancer:',err)}finally{running=false}}

function relevantMutation(records:MutationRecord[]){
  return records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>{
    if(!(node instanceof HTMLElement))return false
    return node.matches('.settings-panel,.patient-page,.booking-summary,.payment-actions')||Boolean(node.querySelector('.settings-panel,.patient-page,.booking-summary,.payment-actions'))
  }))
}

export function installPricingUiEnhancer(){
  const schedule=()=>{if(scheduled)clearTimeout(scheduled);scheduled=window.setTimeout(()=>{scheduled=undefined;void enhance()},140)}
  schedule()
  const root=document.getElementById('root')
  if(root)new MutationObserver(records=>{if(relevantMutation(records))schedule()}).observe(root,{childList:true,subtree:true})
  window.addEventListener('pageshow',schedule)
}
