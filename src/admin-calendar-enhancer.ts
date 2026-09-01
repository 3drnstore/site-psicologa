type Slot = { id:number; starts_at:string; ends_at:string; status:string; public_visibility:string; source:string }
type Cell = { starts_at:string; ends_at:string; day:Date; hour:number; slot?:Slot }
type ViewMode='week'|'day'

const fmtTime=(v:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(v))
const fmtDate=(v:string)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(v))
const addDays=(d:Date,n:number)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x}
const mondayOf=(d:Date)=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());const day=x.getDay();x.setDate(x.getDate()-(day===0?6:day-1));return x}
const localDayKey=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const statusLabel=(s?:Slot)=>!s?'Ocupado':s.status==='confirmed'?'Consulta confirmada':s.status==='held'?'Aguardando pagamento':s.status==='blocked'?'Ocupado':s.public_visibility==='hidden'?'Oculto':'Livre'
const statusClass=(s?:Slot)=>!s?'unset':s.status==='confirmed'?'confirmed':s.status==='held'?'held':s.status==='blocked'?'blocked':s.public_visibility==='hidden'?'hidden':'free'
const exactHourSlot=(s:Slot)=>{const st=new Date(s.starts_at),en=new Date(s.ends_at);return st.getDay()>=1&&st.getDay()<=6&&st.getHours()>=8&&st.getHours()<19&&st.getMinutes()===0&&(en.getTime()-st.getTime())===3600000}

class AdminCalendar {
  host:HTMLElement;cursor=new Date();mode:ViewMode='week';slots:Slot[]=[];selected=new Set<string>();notice=''
  constructor(host:HTMLElement){this.host=host}

  async load(){
    const start=mondayOf(this.cursor),from=addDays(start,-7),to=addDays(start,21);to.setHours(23,59,59,999)
    const r=await fetch(`/api/admin/availability-v2?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,{credentials:'include'})
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Não foi possível carregar a agenda.')
    this.slots=d.slots||[];this.render()
  }

  days(){
    if(this.mode==='day'){
      let d=new Date(this.cursor);if(d.getDay()===0)d=addDays(d,1);return [d]
    }
    const m=mondayOf(this.cursor);return Array.from({length:6},(_,i)=>addDays(m,i))
  }

  cell(day:Date,hour:number):Cell{
    const start=new Date(day.getFullYear(),day.getMonth(),day.getDate(),hour,0,0,0),end=new Date(start);end.setHours(end.getHours()+1)
    const slot=this.slots.find(s=>Math.abs(new Date(s.starts_at).getTime()-start.getTime())<1000&&Math.abs(new Date(s.ends_at).getTime()-end.getTime())<1000)
    return {starts_at:start.toISOString(),ends_at:end.toISOString(),day,hour,slot}
  }

  key(c:Cell){return `${c.starts_at}|${c.ends_at}`}
  toggle(c:Cell){const k=this.key(c);this.selected.has(k)?this.selected.delete(k):this.selected.add(k);this.render()}
  selectedCells(){const all=this.days().flatMap(d=>Array.from({length:11},(_,i)=>this.cell(d,8+i)));return all.filter(c=>this.selected.has(this.key(c)))}

  async bulk(mode:'free'|'blocked'|'delete'){
    const cells=this.selectedCells();if(!cells.length){this.notice='Selecione um ou mais horários primeiro.';this.render();return}
    if(mode==='delete'&&!confirm(`Excluir ${cells.length} horário(s) selecionado(s)?`))return
    const r=await fetch('/api/admin/availability/bulk',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({mode,cells:cells.map(c=>({starts_at:c.starts_at,ends_at:c.ends_at}))})})
    const d=await r.json().catch(()=>({}));if(!r.ok){this.notice=d.message||'Não foi possível alterar os horários.';this.render();return}
    this.notice=d.message||'Agenda atualizada.';this.selected.clear();await this.load()
  }

  async deleteLegacy(slot:Slot){
    if(!confirm(`Excluir o intervalo ${fmtDate(slot.starts_at)} ${fmtTime(slot.starts_at)} → ${fmtDate(slot.ends_at)} ${fmtTime(slot.ends_at)}?`))return
    const r=await fetch(`/api/admin/availability/${slot.id}`,{method:'DELETE',credentials:'include'});const d=await r.json().catch(()=>({}))
    if(!r.ok){this.notice=d.message||'Não foi possível excluir o intervalo.';this.render();return}
    this.notice='Intervalo excluído.';await this.load()
  }

  title(){
    if(this.mode==='day')return new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(this.days()[0]).replace(/^./,c=>c.toUpperCase())
    const ds=this.days();return `${fmtDate(ds[0].toISOString())} – ${fmtDate(ds[5].toISOString())}`
  }
  nav(n:number){this.cursor=addDays(this.cursor,this.mode==='week'?n*7:n);if(this.cursor.getDay()===0)this.cursor=addDays(this.cursor,n>=0?1:-1);this.selected.clear();this.load()}

  render(){
    const count=this.selected.size
    this.host.innerHTML=`<div class="gc-toolbar"><div class="gc-nav"><button data-gc="today">Hoje</button><button data-gc="prev">‹</button><button data-gc="next">›</button><strong>${this.title()}</strong></div><div class="gc-modes"><button data-mode="week" class="${this.mode==='week'?'active':''}">Semana</button><button data-mode="day" class="${this.mode==='day'?'active':''}">Dia</button></div></div>
      <div class="gc-help"><strong>Atendimento: segunda a sábado, 08h–19h.</strong> Clique em um ou vários blocos e escolha o estado. Horários não liberados são considerados ocupados.</div>
      ${this.notice?`<div class="gc-notice">${this.notice}</div>`:''}
      <div class="gc-legend"><span class="free">Livre</span><span class="unset">Ocupado</span><span class="held">Reserva</span><span class="confirmed">Confirmada</span><span class="hidden">Oculto</span></div>
      <div class="gc-selection"><strong>${count} selecionado(s)</strong><div><button data-bulk="free">Marcar como livre</button><button data-bulk="blocked">Marcar como ocupado</button><button data-bulk="delete" class="danger">Excluir cadastro</button><button data-clear>Limpar seleção</button></div></div>
      <div class="gc-body"></div><div class="gc-legacy"></div>`
    this.host.querySelector('[data-gc=today]')?.addEventListener('click',()=>{this.cursor=new Date();if(this.cursor.getDay()===0)this.cursor=addDays(this.cursor,1);this.selected.clear();this.load()})
    this.host.querySelector('[data-gc=prev]')?.addEventListener('click',()=>this.nav(-1));this.host.querySelector('[data-gc=next]')?.addEventListener('click',()=>this.nav(1))
    this.host.querySelectorAll<HTMLElement>('[data-mode]').forEach(b=>b.addEventListener('click',()=>{this.mode=b.dataset.mode as ViewMode;this.selected.clear();this.load()}))
    this.host.querySelectorAll<HTMLElement>('[data-bulk]').forEach(b=>b.addEventListener('click',()=>this.bulk(b.dataset.bulk as 'free'|'blocked'|'delete')))
    this.host.querySelector('[data-clear]')?.addEventListener('click',()=>{this.selected.clear();this.render()})
    this.renderGrid();this.renderLegacy()
  }

  renderGrid(){
    const body=this.host.querySelector('.gc-body')!,days=this.days()
    body.innerHTML=`<div class="work-grid" style="--days:${days.length}"><div class="work-corner"></div>${days.map(d=>`<div class="work-day"><strong>${new Intl.DateTimeFormat('pt-BR',{weekday:'short'}).format(d)}</strong><span>${new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit'}).format(d)}</span></div>`).join('')}${Array.from({length:11},(_,i)=>{const h=8+i;return `<div class="work-hour">${String(h).padStart(2,'0')}:00</div>${days.map(d=>{const c=this.cell(d,h),selected=this.selected.has(this.key(c));return `<button class="work-cell ${statusClass(c.slot)} ${selected?'selected':''}" data-cell="${this.key(c)}"><span>${statusLabel(c.slot)}</span></button>`}).join('')}`}).join('')}</div>`
    body.querySelectorAll<HTMLElement>('[data-cell]').forEach(el=>{const [starts_at,ends_at]=String(el.dataset.cell).split('|');const c=this.days().flatMap(d=>Array.from({length:11},(_,i)=>this.cell(d,8+i))).find(x=>x.starts_at===starts_at&&x.ends_at===ends_at);if(c)el.addEventListener('click',()=>this.toggle(c))})
  }

  renderLegacy(){
    const el=this.host.querySelector('.gc-legacy')!,legacy=this.slots.filter(s=>!exactHourSlot(s))
    if(!legacy.length){el.innerHTML='';return}
    el.innerHTML=`<h3>Intervalos fora da grade horária</h3><p>Cadastros antigos ou intervalos que não correspondem a blocos de 1 hora aparecem aqui.</p><div class="gc-legacy-list"></div>`
    const list=el.querySelector('.gc-legacy-list')!;legacy.forEach(s=>{const row=document.createElement('div');row.className='gc-legacy-row';row.innerHTML=`<div><strong>${fmtDate(s.starts_at)} ${fmtTime(s.starts_at)} → ${fmtDate(s.ends_at)} ${fmtTime(s.ends_at)}</strong><span>${statusLabel(s)}</span></div>`;if(!['held','confirmed'].includes(s.status)){const b=document.createElement('button');b.className='danger';b.textContent='Excluir';b.onclick=()=>this.deleteLegacy(s);row.appendChild(b)}list.appendChild(row)})
  }
}

export function installAdminCalendarEnhancer(){
  const enhance=()=>{
    document.querySelectorAll<HTMLElement>('.admin-panel').forEach(panel=>{
      const h=panel.querySelector('h2')?.textContent?.trim()
      if(h==='Novo horário'){panel.style.display='none';return}
      if(h!=='Grade administrativa'||panel.dataset.calendarEnhanced)return
      panel.dataset.calendarEnhanced='1';const old=panel.querySelector('.appointment-list');if(old)old.remove();const head=panel.querySelector('.admin-section-head');if(head){const title=head.querySelector('h2');if(title)title.textContent='Agenda semanal';const counter=head.querySelector('span');if(counter)counter.textContent='Selecione os horários diretamente na grade'}
      let host=panel.querySelector<HTMLElement>('.google-calendar-admin');if(!host){host=document.createElement('div');host.className='google-calendar-admin';panel.appendChild(host)}const calendar=new AdminCalendar(host);calendar.load().catch(e=>{host!.innerHTML=`<div class="error-box">${e instanceof Error?e.message:String(e)}</div>`})
    })
  }
  enhance();new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true})
}
