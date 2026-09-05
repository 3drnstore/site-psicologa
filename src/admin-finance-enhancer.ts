import './admin-finance-enhancer.css'

type Appointment={status:string;amount_cents:number;paid_at?:string|null}
type MonthRow={key:string;year:number;month:number;total:number;count:number}
type StatementEvent={kind:'received'|'refund';at:string;amount_cents:number;appointment_id:number;patient_name:string;description:string}
type StatementData={month:string;title:string;events:StatementEvent[];received_cents:number;refunds_cents:number;net_cents:number;available_months:{key:string;label:string}[]}
type PaymentTestStatus={ok:boolean;enabled:boolean;pending?:{appointment_id:number;payment_id:number;patient_name:string;starts_at:string;amount_cents:number;checkout_ready:boolean}|null}

const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(cents)||0)/100)
const monthName=(year:number,month:number)=>new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(year,month,1)).replace(/^./,c=>c.toUpperCase())
const dateTime=(v:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(v))
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]||c))

async function getJson(path:string){const response=await fetch(path,{credentials:'include',cache:'no-store'});const data=await response.json().catch(()=>({})) as any;if(!response.ok)throw new Error(data.message||'Não foi possível carregar o financeiro.');return data}
async function loadAppointments(){const data=await getJson('/api/admin/appointments');return (data.appointments||[]) as Appointment[]}
async function loadStatement(month?:string){return await getJson(`/api/admin/finance-statement${month?`?month=${encodeURIComponent(month)}`:''}`) as StatementData}

function financeButton(){return [...document.querySelectorAll<HTMLButtonElement>('.admin-sidebar nav button')].find(button=>{const text=(button.textContent||'').trim();return text==='Pagamentos'||text==='Financeiro'||button.dataset.adminView==='pagamentos'})}
function normalizeLabels(){
  const button=financeButton(),sidebar=document.querySelector<HTMLElement>('.admin-sidebar'),navigationReady=button?.dataset.adminView==='pagamentos'||sidebar?.dataset.desktopNavBound==='1'
  if(button&&!navigationReady)return
  if(button&&(button.textContent||'').trim()!=='Financeiro'){const textNodes=[...button.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE);if(textNodes.length)textNodes[textNodes.length-1].textContent=' Financeiro';else button.append(' Financeiro')}
  const title=document.querySelector<HTMLElement>('.admin-topbar h1');if(title?.textContent?.trim()==='Pagamentos')title.textContent='Financeiro';if(title?.textContent?.trim()==='Financeiro')button?.classList.add('active')
}

function groupMonths(appointments:Appointment[]):MonthRow[]{
  const map=new Map<string,MonthRow>()
  appointments.filter(a=>a.status==='confirmed'&&a.paid_at).forEach(a=>{const d=new Date(String(a.paid_at));if(Number.isNaN(d.getTime()))return;const year=d.getFullYear(),month=d.getMonth(),key=`${year}-${String(month+1).padStart(2,'0')}`;const row=map.get(key)||{key,year,month,total:0,count:0};row.total+=Number(a.amount_cents||0);row.count+=1;map.set(key,row)})
  return [...map.values()].sort((a,b)=>b.key.localeCompare(a.key))
}

async function renderMonthly(host:HTMLElement){
  host.dataset.monthlyBilling='1';host.innerHTML='<div class="admin-dashboard-empty">Carregando faturamento mensal...</div>'
  try{const rows=groupMonths(await loadAppointments()),total=rows.reduce((sum,row)=>sum+row.total,0),count=rows.reduce((sum,row)=>sum+row.count,0);host.innerHTML=`<div class="admin-monthly-header"><button type="button" class="admin-finance-back" data-monthly-billing-back>← Voltar</button><div><span class="section-kicker">Financeiro</span><h2>Faturamento Mensal</h2><p>Resumo dos pagamentos confirmados agrupados pelo mês de recebimento.</p></div></div><section class="admin-finance-summary admin-monthly-summary"><article class="admin-kpi"><small>Faturamento histórico</small><strong>${esc(money(total))}</strong><span>${count} pagamento(s) confirmado(s)</span></article><article class="admin-kpi"><small>Meses com recebimento</small><strong>${rows.length}</strong><span>Histórico consolidado</span></article></section><section class="admin-table-card admin-monthly-table"><div class="admin-table-row header"><span>Mês</span><span>Consultas pagas</span><span>Faturamento</span></div>${rows.length?rows.map(row=>`<div class="admin-table-row"><div><strong>${esc(monthName(row.year,row.month))}</strong></div><div><strong>${row.count}</strong><small>pagamento(s) confirmado(s)</small></div><div><strong>${esc(money(row.total))}</strong></div></div>`).join(''):'<div class="admin-dashboard-empty">Ainda não existem pagamentos confirmados para exibir.</div>'}</section>`;host.querySelector<HTMLButtonElement>('[data-monthly-billing-back]')?.addEventListener('click',()=>financeButton()?.click())}
  catch(error){host.innerHTML=`<div class="admin-monthly-header"><button type="button" class="admin-finance-back" data-monthly-billing-back>← Voltar</button></div><div class="error-box">${esc(error instanceof Error?error.message:'Não foi possível carregar o faturamento mensal.')}</div>`;host.querySelector<HTMLButtonElement>('[data-monthly-billing-back]')?.addEventListener('click',()=>financeButton()?.click())}
}

async function renderStatement(host:HTMLElement,month?:string){
  host.dataset.financeSubview='statement';host.innerHTML='<div class="admin-dashboard-empty">Carregando extrato...</div>'
  try{
    const data=await loadStatement(month),events=[...data.events].reverse()
    host.innerHTML=`<div class="admin-statement-header"><button type="button" class="admin-finance-back" data-statement-back>← Voltar</button><div><span class="section-kicker">Financeiro</span><h2>Extrato</h2><p>Movimentação financeira de ${esc(data.title)}.</p></div></div><div class="admin-statement-controls"><label>Mês<select data-statement-month>${data.available_months.map(item=>`<option value="${esc(item.key)}" ${item.key===data.month?'selected':''}>${esc(item.label)}</option>`).join('')}</select></label><a class="admin-finance-statement-pdf" href="/api/admin/finance-statement.pdf?month=${encodeURIComponent(data.month)}" download="extrato-${esc(data.month)}.pdf">Gerar PDF</a></div><section class="admin-finance-summary admin-statement-summary"><article class="admin-kpi success"><small>Recebimentos</small><strong>${esc(money(data.received_cents))}</strong><span>Entradas do mês</span></article><article class="admin-kpi admin-refund-kpi"><small>Estornos</small><strong>${esc(money(data.refunds_cents))}</strong><span>Consultas pagas canceladas</span></article><article class="admin-kpi"><small>Saldo líquido</small><strong>${esc(money(data.net_cents))}</strong><span>Recebimentos menos estornos</span></article></section><section class="admin-statement-card"><div class="admin-statement-row header"><span>Data</span><span>Paciente</span><span>Descrição</span><span>Valor</span></div>${events.length?events.map(event=>`<div class="admin-statement-row ${event.kind}"><div><strong>${esc(dateTime(event.at))}</strong></div><div><strong>${esc(event.patient_name)}</strong><small>Consulta #${event.appointment_id}</small></div><div><strong>${event.kind==='received'?'Recebimento':'Estorno'}</strong><small>${esc(event.description)}</small></div><div class="admin-statement-value ${event.kind}"><strong>${event.kind==='received'?'+':'−'} ${esc(money(event.amount_cents))}</strong></div></div>`).join(''):'<div class="admin-dashboard-empty">Nenhuma movimentação registrada neste mês.</div>'}</section>`
    host.querySelector<HTMLButtonElement>('[data-statement-back]')?.addEventListener('click',()=>financeButton()?.click())
    host.querySelector<HTMLSelectElement>('[data-statement-month]')?.addEventListener('change',event=>void renderStatement(host,(event.currentTarget as HTMLSelectElement).value))
  }catch(error){host.innerHTML=`<div class="admin-monthly-header"><button type="button" class="admin-finance-back" data-statement-back>← Voltar</button></div><div class="error-box">${esc(error instanceof Error?error.message:'Não foi possível carregar o extrato.')}</div>`;host.querySelector<HTMLButtonElement>('[data-statement-back]')?.addEventListener('click',()=>financeButton()?.click())}
}

async function ensurePaymentTestButton(bar:HTMLElement){
  if(bar.dataset.paymentTestChecked==='1')return
  bar.dataset.paymentTestChecked='1'
  try{
    const status=await getJson('/api/admin/payment-flow-test') as PaymentTestStatus
    if(!status.enabled||!status.pending||bar.querySelector('[data-payment-flow-test]'))return
    const button=document.createElement('button')
    button.type='button';button.className='admin-finance-monthly-button';button.dataset.paymentFlowTest='1';button.textContent='Testar cartão (sem cobrança)'
    bar.appendChild(button)
    button.addEventListener('click',async()=>{
      const pending=status.pending;if(!pending)return
      if(!confirm(`Executar teste técnico do cartão para a reserva de ${pending.patient_name}? Nenhuma cobrança será feita e a consulta permanecerá pendente após o teste.`))return
      button.disabled=true;button.textContent='Testando...'
      try{
        const response=await fetch('/api/admin/payment-flow-test',{method:'POST',credentials:'include',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({appointment_id:pending.appointment_id})})
        const data=await response.json().catch(()=>({})) as any
        if(!response.ok)throw new Error(data.message||'Não foi possível executar o teste.')
        const checks=data.checks||{}
        const mark=(value:any)=>value?.ok?'✓':'✗'
        alert(`${data.message||'Teste concluído.'}\n\n${mark(checks.checkout)} Checkout InfinitePay\n${mark(checks.database)} Confirmação no banco (revertida ao final)\n${mark(checks.email)} E-mail técnico\n${mark(checks.calendar)} Google Agenda`)
      }catch(error){alert(error instanceof Error?error.message:'Não foi possível executar o teste.')}finally{button.disabled=false;button.textContent='Testar cartão (sem cobrança)'}
    })
  }catch{delete bar.dataset.paymentTestChecked}
}

function ensureToolbar(){
  const title=(document.querySelector<HTMLElement>('.admin-topbar h1')?.textContent||'').trim();if(title!=='Financeiro'&&title!=='Pagamentos')return
  const host=document.querySelector<HTMLElement>('.admin-custom-view');if(!host||host.dataset.monthlyBilling==='1'||host.dataset.receitaSaude==='1'||host.dataset.financeSubview==='statement')return
  const summary=host.querySelector<HTMLElement>('.admin-finance-summary');if(!summary)return
  let bar=host.querySelector<HTMLElement>('.admin-finance-toolbar');if(!bar){bar=document.createElement('div');bar.className='admin-finance-toolbar';host.insertBefore(bar,summary)}
  if(!bar.querySelector('[data-monthly-billing-open]')){const button=document.createElement('button');button.type='button';button.className='admin-finance-monthly-button';button.dataset.monthlyBillingOpen='1';button.textContent='Faturamento Mensal';bar.appendChild(button);button.addEventListener('click',()=>void renderMonthly(host))}
  if(!bar.querySelector('[data-statement-open]')){const button=document.createElement('button');button.type='button';button.className='admin-finance-monthly-button admin-finance-statement-button';button.dataset.statementOpen='1';button.textContent='Extrato';bar.appendChild(button);button.addEventListener('click',()=>void renderStatement(host))}
  void ensurePaymentTestButton(bar)
}

async function decorateSummary(){
  const title=(document.querySelector<HTMLElement>('.admin-topbar h1')?.textContent||'').trim();if(title!=='Financeiro'&&title!=='Pagamentos')return
  const host=document.querySelector<HTMLElement>('.admin-custom-view');if(!host||host.dataset.monthlyBilling==='1'||host.dataset.receitaSaude==='1'||host.dataset.financeSubview==='statement'||host.dataset.financeSummaryDecorating==='1'||host.dataset.financeSummaryReady==='1')return
  const summary=host.querySelector<HTMLElement>('.admin-finance-summary');if(!summary)return
  const cards=[...summary.children].filter((item):item is HTMLElement=>item instanceof HTMLElement);if(cards.length<3)return
  host.dataset.financeSummaryDecorating='1'
  try{const data=await loadStatement();if(!host.isConnected)return;const current=[...summary.children].filter((item):item is HTMLElement=>item instanceof HTMLElement);if(current.length<3||current[1].classList.contains('admin-finance-split-card'))return;const pending=current[1],wrap=document.createElement('div');wrap.className='admin-finance-split-card';pending.replaceWith(wrap);wrap.appendChild(pending);const refunds=data.events.filter(event=>event.kind==='refund').length,refund=document.createElement('article');refund.className='admin-kpi admin-refund-kpi';refund.innerHTML=`<small>Estornos</small><strong>${esc(money(data.refunds_cents))}</strong><span>${refunds} cancelamento(s) de consulta paga no mês</span>`;wrap.appendChild(refund);host.dataset.financeSummaryReady='1'}catch{}finally{delete host.dataset.financeSummaryDecorating}
}

export function installAdminFinanceEnhancer(){
  const apply=()=>{normalizeLabels();ensureToolbar();void decorateSummary()}
  ;[0,100,300,700,1200].forEach(ms=>window.setTimeout(apply,ms))
  const root=document.getElementById('root');if(root)new MutationObserver(()=>apply()).observe(root,{childList:true,subtree:true,characterData:true})
}
