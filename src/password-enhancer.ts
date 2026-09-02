let installed=false

function enhancePasswords(){
  document.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(input=>{
    if(input.dataset.eyeReady==='1')return
    input.dataset.eyeReady='1'
    const wrapper=document.createElement('span');wrapper.className='password-field-dom'
    input.parentNode?.insertBefore(wrapper,input);wrapper.appendChild(input)
    const button=document.createElement('button');button.type='button';button.className='password-toggle-dom'
    const render=()=>{button.textContent=input.type==='password'?'👁':'◉';button.setAttribute('aria-label',input.type==='password'?'Mostrar senha':'Ocultar senha');button.title=input.type==='password'?'Mostrar senha':'Ocultar senha'}
    button.onclick=()=>{input.type=input.type==='password'?'text':'password';render()};render();wrapper.appendChild(button)
  })
  document.querySelectorAll<HTMLElement>('.auth-card').forEach(card=>{
    const text=card.textContent||'';const form=card.querySelector('form');if(!form||form.querySelector('.forgot-password-link'))return
    const isAdmin=text.includes('Acesso profissional')||text.includes('Painel profissional'),isPatient=text.includes('Área do paciente')
    if(!isAdmin&&!isPatient)return
    const a=document.createElement('a');a.className='forgot-password-link';a.href=`/recuperar-senha?tipo=${isAdmin?'admin':'patient'}`;a.textContent='Esqueci minha senha';form.appendChild(a)
  })
}

function scheduleBurst(){
  ;[0,60,150,350,700].forEach(delay=>window.setTimeout(enhancePasswords,delay))
}

export function installPasswordEnhancer(){
  if(installed)return
  installed=true
  scheduleBurst()
  document.addEventListener('click',()=>{
    window.setTimeout(enhancePasswords,0)
    window.setTimeout(enhancePasswords,120)
  },true)
  window.addEventListener('pageshow',scheduleBurst)
}
