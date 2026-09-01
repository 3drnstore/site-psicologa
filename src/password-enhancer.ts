import { createElement, Eye, EyeOff } from 'lucide'

function enhancePasswords(){
  document.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(input=>{
    if(input.dataset.eyeReady==='1')return
    input.dataset.eyeReady='1'
    const wrapper=document.createElement('span');wrapper.className='password-field-dom'
    input.parentNode?.insertBefore(wrapper,input);wrapper.appendChild(input)
    const button=document.createElement('button');button.type='button';button.className='password-toggle-dom';button.setAttribute('aria-label','Mostrar senha')
    const render=()=>{button.innerHTML='';button.appendChild(createElement(input.type==='password'?Eye:EyeOff,{width:18,height:18}));button.setAttribute('aria-label',input.type==='password'?'Mostrar senha':'Ocultar senha')}
    button.onclick=()=>{input.type=input.type==='password'?'text':'password';render()};render();wrapper.appendChild(button)
  })

  document.querySelectorAll<HTMLElement>('.auth-card').forEach(card=>{
    const text=card.textContent||''
    const form=card.querySelector('form');if(!form||form.querySelector('.forgot-password-link'))return
    const isAdmin=text.includes('Acesso profissional')||text.includes('Painel profissional')
    const isPatient=text.includes('Área do paciente')
    if(!isAdmin&&!isPatient)return
    const a=document.createElement('a');a.className='forgot-password-link';a.href=`/recuperar-senha?tipo=${isAdmin?'admin':'patient'}`;a.textContent='Esqueci minha senha';form.appendChild(a)
  })
}

export function installPasswordEnhancer(){
  enhancePasswords()
  new MutationObserver(enhancePasswords).observe(document.documentElement,{childList:true,subtree:true})
}
