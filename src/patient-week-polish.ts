let installed=false
let chosenDateText=''
let chosenTimeText=''

const mondayOf=(value:Date)=>{const d=new Date(value);d.setHours(0,0,0,0);const day=d.getDay();d.setDate(d.getDate()-(day===0?6:day-1));return d}
const addDays=(d:Date,n:number)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x}
const ddmm=(d:Date)=>`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`
const weekday=(d:Date)=>{const raw=new Intl.DateTimeFormat('pt-BR',{weekday:'long'}).format(d).replace('-feira','');return raw.charAt(0).toUpperCase()+raw.slice(1)}

function visibleWeekOffset(){
  const current=document.querySelector<HTMLElement>('.patient-week-grid')
  if(!current)return 0
  const firstHeader=current.querySelector<HTMLElement>('.patient-week-day header strong')
  const day=Number(firstHeader?.textContent||0)
  if(!day)return 0
  const todayMonday=mondayOf(new Date())
  for(let offset=0;offset<104;offset++){
    const candidate=addDays(todayMonday,offset*7)
    if(candidate.getDate()===day)return offset
  }
  return 0
}

function applyChosenDate(){
  if(!chosenDateText||!chosenTimeText)return
  const choice=document.querySelector<HTMLElement>('.patient-booking-choice')
  if(!choice)return
  const currentDate=choice.querySelector('[data-chosen-date]')?.textContent||''
  const currentTime=choice.querySelector('[data-chosen-time]')?.textContent||''
  if(currentDate===chosenDateText&&currentTime===chosenTimeText)return
  choice.innerHTML=`<div><small>Data escolhida:</small><strong data-chosen-date>${chosenDateText}</strong></div><div><small>Horário escolhido:</small><strong data-chosen-time>${chosenTimeText}</strong></div>`
}

function updateChosenDate(button:HTMLButtonElement){
  const day=button.closest<HTMLElement>('.patient-week-day')
  const grid=button.closest<HTMLElement>('.patient-week-grid')
  if(!day||!grid)return
  const index=Array.from(grid.children).indexOf(day)
  if(index<0)return
  const date=addDays(mondayOf(new Date()),visibleWeekOffset()*7+index)
  chosenDateText=`${weekday(date)}, ${ddmm(date)}`
  chosenTimeText=button.querySelector('span')?.textContent||'Selecione um horário'
  window.setTimeout(applyChosenDate,0)
}

export function installPatientWeekPolish(){
  if(installed)return
  installed=true

  // A navegação de semanas fica totalmente a cargo do portal do paciente.
  // Este módulo agora só preserva a data/horário escolhidos, sem fazer fetch,
  // pré-carregamento ou interceptar cliques. Isso evita o lag e o duplo fluxo.
  document.addEventListener('click',event=>{
    const target=event.target as HTMLElement|null
    const slot=target?.closest<HTMLButtonElement>('.patient-slot[data-slot-id]')
    if(slot){updateChosenDate(slot);return}
    if(target?.closest('[data-week-next],[data-week-prev],[data-patient-tab="agenda"]')){
      chosenDateText=''
      chosenTimeText=''
    }
    if(target?.closest('[data-reserve]')){
      ;[0,80,180,350,700].forEach(delay=>window.setTimeout(applyChosenDate,delay))
    }
  },true)

  const observer=new MutationObserver(records=>{
    if(!chosenDateText||!chosenTimeText)return
    const changed=records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node instanceof HTMLElement&&(node.matches('.patient-booking-choice,.patient-booking-box')||Boolean(node.querySelector?.('.patient-booking-choice,.patient-booking-box')))))
    if(changed)window.setTimeout(applyChosenDate,0)
  })
  observer.observe(document.body,{childList:true,subtree:true})
  window.addEventListener('pageshow',()=>window.setTimeout(applyChosenDate,0))
}
