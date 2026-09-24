let installed=false

function ensurePresentation(){
  const hero=document.querySelector<HTMLElement>('.site-shell .hero')
  const art=hero?.querySelector<HTMLElement>('.hero-art')
  if(!hero||!art)return false
  if(art.querySelector('.professional-presentation'))return true

  const presentation=document.createElement('section')
  presentation.className='professional-presentation'
  presentation.innerHTML=`
    <h2>Apresentação</h2>
    <p>Formada em Psicologia desde 2020, realizo atendimentos online, com foco em adultos e idosos que buscam apoio para lidar com questões emocionais, ansiedade, conflitos internos ou simplesmente desejam viver de forma mais leve e consciente.</p>
    <p>Acredito na escuta acolhedora, no respeito à individualidade e na construção de caminhos possíveis para uma vida mais equilibrada. Meu propósito é ajudar a descomplicar o que pesa e tornar a vida mais leve e significativa para cada pessoa.</p>
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
