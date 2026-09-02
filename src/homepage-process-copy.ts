let installed=false
let scheduled:number|undefined

function applyProcessCopy(){
  const section=document.querySelector<HTMLElement>('.site-shell .process#como-funciona')
  if(!section)return

  section.classList.add('clinical-care-section')

  const titleBlock=section.querySelector<HTMLElement>('.section-title')
  if(titleBlock){
    titleBlock.innerHTML=`
      <span class="section-kicker">Atendimento</span>
      <h2>Atendimento clínico individual</h2>
      <p class="clinical-intro">O atendimento clínico individual é orientado pela Teoria Cognitivo-Comportamental (TCC) e acontece semanalmente em um horário fixo ou de acordo com a disponibilidade do paciente, com sessões online de 50 minutos.</p>
    `
  }

  const steps=section.querySelector<HTMLElement>('.clinical-care-content, .steps')
  if(steps){
    steps.className='clinical-care-content'
    steps.innerHTML=`
      <div class="clinical-online-copy">
        <h3>Atendimento On-line</h3>
        <p>O atendimento ocorre através da plataforma <strong>Google Meet</strong>, ambiente virtual acessível, seguro e confortável para os pacientes.</p>
      </div>
    `
  }
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
