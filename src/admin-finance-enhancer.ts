import './admin-finance-enhancer.css'

type Appointment={status:string;amount_cents:number;paid_at?:string|null}
type MonthRow={key:string;year:number;month:number;total:number;count:number}

const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(cents)||0)/100)
const monthName=(year:number,month:number)=>new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(year,month,1)).replace(/^./,c=>c.toUpperCase())
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]||c))

async function loadAppointments(){
  const response=await fetch('/api/admin/appointments',{credentials:'include',cache:'no-store'})
  const data=await response.json().catch(()=>({})) as any
  if(!response.ok)throw new Error(data.message||'Não foi possível carregar o faturamento.')
  return (data.appointments||[]) as Appointment[]
}

function financeButton(){
  return [...document.querySelectorAll<HTMLButtonElement>('.admin-sidebar nav button')].find(button=>{
    const text=(button.textContent||'').trim()
    return text==='Pagamentos'||text==='Financeiro'||button.dataset.adminView==='pagamentos'
  })
}

function normalizeLabels(){
  const button=financeButton()
  const sidebar=document.querySelector<HTMLElement>('.admin-sidebar')
  const navigationReady=button?.dataset.adminView==='pagamentos'||sidebar?.dataset.desktopNavBound==='1'
  if(button&&!navigationReady)return
  if(button&&(button.textContent||'').trim()!=='Financeiro'){
    const textNodes=[...button.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE)
    if(textNodes.length)textNodes[textNodes.length-1].textContent=' Financeiro'
    else button.append(' Financeiro')
  }
  const title=document.querySelector<HTMLElement>('.admin-topbar h1')
  if(title?.textContent?.trim()==='Pagamentos')title.textContent='Financeiro'
  if(title?.textContent?.trim()==='Financeiro')button?.classList.add('active')
}

function addMonthlyButton(){
  const title=(document.querySelector<HTMLElement>('.admin-topbar h1')?.textContent||'').trim()
  if(title!=='Financeiro'&&title!=='Pagamentos')return
  const host=document.querySelector<HTMLElement>('.admin-custom-view')
  if(!host||host.dataset.monthlyBilling==='1'||host.querySelector('[data-monthly-billing-open]'))return
  const summary=host.querySelector<HTMLElement>('.admin-finance-summary')
  if(!summary)return
  const bar=document.createElement('div')
  bar.className='admin-finance-toolbar'
  bar.innerHTML='<button type="button" class="admin-finance-monthly-button" data-monthly-billing-open>Faturamento Mensal</button>'
  host.insertBefore(bar,summary)
  bar.querySelector<HTMLButtonElement>('[data-monthly-billing-open]')?.addEventListener('click',()=>void renderMonthly(host))
}

function groupMonths(appointments:Appointment[]):MonthRow[]{
  const map=new Map<string,MonthRow>()
  appointments.filter(a=>a.status==='confirmed'&&a.paid_at).forEach(a=>{
    const d=new Date(String(a.paid_at));if(Number.isNaN(d.getTime()))return
    const year=d.getFullYear(),month=d.getMonth(),key=`${year}-${String(month+1).padStart(2,'0')}`
    const row=map.get(key)||{key,year,month,total:0,count:0}
    row.total+=Number(a.amount_cents||0);row.count+=1;map.set(key,row)
  })
  return [...map.values()].sort((a,b)=>b.key.localeCompare(a.key))
}

async function renderMonthly(host:HTMLElement){
  host.dataset.monthlyBilling='1'
  host.innerHTML='<div class="admin-dashboard-empty">Carregando faturamento mensal...</div>'
  try{
    const rows=groupMonths(await loadAppointments())
    const total=rows.reduce((sum,row)=>sum+row.total,0)
    const count=rows.reduce((sum,row)=>sum+row.count,0)
    host.innerHTML=`<div class="admin-monthly-header"><button type="button" class="admin-finance-back" data-monthly-billing-back>← Voltar</button><div><span class="section-kicker">Financeiro</span><h2>Faturamento Mensal</h2><p>Resumo dos pagamentos confirmados agrupados pelo mês de recebimento.</p></div></div><section class="admin-finance-summary admin-monthly-summary"><article class="admin-kpi"><small>Faturamento histórico</small><strong>${esc(money(total))}</strong><span>${count} pagamento(s) confirmado(s)</span></article><article class="admin-kpi"><small>Meses com recebimento</small><strong>${rows.length}</strong><span>Histórico consolidado</span></article></section><section class="admin-table-card admin-monthly-table"><div class="admin-table-row header"><span>Mês</span><span>Consultas pagas</span><span>Faturamento</span></div>${rows.length?rows.map(row=>`<div class="admin-table-row"><div><strong>${esc(monthName(row.year,row.month))}</strong></div><div><strong>${row.count}</strong><small>pagamento(s) confirmado(s)</small></div><div><strong>${esc(money(row.total))}</strong></div></div>`).join(''):'<div class="admin-dashboard-empty">Ainda não existem pagamentos confirmados para exibir.</div>'}</section>`
    host.querySelector<HTMLButtonElement>('[data-monthly-billing-back]')?.addEventListener('click',()=>{
      host.dataset.monthlyBilling='0'
      financeButton()?.click()
    })
  }catch(error){
    host.innerHTML=`<div class="admin-monthly-header"><button type="button" class="admin-finance-back" data-monthly-billing-back>← Voltar</button></div><div class="error-box">${esc(error instanceof Error?error.message:'Não foi possível carregar o faturamento mensal.')}</div>`
    host.querySelector<HTMLButtonElement>('[data-monthly-billing-back]')?.addEventListener('click',()=>financeButton()?.click())
  }
}

export function installAdminFinanceEnhancer(){
  const apply=()=>{normalizeLabels();addMonthlyButton()}
  ;[0,100,300,700].forEach(ms=>window.setTimeout(apply,ms))
  const root=document.getElementById('root')
  if(root)new MutationObserver(()=>apply()).observe(root,{childList:true,subtree:true,characterData:true})
}
