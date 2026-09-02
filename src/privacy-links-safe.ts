let installed=false

function styleLink(a:HTMLAnchorElement){
  a.style.display='inline-flex'
  a.style.alignItems='center'
  a.style.width='fit-content'
  a.style.marginTop='8px'
  a.style.fontSize='13px'
  a.style.fontWeight='700'
  a.style.color='inherit'
  a.style.textDecoration='underline'
  a.style.textUnderlineOffset='3px'
}

function addLink(container:Element,label='Privacidade e proteção de dados'){
  if(container.querySelector('a[data-privacy-link]'))return
  const a=document.createElement('a')
  a.href='/privacidade'
  a.textContent=label
  a.setAttribute('data-privacy-link','1')
  a.className='privacy-inline-link'
  styleLink(a)
  container.appendChild(a)
}

function apply(){
  document.querySelectorAll<HTMLElement>('.privacy-note').forEach(note=>addLink(note))

  const footer=document.querySelector<HTMLElement>('.site-shell footer')
  if(footer)addLink(footer)

  const contact=document.getElementById('contato')
  const form=contact?.querySelector('form')
  if(form)addLink(form,'Como tratamos seus dados')
}

function scheduleBurst(){
  ;[0,80,200,450,900,1600].forEach(delay=>window.setTimeout(apply,delay))
}

export function installPrivacyLinksSafe(){
  if(installed)return
  installed=true

  scheduleBurst()

  document.addEventListener('click',()=>{
    window.setTimeout(apply,0)
    window.setTimeout(apply,120)
    window.setTimeout(apply,400)
  },true)

  window.addEventListener('popstate',scheduleBurst)
  window.addEventListener('pageshow',scheduleBurst)
}
