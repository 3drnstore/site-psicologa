const dayLabel=(value:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long'}).format(new Date(value))
const dayNumber=(value:string)=>new Intl.DateTimeFormat('pt-BR',{day:'numeric'}).format(new Date(value))
const weekday=(value:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'long'}).format(new Date(value)).replace(/^./,c=>c.toUpperCase())
const timeOnly=(value:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(value))
const addDays=(value:Date,n:number)=>{const d=new Date(value);d.setDate(d.getDate()+n);return d}
const mondayOf=(value:Date)=>{const d=new Date(value.getFullYear(),value.getMonth(),value.getDate());const day=d.getDay();d.setDate(d.getDate()-(day===0?6:day-1));d.setHours(0,0,0,0);return d}
const monthShort=(value:Date)=>new Intl.DateTimeFormat('pt-BR',{month:'short'}).format(value).replace('.','').slice(0,3).toUpperCase()
const monthLong=(value:Date)=>new Intl.DateTimeFormat('pt-BR',{month:'long'}).format(value).replace(/^./,c=>c.toUpperCase())

let running=false
let scheduled:number|undefined
let weekCursor:Date|null=null

function isoDateOnly(value:Date){return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`}
function mobileDateLabel(value:string){return new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long'}).format(new Date(value))}
function isMobile(){return window.matchMedia('(max-width: 900px)').matches}
function currentWeekStart(){return mondayOf(new Date())}

function weekMonthLabel(start:Date,end:Date){
  const sameYear=start.getFullYear()===end.getFullYear()
  const sameMonth=sameYear&&start.getMonth()===end.getMonth()
  if(sameMonth)return monthLong(start)
  if(sameYear)return `${monthShort(start)}-${monthShort(end)}`
  return `${monthShort(start)}/${String(start.getFullYear()).slice(-2)}-${monthShort(end)}/${String(end.getFullYear()).slice(-2)}`
}

function forceMobileSection(section:HTMLElement){
  if(!isMobile())return
  section.style.setProperty('width','100%','important')
  section.style.setProperty('max-width','100%','important')
  section.style.setProperty('padding','22px','important')
  section.style.setProperty('border','1px solid #dfe5e1','important')
  section.style.setProperty('border-radius','24px','important')
  section.style.setProperty('background','#fff','important')
  section.style.setProperty('box-shadow','0 8px 24px rgba(23,63,57,.04)','important')
  const h2=section.querySelector<HTMLElement>('h2')
  if(h2){
    h2.style.setProperty('display','flex','important')
    h2.style.setProperty('align-items','center','important')
    h2.style.setProperty('justify-content','flex-start','important')
    h2.style.setProperty('gap','10px','important')
    h2.style.setProperty('margin','0 0 18px','important')
    h2.innerHTML=`<span style="font-size:22px;line-height:1;color:#173f39">▣</span><span style="display:inline!important;font-size:18px;font-weight:800;color:#213d38">${section.dataset.mobileDateLabel||''}</span>`
  }
  const grid=section.querySelector<HTMLElement>('.time-grid')
  if(grid){
    grid.style.setProperty('display','grid','important')
    grid.style.setProperty('grid-template-columns','repeat(2,minmax(0,1fr))','important')
    grid.style.setProperty('gap','12px','important')
  }
}

function surfaceReserveAction(button:HTMLButtonElement){
  if(!isMobile())return
  window.setTimeout(()=>{
    const summary=document.querySelector<HTMLElement>('.patient-page .booking-summary')
    const section=button.closest<HTMLElement>('.availability-day.patient-calendar-day')
    if(!summary||!section)return
    section.insertAdjacentElement('afterend',summary)
    summary.style.setProperty('display','grid','important')
    summary.style.setProperty('width','100%','important')
    summary.style.setProperty('margin','12px 0 6px','important')
    summary.scrollIntoView({behavior:'smooth',block:'center'})
  },100)
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
    slots.forEach(slot=>{const key=dayLabel(slot.starts_at);byDay.set(key,[...(byDay.get(key)||[]),slot])})

    document.querySelectorAll<HTMLElement>('.availability-day').forEach(section=>{
      const h2=section.querySelector<HTMLElement>('h2')
      if(!h2)return
      const original=section.dataset.patientDayLabel||h2.textContent?.trim()||''
      if(!section.dataset.patientDayLabel)section.dataset.patientDayLabel=original
      const daySlots=byDay.get(original)||[]
      const first=daySlots[0]
      if(first){
        section.dataset.patientDate=first.starts_at
        section.dataset.mobileDateLabel=mobileDateLabel(first.starts_at)
        if(!isMobile())h2.innerHTML=`<strong>${dayNumber(first.starts_at)}</strong><span>${weekday(first.starts_at)}</span>`
      }
      section.classList.add('patient-calendar-day')
      let freeCount=0
      section.querySelectorAll<HTMLButtonElement>('.time').forEach(button=>{
        button.classList.add('patient-calendar-slot')
        const match=(button.textContent||'').match(/(\d{2}:\d{2})/)
        if(!match)return
        const slot=daySlots.find(s=>timeOnly(s.starts_at)===match[1])
        if(!slot)return
        const status=slot.public_status||'occupied'
        const passed=new Date(slot.starts_at).getTime()<=Date.now()
        button.dataset.publicStatus=status
        button.dataset.past=passed?'1':'0'
        let label=button.querySelector<HTMLElement>('[data-patient-status]')
        if(!label){const existing=button.querySelector<HTMLElement>('span');label=existing||document.createElement('span');label.dataset.patientStatus='1';if(!existing)button.appendChild(label)}

        if(status==='blocked'){
          label.textContent='Bloqueado';button.classList.add('blocked');button.disabled=true
        }else if(status==='occupied'){
          label.textContent='Ocupado';button.classList.remove('blocked');button.disabled=true
        }else if(passed){
          label.textContent='Indisponível';button.classList.remove('blocked');button.classList.add('past');button.disabled=true
          button.style.setProperty('background','#f2f1ed','important')
          button.style.setProperty('border-color','#e0ddd6','important')
          button.style.setProperty('color','#8a8a82','important')
          button.style.setProperty('cursor','default','important')
        }else{
          freeCount++
          label.textContent='Disponível';button.classList.remove('blocked','past');button.disabled=false
          button.style.removeProperty('cursor')
          if(!button.dataset.reserveSurfaceBound){button.dataset.reserveSurfaceBound='1';button.addEventListener('click',()=>surfaceReserveAction(button))}
        }

        if(isMobile()){
          if(status!=='free'||passed)button.style.setProperty('display','none','important')
          else{
            button.style.setProperty('display','grid','important')
            button.style.setProperty('min-height','66px','important')
            button.style.setProperty('border-radius','14px','important')
            button.style.setProperty('background','#f7f9f7','important')
            button.style.setProperty('border-color','#dce4df','important')
            button.style.setProperty('color','#35534c','important')
            if(label)label.style.setProperty('display','none','important')
          }
        }
      })
      if(isMobile()){
        forceMobileSection(section)
        section.dataset.mobileHasFree=freeCount>0?'1':'0'
      }
    })

    list.classList.add('patient-calendar-grid')
    if(isMobile()){
      list.style.setProperty('display','grid','important')
      list.style.setProperty('grid-template-columns','1fr','important')
      list.style.setProperty('gap','18px','important')
      list.style.setProperty('overflow','hidden','important')
    }
    if(!weekCursor)weekCursor=mondayOf(new Date())
    const sections=[...document.querySelectorAll<HTMLElement>('.availability-day.patient-calendar-day')]

    const applyWeek=()=>{
      if(!weekCursor)return
      const minimum=!isMobile()?currentWeekStart():null
      if(minimum&&mondayOf(weekCursor)<minimum)weekCursor=minimum
      const start=mondayOf(weekCursor),end=addDays(start,5)
      sections.forEach(section=>{
        const raw=section.dataset.patientDate
        if(!raw){section.style.display='none';return}
        const date=new Date(raw);date.setHours(0,0,0,0)
        const inWeek=date>=start&&date<=end
        const mobileVisible=!isMobile()||section.dataset.mobileHasFree==='1'
        section.style.setProperty('display',inWeek&&mobileVisible?'block':'none','important')
      })
      const toolbar=document.querySelector<HTMLElement>('.patient-calendar-toolbar')
      const period=toolbar?.querySelector<HTMLElement>('.patient-calendar-period')
      if(period)period.innerHTML=`<strong>${weekMonthLabel(start,end)}</strong><span>${dayNumber(start.toISOString())} a ${dayNumber(end.toISOString())}</span>`
      const prev=toolbar?.querySelector<HTMLButtonElement>('[data-week="prev"]')
      if(prev&&!isMobile()){
        const atCurrent=start.getTime()<=currentWeekStart().getTime()
        prev.disabled=atCurrent
        prev.setAttribute('aria-disabled',String(atCurrent))
        prev.style.opacity=atCurrent?'0.35':'1'
        prev.style.cursor=atCurrent?'default':'pointer'
      }
      localStorage.setItem('patientCalendarWeek',isoDateOnly(start))
    }

    let toolbar=document.querySelector<HTMLElement>('.patient-calendar-toolbar')
    if(!toolbar){
      const saved=localStorage.getItem('patientCalendarWeek')
      if(saved){
        const parsed=new Date(`${saved}T12:00:00`)
        if(!Number.isNaN(parsed.getTime())){
          weekCursor=mondayOf(parsed)
          if(!isMobile()&&weekCursor<currentWeekStart())weekCursor=currentWeekStart()
        }
      }
      toolbar=document.createElement('div');toolbar.className='patient-calendar-toolbar';toolbar.innerHTML=`<button type="button" class="patient-calendar-nav" data-week="prev" aria-label="Semana anterior">‹</button><div class="patient-calendar-period"></div><button type="button" class="patient-calendar-nav" data-week="next" aria-label="Próxima semana">›</button>`
      list.before(toolbar)
      toolbar.querySelector('[data-week="prev"]')?.addEventListener('click',()=>{
        const next=addDays(weekCursor||new Date(),-7)
        if(!isMobile()&&mondayOf(next)<currentWeekStart())return
        weekCursor=next
        applyWeek()
      })
      toolbar.querySelector('[data-week="next"]')?.addEventListener('click',()=>{weekCursor=addDays(weekCursor||new Date(),7);applyWeek()})
    }
    applyWeek()
  }finally{running=false}
}

export function installPatientCalendarEnhancer(){
  const schedule=()=>{if(scheduled)window.clearTimeout(scheduled);scheduled=window.setTimeout(()=>{scheduled=undefined;void enhance()},120)}
  schedule();new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true})
}
