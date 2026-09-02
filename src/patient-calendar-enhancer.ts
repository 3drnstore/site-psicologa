const dayLabel=(value:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long'}).format(new Date(value))
const dayNumber=(value:string)=>new Intl.DateTimeFormat('pt-BR',{day:'numeric'}).format(new Date(value))
const weekday=(value:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'long'}).format(new Date(value)).replace(/^./,c=>c.toUpperCase())
const timeOnly=(value:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(value))
const addDays=(value:Date,n:number)=>{const d=new Date(value);d.setDate(d.getDate()+n);return d}
const mondayOf=(value:Date)=>{const d=new Date(value.getFullYear(),value.getMonth(),value.getDate());const day=d.getDay();d.setDate(d.getDate()-(day===0?6:day-1));d.setHours(0,0,0,0);return d}
const monthName=(value:Date)=>new Intl.DateTimeFormat('pt-BR',{month:'long'}).format(value).replace(/^./,c=>c.toUpperCase())

let running=false
let scheduled:number|undefined
let weekCursor:Date|null=null

function isoDateOnly(value:Date){return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`}

function weekMonthLabel(start:Date,end:Date){
  const sameMonth=start.getMonth()===end.getMonth()&&start.getFullYear()===end.getFullYear()
  if(sameMonth)return `${monthName(start)} de ${start.getFullYear()}`
  if(start.getFullYear()===end.getFullYear())return `${monthName(start)}/${monthName(end)} de ${start.getFullYear()}`
  return `${monthName(start)} de ${start.getFullYear()}/${monthName(end)} de ${end.getFullYear()}`
}

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
        let label=button.querySelector<HTMLElement>('[data-patient-status]')
        if(!label){
          const existing=button.querySelector<HTMLElement>('span')
          label=existing||document.createElement('span')
          label.dataset.patientStatus='1'
          if(!existing)button.appendChild(label)
        }
        if(status==='blocked'){
          label.textContent='Bloqueado'
          button.classList.add('blocked')
        }else if(status==='occupied'){
          label.textContent='Ocupado'
          button.classList.remove('blocked')
        }else{
          label.textContent='Disponível'
          button.classList.remove('blocked')
        }
      })
    })

    list.classList.add('patient-calendar-grid')
    if(!weekCursor)weekCursor=mondayOf(new Date())
    const sections=[...document.querySelectorAll<HTMLElement>('.availability-day.patient-calendar-day')]

    const applyWeek=()=>{
      if(!weekCursor)return
      const start=mondayOf(weekCursor),end=addDays(start,5)
      sections.forEach(section=>{
        const raw=section.dataset.patientDate
        if(!raw){section.style.display='none';return}
        const date=new Date(raw);date.setHours(0,0,0,0)
        section.style.display=date>=start&&date<=end?'':'none'
      })
      const toolbar=document.querySelector<HTMLElement>('.patient-calendar-toolbar')
      const period=toolbar?.querySelector<HTMLElement>('.patient-calendar-period')
      if(period)period.innerHTML=`<strong>${weekMonthLabel(start,end)}</strong><span>${dayNumber(start.toISOString())} a ${dayNumber(end.toISOString())}</span>`
      localStorage.setItem('patientCalendarWeek',isoDateOnly(start))
    }

    let toolbar=document.querySelector<HTMLElement>('.patient-calendar-toolbar')
    if(!toolbar){
      const saved=localStorage.getItem('patientCalendarWeek')
      if(saved){const parsed=new Date(`${saved}T12:00:00`);if(!Number.isNaN(parsed.getTime()))weekCursor=mondayOf(parsed)}
      toolbar=document.createElement('div')
      toolbar.className='patient-calendar-toolbar'
      toolbar.innerHTML=`<button type="button" class="patient-calendar-nav" data-week="prev" aria-label="Semana anterior">‹</button><div class="patient-calendar-period"></div><button type="button" class="patient-calendar-nav" data-week="next" aria-label="Próxima semana">›</button>`
      list.before(toolbar)
      toolbar.querySelector('[data-week="prev"]')?.addEventListener('click',()=>{weekCursor=addDays(weekCursor||new Date(),-7);applyWeek()})
      toolbar.querySelector('[data-week="next"]')?.addEventListener('click',()=>{weekCursor=addDays(weekCursor||new Date(),7);applyWeek()})
    }
    applyWeek()
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
