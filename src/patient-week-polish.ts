let installed=false
let weekOffset=0
let bypass=false

type CachedWeek={body:string;status:number;contentType:string}
const weekCache=new Map<number,Promise<CachedWeek>>()

const mondayOf=(value:Date)=>{const d=new Date(value);d.setHours(0,0,0,0);const day=d.getDay();d.setDate(d.getDate()-(day===0?6:day-1));return d}
const addDays=(d:Date,n:number)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x}
const ymd=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const ddmm=(d:Date)=>`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`
const weekday=(d:Date)=>{const raw=new Intl.DateTimeFormat('pt-BR',{weekday:'long'}).format(d).replace('-feira','');return raw.charAt(0).toUpperCase()+raw.slice(1)}

function weekPath(offset:number){
  const start=addDays(mondayOf(new Date()),offset*7),end=addDays(start,4)
  return `/api/availability?from=${encodeURIComponent(ymd(start))}&to=${encodeURIComponent(ymd(end))}`
}

function preloadWeek(offset:number){
  if(offset<0)return Promise.reject(new Error('Semana inválida'))
  const cached=weekCache.get(offset)
  if(cached)return cached
  const promise=fetch(weekPath(offset),{credentials:'include',cache:'no-store'}).then(async response=>({
    body:await response.text(),status:response.status,contentType:response.headers.get('content-type')||'application/json; charset=utf-8'
  })).catch(error=>{weekCache.delete(offset);throw error})
  weekCache.set(offset,promise)
  return promise
}

function primeAdjacent(){
  void preloadWeek(weekOffset+1).catch(()=>null)
  if(weekOffset>0)void preloadWeek(weekOffset-1).catch(()=>null)
}

function updateChosenDate(button:HTMLButtonElement){
  const day=button.closest<HTMLElement>('.patient-week-day')
  const grid=button.closest<HTMLElement>('.patient-week-grid')
  if(!day||!grid)return
  const index=Array.from(grid.children).indexOf(day)
  if(index<0)return
  const date=addDays(mondayOf(new Date()),weekOffset*7+index)
  window.setTimeout(()=>{
    const choice=document.querySelector<HTMLElement>('.patient-booking-choice')
    if(!choice)return
    const time=button.querySelector('span')?.textContent||choice.querySelector('strong')?.textContent||'Selecione um horário'
    choice.innerHTML=`<div><small>Data escolhida:</small><strong>${weekday(date)}, ${ddmm(date)}</strong></div><div><small>Horário escolhido:</small><strong>${time}</strong></div>`
  },0)
}

function installCachedFetch(offset:number,data:CachedWeek){
  const path=weekPath(offset)
  const originalFetch=window.fetch.bind(window)
  let used=false
  window.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url
    if(!used&&url.includes('/api/availability?')&&url.includes(path.split('?')[1])){
      used=true
      window.fetch=originalFetch
      return Promise.resolve(new Response(data.body,{status:data.status,headers:{'content-type':data.contentType}}))
    }
    return originalFetch(input,init)
  }) as typeof window.fetch
  window.setTimeout(()=>{if(!used)window.fetch=originalFetch},1200)
}

async function switchWeek(button:HTMLButtonElement,direction:1|-1){
  const nextOffset=Math.max(0,weekOffset+direction)
  if(nextOffset===weekOffset&&direction<0)return
  const host=document.querySelector<HTMLElement>('.patient-stable-view')
  host?.classList.add('week-changing')
  try{
    const data=await preloadWeek(nextOffset)
    installCachedFetch(nextOffset,data)
    weekOffset=nextOffset
    bypass=true
    button.click()
    bypass=false
    window.setTimeout(primeAdjacent,0)
  }catch{
    weekOffset=nextOffset
    bypass=true
    button.click()
    bypass=false
  }finally{
    window.setTimeout(()=>host?.classList.remove('week-changing'),80)
  }
}

function schedulePrime(){
  ;[80,180,350,700].forEach(delay=>window.setTimeout(()=>{
    if(document.querySelector('.patient-week-nav'))primeAdjacent()
  },delay))
}

export function installPatientWeekPolish(){
  if(installed)return
  installed=true
  schedulePrime()
  document.addEventListener('click',event=>{
    const target=event.target as HTMLElement|null
    const slot=target?.closest<HTMLButtonElement>('.patient-slot[data-slot-id]')
    if(slot){updateChosenDate(slot);return}
    const next=target?.closest<HTMLButtonElement>('[data-week-next]')
    const prev=target?.closest<HTMLButtonElement>('[data-week-prev]')
    if(!next&&!prev)return
    if(bypass)return
    event.preventDefault()
    event.stopImmediatePropagation()
    void switchWeek((next||prev)!,next?1:-1)
  },true)
  document.addEventListener('click',event=>{
    const tab=(event.target as HTMLElement|null)?.closest<HTMLButtonElement>('[data-patient-tab="agenda"]')
    if(tab)schedulePrime()
  },true)
  window.addEventListener('pageshow',schedulePrime)
}
