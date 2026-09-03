let installed=false
const invite=()=>new URLSearchParams(window.location.search).get('invite')?.trim()||''

function injectInviteIntoRegister(){
  if(installed)return;installed=true
  const original=window.fetch.bind(window)
  window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url
    const token=invite()
    if(token&&url.includes('/api/auth/register')&&String(init?.method||'GET').toUpperCase()==='POST'){
      try{const body=JSON.parse(String(init?.body||'{}'));body.invite_token=token;init={...init,body:JSON.stringify(body)}}catch{}
    }
    return original(input,init)
  }
}

function enhanceInviteRegistration(){
  if(!invite())return
  const cadastroTitle=[...document.querySelectorAll<HTMLElement>('.auth-card h1')].find(x=>x.textContent?.trim()==='Crie sua conta')
  if(cadastroTitle){
    document.querySelector<HTMLElement>('.auth-card .google-button')?.remove();document.querySelector<HTMLElement>('.auth-card .divider')?.remove()
    const card=cadastroTitle.closest<HTMLElement>('.auth-card')
    if(card&&!card.querySelector('.platform-invite-note')){const note=document.createElement('div');note.className='platform-invite-note';note.textContent='Cadastro vinculado à condição de atendimento enviada pela profissional. O valor correto será aplicado automaticamente no agendamento.';cadastroTitle.insertAdjacentElement('afterend',note)}
    return
  }
  const auth=document.querySelector<HTMLElement>('.auth-page')
  if(auth){const switchButton=[...auth.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='Criar conta');switchButton?.click();return}
  const site=document.querySelector<HTMLElement>('.site-shell')
  if(site){const access=[...site.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='Área do paciente');access?.click()}
}

export function installPlatformInviteEnhancer(){
  injectInviteIntoRegister()
  if(!invite())return
  if(!document.getElementById('platform-invite-style')){const s=document.createElement('style');s.id='platform-invite-style';s.textContent='.platform-invite-note{margin:0 0 16px;padding:12px 14px;border:1px solid #c9dcef;border-radius:11px;background:#f2f7fd;color:#315f9c;font-size:13px;line-height:1.5}';document.head.appendChild(s)}
  const run=()=>enhanceInviteRegistration();[50,180,450,900].forEach(ms=>setTimeout(run,ms));const root=document.getElementById('root');if(root)new MutationObserver(()=>run()).observe(root,{childList:true,subtree:true})
}
