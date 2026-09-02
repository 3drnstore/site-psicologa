let installed=false
let scheduled:number|undefined

function applyProcessCopy(){
  const section=document.querySelector<HTMLElement>('.site-shell .process#como-funciona')
  if(!section)return

  const title=section.querySelector<HTMLElement>('.section-title h2')
  if(title)title.textContent='Como funciona o atendimento'

  const steps=[...section.querySelectorAll<HTMLElement>('.steps > div')]
  const copy=[
    {
      title:'Escolha um horário',
      text:'Consulte os horários disponíveis e agende sua sessão diretamente pelo site.',
    },
    {
      title:'Confirme seu agendamento',
      text:'Após o pagamento, seu horário será confirmado e ficará reservado para você.',
    },
    {
      title:'Receba o acesso à sessão',
      text:'No dia do atendimento, você receberá o link para acessar a videochamada de forma simples e segura.',
    },
    {
      title:'Seu momento de acolhimento',
      text:'Em um espaço de escuta, respeito e confidencialidade, você poderá falar sobre o que está vivendo e iniciar ou dar continuidade ao seu processo terapêutico.',
    },
  ]

  steps.forEach((step,index)=>{
    const item=copy[index]
    if(!item)return
    const heading=step.querySelector<HTMLElement>('h3')
    const paragraph=step.querySelector<HTMLElement>('p')
    if(heading)heading.textContent=item.title
    if(paragraph)paragraph.textContent=item.text
  })
}

export function installHomepageProcessCopy(){
  if(installed)return
  installed=true
  const schedule=()=>{
    if(scheduled)window.clearTimeout(scheduled)
    scheduled=window.setTimeout(()=>{
      scheduled=undefined
      applyProcessCopy()
    },40)
  }
  schedule()
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true})
}
