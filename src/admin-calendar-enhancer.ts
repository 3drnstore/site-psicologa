type Slot = { id:number; starts_at:string; ends_at:string; status:string; public_visibility:string; source:string }
type Cell = { starts_at:string; ends_at:string; day:Date; hour:number; slot?:Slot }
type BulkMode='free'|'occupied'|'blocked'|'delete'

const fmtTime=(v:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(v))
const addDays=(d:Date,n:number)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x}
const mondayOf=(d:Date)=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());const day=x.getDay();x.setDate(x.getDate()-(day===0?6:day-1));return x}
const statusLabel=(s?:Slot)=>!s?'Ocupado':s.status==='confirmed'?'Consulta confirmada':s.status==='held'?'Reserva':s.status==='blocked'?'Bloqueado':s.status==='occupied'?'Ocupado':s.public_visibility==='hidden'?'Oculto':'Horário Livre'
const statusClass=(s?:Slot)=>!s?'unset':s.status==='confirmed'?'confirmed':s.status==='held'?'held':s.status==='blocked'?'blocked':s.status==='occupied'?'occupied':s.public_visibility==='hidden'?'hidden':'free'
const monthYear=(d:Date)=>new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(d).replace(/^./,c=>c.toUpperCase())
const shortWeekday=(d:Date)=>new Intl.DateTimeFormat('pt-BR',{weekday:'long'}).format(d).replace(/^./,c=>c.toUpperCase())

class AdminCalendar {
  host:HTMLElement
  cursor=new Date()
  slots:Slot[]=[]
  selected=new Set<string>()
  notice=''
  busy=false
  syntheticId=-1
  anchorKey:string|null=null

  constructor(host:HTMLElement){this.host=host}

  days(){const m=mondayOf(this.cursor);return Array.from({length:6},(_,i)=>addDays(m,i))}
  allCells(){return this.days().flatMap(d=>Array.from({length:12},(_,i)=>this.cell(d,8+i)))}

  cell(day:Date,hour:number):Cell{
    const start=new Date(day.getFullYear(),day.getMonth(),day.getDate(),hour,0,0,0)
    const end=new Date(start);end.setMinutes(end.getMinutes()+50)
    const slot=this.slots.find(s=>Math.abs(new Date(s.starts_at).getTime()-start.getTime())<1000&&Math.abs(new Date(s.ends_at).getTime()-end.getTime())<1000)
    return {starts_at:start.toISOString(),ends_at:end.toISOString(),day,hour,slot}
  }

  key(c:Cell){return `${c.starts_at}|${c.ends_at}`}

  async load(){
    const start=mondayOf(this.cursor),from=addDays(start,-1),to=addDays(start,6);to.setHours(23,59,59,999)
    const r=await fetch(`/api/admin/availability-v2?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,{credentials:'include'})
    const d=await r.json().catch(()=>({})) as any
    if(!r.ok)throw new Error(d.message||'Não foi possível carregar a agenda.')
    this.slots=d.slots||[]
    this.render()
  }

  paintSelection(){
    this.host.querySelectorAll<HTMLElement>('[data-cell]').forEach(el=>el.classList.toggle('selected',this.selected.has(String(el.dataset.cell))))
    const count=this.host.querySelector('[data-selection-count]')
    if(count)count.textContent=`${this.selected.size} selecionado(s)`
  }

  toggle(c:Cell,button:HTMLElement,shiftKey=false){
    const k=this.key(c)
    if(shiftKey&&this.anchorKey){
      const cells=this.allCells(),anchor=cells.find(x=>this.key(x)===this.anchorKey)
      if(anchor){
        const days=this.days()
        const aDay=days.findIndex(d=>d.toDateString()===anchor.day.toDateString())
        const tDay=days.findIndex(d=>d.toDateString()===c.day.toDateString())
        const minDay=Math.min(aDay,tDay),maxDay=Math.max(aDay,tDay)
        const minHour=Math.min(anchor.hour,c.hour),maxHour=Math.max(anchor.hour,c.hour)
        for(const cell of cells){
          const di=days.findIndex(d=>d.toDateString()===cell.day.toDateString())
          if(di>=minDay&&di<=maxDay&&cell.hour>=minHour&&cell.hour<=maxHour)this.selected.add(this.key(cell))
        }
        this.paintSelection();return
      }
    }
    if(this.selected.has(k)){this.selected.delete(k);button.classList.remove('selected')}else{this.selected.add(k);button.classList.add('selected')}
    this.anchorKey=k
    this.paintSelection()
  }

  selectedCells(){return this.allCells().filter(c=>this.selected.has(this.key(c)))}

  applyLocal(mode:BulkMode,cells:Cell[]){
    for(const c of cells){
      const idx=this.slots.findIndex(s=>Math.abs(new Date(s.starts_at).getTime()-new Date(c.starts_at).getTime())<1000&&Math.abs(new Date(s.ends_at).getTime()-new Date(c.ends_at).getTime())<1000)
      if(mode==='delete'){if(idx>=0)this.slots.splice(idx,1);continue}
      if(idx>=0)this.slots[idx]={...this.slots[idx],status:mode,public_visibility:'visible',source:'manual'}
      else this.slots.push({id:this.syntheticId--,starts_at:c.starts_at,ends_at:c.ends_at,status:mode,public_visibility:'visible',source:'manual'})
    }
  }

  async bulk(mode:BulkMode){
    if(this.busy)return
    const cells=this.selectedCells()
    if(!cells.length){this.notice='Selecione um ou mais horários primeiro.';this.renderNotice();return}
    if(mode==='delete'&&!confirm(`Excluir ${cells.length} horário(s) selecionado(s)?`))return
    this.busy=true
    this.host.querySelectorAll<HTMLButtonElement>('[data-bulk]').forEach(b=>b.disabled=true)
    const r=await fetch('/api/admin/availability/bulk',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({mode,cells:cells.map(c=>({starts_at:c.starts_at,ends_at:c.ends_at}))})})
    const d=await r.json().catch(()=>({})) as any
    if(!r.ok){this.busy=false;this.host.querySelectorAll<HTMLButtonElement>('[data-bulk]').forEach(b=>b.disabled=false);this.notice=d.message||'Não foi possível alterar os horários.';this.renderNotice();return}
    const changedKeys=new Set((d.changed_cells||[]).map((c:any)=>`${c.starts_at}|${c.ends_at}`))
    const changed=cells.filter(c=>changedKeys.has(this.key(c)))
    this.applyLocal(mode,changed)
    this.notice=d.message||'Agenda atualizada.'
    this.selected.clear();this.anchorKey=null;this.busy=false
    this.render()
  }

  renderNotice(){
    let el=this.host.querySelector<HTMLElement>('.gc-notice')
    if(!el){el=document.createElement('div');el.className='gc-notice';this.host.querySelector('.agenda-actions')?.after(el)}
    el.textContent=this.notice
  }

  nav(weeks:number){this.cursor=addDays(this.cursor,weeks*7);this.selected.clear();this.anchorKey=null;void this.load()}

  render(){
    const days=this.days()
    const today=new Date();today.setHours(0,0,0,0)
    const first=days[0],last=days[5]
    const range=`Dias ${first.getDate()} a ${last.getDate()}`

    this.host.innerHTML=`
      <div class="agenda-reference-toolbar">
        <button class="agenda-arrow" data-nav="prev" aria-label="Semana anterior">‹</button>
        <div class="agenda-period"><strong>${monthYear(this.cursor)}</strong><span>${range}</span></div>
        <button class="agenda-arrow" data-nav="next" aria-label="Próxima semana">›</button>
      </div>
      <div class="agenda-actions">
        <div class="agenda-state-buttons">
          <strong data-selection-count>${this.selected.size} selecionado(s)</strong>
          <button data-bulk="free">Marcar como livre</button>
          <button data-bulk="occupied">Marcar como ocupado</button>
          <button data-bulk="blocked">Marcar como bloqueado</button>
          <button data-bulk="delete" class="danger">Excluir cadastro</button>
          <button data-clear>Limpar seleção</button>
        </div>
        <small>Clique para selecionar. Use <strong>Shift + clique</strong> para selecionar uma faixa.</small>
      </div>
      ${this.notice?`<div class="gc-notice">${this.notice}</div>`:''}
      <div class="work-grid agenda-columns">
        ${days.map(day=>{
          const isToday=day.toDateString()===today.toDateString()
          const cells=Array.from({length:12},(_,i)=>this.cell(day,8+i))
          return `<section class="agenda-day-column">
            <header class="agenda-day-head ${isToday?'today':''}">
              <strong>${day.getDate()}</strong><span>${shortWeekday(day)}</span>
            </header>
            <div class="agenda-day-cards">
              ${cells.map(c=>{
                const selected=this.selected.has(this.key(c))
                return `<button class="work-cell agenda-slot-card ${statusClass(c.slot)} ${selected?'selected':''}" data-cell="${this.key(c)}">
                  <strong class="agenda-slot-time">${fmtTime(c.starts_at)} - ${fmtTime(c.ends_at)}</strong>
                  <span>${statusLabel(c.slot)}</span>
                </button>`
              }).join('')}
            </div>
          </section>`
        }).join('')}
      </div>
    `

    this.host.querySelector('[data-nav=prev]')?.addEventListener('click',()=>this.nav(-1))
    this.host.querySelector('[data-nav=next]')?.addEventListener('click',()=>this.nav(1))
    this.host.querySelectorAll<HTMLButtonElement>('[data-bulk]').forEach(b=>b.addEventListener('click',()=>void this.bulk(b.dataset.bulk as BulkMode)))
    this.host.querySelector('[data-clear]')?.addEventListener('click',()=>{this.selected.clear();this.anchorKey=null;this.paintSelection()})
    const map=new Map(this.allCells().map(c=>[this.key(c),c]))
    this.host.querySelectorAll<HTMLElement>('[data-cell]').forEach(el=>{const c=map.get(String(el.dataset.cell));if(c)el.addEventListener('click',(event)=>this.toggle(c,el,(event as MouseEvent).shiftKey))})
  }
}

export function installAdminCalendarEnhancer(){
  const enhance=()=>{
    document.querySelectorAll<HTMLElement>('.admin-panel').forEach(panel=>{
      const h=panel.querySelector('h2')?.textContent?.trim()
      if(h==='Novo horário'||h==='Bloqueio recorrente'){panel.style.display='none';return}
      if(h!=='Grade administrativa'||panel.dataset.calendarEnhanced)return
      panel.dataset.calendarEnhanced='1'
      const old=panel.querySelector('.appointment-list');if(old)old.remove()
      const head=panel.querySelector('.admin-section-head');if(head)head.remove()
      panel.classList.add('agenda-reference-panel')
      let host=panel.querySelector<HTMLElement>('.google-calendar-admin')
      if(!host){host=document.createElement('div');host.className='google-calendar-admin';panel.appendChild(host)}
      const calendar=new AdminCalendar(host)
      void calendar.load().catch(e=>{host!.innerHTML=`<div class="error-box">${e instanceof Error?e.message:String(e)}</div>`})
    })
  }
  enhance()
  new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true})
}
