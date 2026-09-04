let installed=false

async function request(path:string,init?:RequestInit){
  const response=await fetch(path,{credentials:'include',cache:'no-store',headers:{'content-type':'application/json',...(init?.headers||{})},...init})
  const data=await response.json().catch(()=>({})) as any
  if(!response.ok)throw new Error(data.message||'Não foi possível concluir a solicitação.')
  return data
}

function syncDeleteAccount(){
  const host=document.querySelector<HTMLElement>('.patient-stable-view')
  if(!host)return
  const title=host.querySelector<HTMLElement>('.patient-page-title')?.textContent?.trim()||''

  if(title==='Meus dados'){
    host.querySelectorAll<HTMLElement>('.patient-danger-zone').forEach(section=>section.remove())
    return
  }

  if(title!=='Segurança')return
  const content=host.querySelector<HTMLElement>('.patient-section-content')
  if(!content||content.querySelector('.patient-security-delete-zone'))return

  const section=document.createElement('section')
  section.className='patient-panel patient-danger-zone patient-security-delete-zone'
  section.innerHTML=`
    <h2>Excluir conta</h2>
    <p><strong>A exclusão do seu acesso é irreversível.</strong> Seu cadastro clínico, histórico de atendimentos e prontuário permanecerão preservados para a psicóloga.</p>
    <form class="patient-form" data-security-delete-account>
      <label>Confirme sua senha de acesso<input name="current_password" type="password" autocomplete="current-password" required></label>
      <button type="submit" class="patient-danger-button">Excluir minha conta</button>
      <div class="patient-action-message" aria-live="polite"></div>
    </form>`
  content.appendChild(section)
}

export function installPatientSecurityDeletePolish(){
  if(installed)return
  installed=true

  document.addEventListener('submit',event=>{
    const form=(event.target as HTMLElement|null)?.closest<HTMLFormElement>('[data-security-delete-account]')
    if(!form)return
    event.preventDefault()
    const message=form.querySelector<HTMLElement>('.patient-action-message')
    const password=String(new FormData(form).get('current_password')||'')
    const confirmed=window.confirm('ATENÇÃO: esta ação é irreversível para o seu acesso ao Portal do Paciente. Seu prontuário e registros de atendimento serão preservados para a psicóloga. Deseja realmente excluir sua conta?')
    if(!confirmed)return
    if(message)message.textContent='Excluindo conta...'
    void request('/api/me/account',{method:'DELETE',body:JSON.stringify({current_password:password,confirmation:'EXCLUIR MINHA CONTA'})})
      .then(()=>{
        localStorage.removeItem('patientPortalTab')
        window.location.href='/?conta-excluida=1'
      })
      .catch(error=>{if(message)message.textContent=error instanceof Error?error.message:'Não foi possível excluir a conta.'})
  },true)

  const schedule=()=>window.setTimeout(syncDeleteAccount,0)
  const hostObserver=new MutationObserver(schedule)
  const observe=()=>{
    const host=document.querySelector('.patient-stable-view')
    if(host){hostObserver.disconnect();hostObserver.observe(host,{childList:true,subtree:true});syncDeleteAccount()}
  }
  observe()
  document.addEventListener('click',event=>{
    const tab=(event.target as HTMLElement|null)?.closest('[data-patient-tab]')
    if(tab)window.setTimeout(()=>{observe();syncDeleteAccount()},100)
  },true)
  window.addEventListener('pageshow',()=>window.setTimeout(observe,100))
}
