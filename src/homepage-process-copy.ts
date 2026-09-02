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
      <p class="clinical-intro">O atendimento clínico individual é orientado pela psicanálise e acontece semanalmente em um horário fixo, com sessões online de 50 minutos.</p>
    `
  }

  const steps=section.querySelector<HTMLElement>('.steps')
  if(steps){
    steps.className='clinical-care-content'
    steps.innerHTML=`
      <div class="clinical-online-copy">
        <h3>Atendimento On-line</h3>
        <p>Utilizamos plataformas de vídeo como <strong>Google Meet, Zoom ou WhatsApp</strong> para proporcionar um ambiente virtual seguro e confortável. Essas opções de atendimento são acessíveis tanto para pacientes em todo o território nacional quanto para aqueles localizados no exterior.</p>
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
