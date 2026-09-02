let installed=false

function addLink(container:Element,label='Privacidade e proteção de dados'){
  if(container.querySelector('a[data-privacy-link]'))return
  const a=document.createElement('a')
  a.href='/privacidade'
  a.textContent=label
  a.setAttribute('data-privacy-link','1')
  a.className='privacy-inline-link'
  container.appendChild(a)
}

function apply(){
  let found=false
  document.querySelectorAll<HTMLElement>('.privacy-note').forEach(note=>{addLink(note);found=true})
  const footer=document.querySelector<HTMLElement>('.site-shell footer')
  if(footer){addLink(footer);found=true}
  const contact=document.getElementById('contato')
  if(contact){
    const form=contact.querySelector('form')
    if(form){addLink(form,'Como tratamos seus dados');found=true}
  }
  return found
}

export function installPrivacyLinksSafe(){
  if(installed)return
  installed=true
  let attempts=0
  const run=()=>{attempts+=1;if(apply()||attempts>=20)return;window.setTimeout(run,50)}
  run()
}
