let installed=false
let weekOffset=0
let bypass=false

const mondayOf=(value:Date)=>{const d=new Date(value);d.setHours(0,0,0,0);const day=d.getDay();d.setDate(d.getDate()-(day===0?6:day-1));return d}
const addDays=(d:Date,n:number)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x}
const ymd=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const ddmm=(d:Date)=>`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`
const weekday=(d:Date)=>{
  const raw=new Intl.DateTimeFormat('pt-BR',{weekday:'long'}).format(d).replace('-feira','')
  return raw.charAt(0).toUpperCase()+raw.slice(1)
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

async function warmAndSwitch(button:HTMLButtonElement,direction:1|-1){
  const nextOffset=Math.max(0,weekOffset+direction)
  if(nextOffset===weekOffset&&direction<0)return
  const start=addDays(mondayOf(new Date()),nextOffset*7),end=addDays(start,4)
  const path=`/api/availability?from=${encodeURIComponent(ymd(start))}&to=${encodeURIComponent(ymd(end))}`
  const host=document.querySelector<HTMLElement>('.patient-stable-view')
  host?.classList.add('week-changing')
  try{
    const response=await fetch(path,{credentials:'include',cache:'no-store'})
    const body=await response.text()
    const status=response.status
    const headers={'content-type':response.headers.get('content-type')||'application/json; charset=utf-8'}
    const originalFetch=window.fetch.bind(window)
    let used=false
    window.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{
      const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url
      if(!used&&url.includes('/api/availability?')&&url.includes(`from=${encodeURIComponent(ymd(start))}`)&&url.includes(`to=${encodeURIComponent(ymd(end))}`)){
        used=true
        window.fetch=originalFetch
        return Promise.resolve(new Response(body,{status,headers}))
      }
      return originalFetch(input,init)
    }) as typeof window.fetch
    window.setTimeout(()=>{if(window.fetch!==originalFetch&&used===false)window.fetch=originalFetch},1000)
    weekOffset=nextOffset
    bypass=true
    button.click()
    bypass=false
  }catch{
    weekOffset=nextOffset
    bypass=true
    button.click()
    bypass=false
  }finally{
    window.setTimeout(()=>host?.classList.remove('week-changing'),120)
  }
}

export function installPatientWeekPolish(){
  if(installed)return
  installed=true
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
    const button=(next||prev)!
    void warmAndSwitch(button,next?1:-1)
  },true)
  document.addEventListener('click',event=>{
    const tab=(event.target as HTMLElement|null)?.closest<HTMLButtonElement>('[data-patient-tab="agenda"]')
    if(!tab)return
  },true)
}
