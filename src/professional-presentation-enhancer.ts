let installed=false

function ensurePresentation(){
  const hero=document.querySelector<HTMLElement>('.site-shell .hero')
  const art=hero?.querySelector<HTMLElement>('.hero-art')
  if(!hero||!art)return false
  if(art.querySelector('.professional-presentation'))return true

  const presentation=document.createElement('section')
  presentation.className='professional-presentation'
  presentation.innerHTML=`
    <span class="professional-kicker">Consultório de Psicologia</span>
    <h2>Apresentação</h2>
    <p>Este espaço será destinado à apresentação da psicóloga, sua formação, abordagem profissional e experiência clínica.</p>
    <p>O texto poderá explicar de forma acolhedora como é conduzido o atendimento psicológico online e para quais públicos o acompanhamento é oferecido.</p>
    <p class="professional-crp">CRP: 06/212470</p>
  `
  art.prepend(presentation)

  const oldIntro=document.querySelector<HTMLElement>('.site-shell .intro#sobre')
  if(oldIntro)oldIntro.style.display='none'
  return true
}

export function installProfessionalPresentationEnhancer(){
  if(installed)return
  installed=true
  let attempts=0
  const run=()=>{
    attempts+=1
    if(ensurePresentation()||attempts>=20)return
    window.setTimeout(run,50)
  }
  run()
}
