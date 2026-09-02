const dayLabel=(value:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long'}).format(new Date(value))
const monthYear=(value:string)=>new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(value)).replace(/^./,c=>c.toUpperCase())
const dayNumber=(value:string)=>new Intl.DateTimeFormat('pt-BR',{day:'numeric'}).format(new Date(value))
const weekday=(value:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'long'}).format(new Date(value)).replace(/^./,c=>c.toUpperCase())
const timeOnly=(value:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(value))

let running=false
let scheduled:number|undefined

async function enhance(){
  if(running)return
  const page=document.querySelector('.patient-page')
  const list=document.querySelector<HTMLElement>('.availability-list')
  if(!page||!list)return
  running=true
  try{
    const r=await fetch('/api/availability',{credentials:'include'})
    if(!r.ok)return
    const data=await r.json().catch(()=>({})) as any
    const slots:any[]=data.slots||[]
    const byDay=new Map<string,any[]>()
    slots.forEach(slot=>{
      const key=dayLabel(slot.starts_at)
      byDay.set(key,[...(byDay.get(key)||[]),slot])
    })

    document.querySelectorAll<HTMLElement>('.availability-day').forEach(section=>{
      const h2=section.querySelector<HTMLElement>('h2')
      if(!h2)return
      const original=section.dataset.patientDayLabel||h2.textContent?.trim()||''
      if(!section.dataset.patientDayLabel)section.dataset.patientDayLabel=original
      const daySlots=byDay.get(original)||[]
      const first=daySlots[0]
      if(first){
        section.dataset.patientDate=first.starts_at
        h2.innerHTML=`<strong>${dayNumber(first.starts_at)}</strong><span>${weekday(first.starts_at)}</span>`
      }
      section.classList.add('patient-calendar-day')
      section.querySelectorAll<HTMLButtonElement>('.time').forEach(button=>{
        button.classList.add('patient-calendar-slot')
        const match=(button.textContent||'').match(/(\d{2}:\d{2})/)
        if(!match)return
        const slot=daySlots.find(s=>timeOnly(s.starts_at)===match[1])
        if(!slot)return
        const status=slot.public_status||'occupied'
        button.dataset.publicStatus=status
        let label=button.querySelector<HTMLElement>('span')
        if(status==='blocked'){
          if(!label){label=document.createElement('span');button.appendChild(label)}
          label.textContent='Bloqueado'
          button.classList.add('blocked')
        }else if(status==='occupied'){
          if(!label){label=document.createElement('span');button.appendChild(label)}
          label.textContent='Ocupado'
          button.classList.remove('blocked')
        }else{
          button.classList.remove('blocked')
        }
      })
    })

    list.classList.add('patient-calendar-grid')
    if(!document.querySelector('.patient-calendar-toolbar')&&slots.length){
      const first=slots[0],last=slots[slots.length-1]
      const toolbar=document.createElement('div')
      toolbar.className='patient-calendar-toolbar'
      toolbar.innerHTML=`<div class="patient-calendar-period"><strong>${monthYear(first.starts_at)}</strong><span>${dayNumber(first.starts_at)} a ${dayNumber(last.starts_at)}</span></div>`
      list.before(toolbar)
    }
  }finally{running=false}
}

export function installPatientCalendarEnhancer(){
  const schedule=()=>{
    if(scheduled)window.clearTimeout(scheduled)
    scheduled=window.setTimeout(()=>{scheduled=undefined;void enhance()},120)
  }
  schedule()
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true})
}
