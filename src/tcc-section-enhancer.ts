let installed=false
let timer:number|undefined

function applyTccSection(){
  const section=document.querySelector<HTMLElement>('.site-shell .services')
  if(!section)return

  section.id='como-funciona'

  const kicker=section.querySelector<HTMLElement>('.section-kicker')
  const title=section.querySelector<HTMLElement>('.section-title h2')
  if(kicker)kicker.textContent='Como funciona'
  if(title)title.textContent='Como a Terapia Cognitivo-Comportamental pode ajudar'

  const cards=[...section.querySelectorAll<HTMLElement>('.service-grid article')]
  const content=[
    {
      title:'O que é a TCC',
      text:'A Terapia Cognitivo-Comportamental é uma abordagem psicológica que considera a relação entre pensamentos, emoções e comportamentos, ajudando a compreender como esses elementos influenciam a forma de perceber e lidar com diferentes situações.'
    },
    {
      title:'Como funciona nas sessões',
      text:'Ao longo do processo terapêutico, psicóloga e paciente observam padrões de pensamento e comportamento, identificam dificuldades presentes e constroem novas formas de compreensão e enfrentamento de acordo com as necessidades de cada pessoa.'
    },
    {
      title:'Um processo individualizado',
      text:'O atendimento é conduzido de forma colaborativa e respeita a história, o ritmo e os objetivos de cada paciente. As sessões oferecem um espaço de escuta, reflexão e desenvolvimento de estratégias que possam contribuir para o bem-estar e a qualidade de vida.'
    }
  ]

  cards.forEach((card,index)=>{
    const item=content[index]
    if(!item)return
    const marker=card.querySelector<HTMLElement>(':scope > span')
    const heading=card.querySelector<HTMLElement>('h3')
    const paragraph=card.querySelector<HTMLElement>('p')
    if(marker)marker.remove()
    if(heading)heading.textContent=item.title
    if(paragraph)paragraph.textContent=item.text
  })
}

export function installTccSectionEnhancer(){
  if(installed)return
  installed=true
  const schedule=()=>{
    if(timer)window.clearTimeout(timer)
    timer=window.setTimeout(()=>{
      timer=undefined
      applyTccSection()
    },55)
  }
  schedule()
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true})
}
