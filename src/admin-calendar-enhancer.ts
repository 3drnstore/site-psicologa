type Slot = { id:number; starts_at:string; ends_at:string; status:string; public_visibility:string; source:string }
type ViewMode = 'month'|'week'|'day'

const fmtTime=(v:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(v))
const fmtDate=(v:string)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(v))
const startOfDay=(d:Date)=>new Date(d.getFullYear(),d.getMonth(),d.getDate())
const addDays=(d:Date,n:number)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x}
const isoLocal=(d:Date)=>{const p=(n:number)=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`}
const statusLabel=(s:Slot)=>s.status==='confirmed'?'Consulta confirmada':s.status==='held'?'Aguardando pagamento':s.status==='blocked'?(s.source==='recurring_block'?'Bloqueio recorrente':'Bloqueado'):(s.public_visibility==='hidden'?'Oculto':'Livre')
const statusClass=(s:Slot)=>s.status==='confirmed'?'confirmed':s.status==='held'?'held':s.status==='blocked'?'blocked':s.public_visibility==='hidden'?'hidden':'free'

class AdminCalendar {
  host:HTMLElement; cursor=new Date(); mode:ViewMode='month'; slots:Slot[]=[]; selected:Slot|null=null
  constructor(host:HTMLElement){this.host=host;this.cursor=new Date();this.load()}
  async load(){
    const from=new Date(this.cursor.getFullYear()-1,0,1);const to=new Date(this.cursor.getFullYear()+3,11,31,23,59,59)
    const r=await fetch(`/api/admin/availability-v2?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,{credentials:'include'})
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Não foi possível carregar a agenda.')
    this.slots=d.slots||[];this.render()
  }
  async action(slot:Slot,action:'blocked'|'free'|'hidden'|'visible'|'delete'){
    if(action==='delete'){
      if(!confirm('Excluir este horário da agenda?'))return
      const r=await fetch(`/api/admin/availability/${slot.id}`,{method:'DELETE',credentials:'include'})
      const d=await r.json().catch(()=>({}));if(!r.ok){alert(d.message||'Não foi possível excluir.');return}
    }else{
      const r=await fetch(`/api/admin/availability/${slot.id}/mode`,{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({mode:action})})
      const d=await r.json().catch(()=>({}));if(!r.ok){alert(d.message||'Não foi possível alterar o horário.');return}
    }
    this.selected=null;await this.load()
  }
  title(){return new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(this.cursor).replace(/^./,c=>c.toUpperCase())}
  nav(n:number){if(this.mode==='month')this.cursor=new Date(this.cursor.getFullYear(),this.cursor.getMonth()+n,1);else if(this.mode==='week')this.cursor=addDays(this.cursor,n*7);else this.cursor=addDays(this.cursor,n);this.render()}
  render(){
    this.host.innerHTML=`<div class="gc-toolbar"><div class="gc-nav"><button data-gc="today">Hoje</button><button data-gc="prev" aria-label="Anterior">‹</button><button data-gc="next" aria-label="Próximo">›</button><strong>${this.title()}</strong></div><div class="gc-modes"><button data-mode="month" class="${this.mode==='month'?'active':''}">Mês</button><button data-mode="week" class="${this.mode==='week'?'active':''}">Semana</button><button data-mode="day" class="${this.mode==='day'?'active':''}">Dia</button></div></div><div class="gc-legend"><span class="free">Livre</span><span class="blocked">Bloqueado</span><span class="held">Reserva</span><span class="confirmed">Confirmada</span><span class="hidden">Oculto</span></div><div class="gc-body"></div><div class="gc-detail"></div>`
    this.host.querySelector('[data-gc=today]')?.addEventListener('click',()=>{this.cursor=new Date();this.render()})
    this.host.querySelector('[data-gc=prev]')?.addEventListener('click',()=>this.nav(-1));this.host.querySelector('[data-gc=next]')?.addEventListener('click',()=>this.nav(1))
    this.host.querySelectorAll<HTMLElement>('[data-mode]').forEach(b=>b.addEventListener('click',()=>{this.mode=b.dataset.mode as ViewMode;this.render()}))
    if(this.mode==='month')this.renderMonth();else this.renderTimeGrid()
    this.renderDetail()
  }
  renderMonth(){
    const body=this.host.querySelector('.gc-body')!;const first=new Date(this.cursor.getFullYear(),this.cursor.getMonth(),1);const gridStart=addDays(first,-first.getDay());
    const days=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];body.innerHTML=`<div class="gc-weekdays">${days.map(d=>`<span>${d}</span>`).join('')}</div><div class="gc-month-grid"></div>`
    const grid=body.querySelector('.gc-month-grid')!;for(let i=0;i<42;i++){const day=addDays(gridStart,i);const ds=day.toDateString();const events=this.slots.filter(s=>new Date(s.starts_at).toDateString()===ds);const outside=day.getMonth()!==this.cursor.getMonth();const cell=document.createElement('div');cell.className=`gc-day ${outside?'outside':''}`;cell.innerHTML=`<div class="gc-daynum">${day.getDate()}</div><div class="gc-events"></div>`;const ev=cell.querySelector('.gc-events')!;events.slice(0,4).forEach(s=>{const b=document.createElement('button');b.className=`gc-event ${statusClass(s)}`;b.textContent=`${fmtTime(s.starts_at)} ${statusLabel(s)}`;b.title=`${fmtDate(s.starts_at)} ${fmtTime(s.starts_at)} → ${fmtDate(s.ends_at)} ${fmtTime(s.ends_at)}`;b.onclick=()=>{this.selected=s;this.renderDetail()};ev.appendChild(b)});if(events.length>4){const m=document.createElement('small');m.textContent=`+${events.length-4} mais`;ev.appendChild(m)}grid.appendChild(cell)}
  }
  renderTimeGrid(){
    const body=this.host.querySelector('.gc-body')!;const base=startOfDay(this.cursor);const start=this.mode==='week'?addDays(base,-base.getDay()):base;const count=this.mode==='week'?7:1;const days=Array.from({length:count},(_,i)=>addDays(start,i));
    body.innerHTML=`<div class="gc-time-head">${days.map(d=>`<div>${new Intl.DateTimeFormat('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'}).format(d)}</div>`).join('')}</div><div class="gc-time-wrap"><div class="gc-hours">${Array.from({length:24},(_,h)=>`<span>${String(h).padStart(2,'0')}:00</span>`).join('')}</div><div class="gc-time-cols">${days.map(d=>`<div class="gc-time-col" data-day="${d.toDateString()}"></div>`).join('')}</div></div>`
    days.forEach(d=>{const col=body.querySelector<HTMLElement>(`.gc-time-col[data-day="${d.toDateString()}"]`)!;this.slots.filter(s=>new Date(s.starts_at).toDateString()===d.toDateString()).forEach(s=>{const st=new Date(s.starts_at),en=new Date(s.ends_at);const top=(st.getHours()*60+st.getMinutes())/1440*1440;const dur=Math.max(28,(en.getTime()-st.getTime())/60000);const b=document.createElement('button');b.className=`gc-time-event ${statusClass(s)}`;b.style.top=`${top}px`;b.style.height=`${Math.min(dur,1440-top)}px`;b.innerHTML=`<strong>${fmtTime(s.starts_at)}–${fmtTime(s.ends_at)}</strong><span>${statusLabel(s)}</span>`;b.onclick=()=>{this.selected=s;this.renderDetail()};col.appendChild(b)})})
  }
  renderDetail(){
    const el=this.host.querySelector('.gc-detail') as HTMLElement;if(!el)return;if(!this.selected){el.innerHTML='<span>Selecione um horário no calendário para gerenciar.</span>';return}const s=this.selected;const locked=['held','confirmed'].includes(s.status);el.innerHTML=`<div><strong>${fmtDate(s.starts_at)} ${fmtTime(s.starts_at)} → ${fmtDate(s.ends_at)} ${fmtTime(s.ends_at)}</strong><span>${statusLabel(s)} • Paciente verá: ${s.public_visibility==='hidden'?'não aparece':s.status==='free'?'Livre':'Ocupado'}</span></div><div class="gc-actions"></div>`;const a=el.querySelector('.gc-actions')!;const add=(label:string,action:any,danger=false)=>{const b=document.createElement('button');b.textContent=label;b.className=danger?'danger':'';b.onclick=()=>this.action(s,action);a.appendChild(b)};if(!locked){if(s.status==='free')add('Bloquear','blocked');if(s.status==='blocked')add('Liberar','free');add(s.public_visibility==='hidden'?'Mostrar':'Ocultar',s.public_visibility==='hidden'?'visible':'hidden');add('Excluir','delete',true)}
  }
}

export function installAdminCalendarEnhancer(){
  const enhance=()=>document.querySelectorAll<HTMLElement>('.admin-panel').forEach(panel=>{const h=panel.querySelector('h2');if(h?.textContent?.trim()!=='Grade administrativa'||panel.dataset.calendarEnhanced)return;panel.dataset.calendarEnhanced='1';const old=panel.querySelector('.appointment-list');if(old)old.remove();let host=panel.querySelector<HTMLElement>('.google-calendar-admin');if(!host){host=document.createElement('div');host.className='google-calendar-admin';panel.appendChild(host)};new AdminCalendar(host).load().catch(e=>{host!.innerHTML=`<div class="error-box">${e instanceof Error?e.message:String(e)}</div>`})})
  enhance();new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true})
}
