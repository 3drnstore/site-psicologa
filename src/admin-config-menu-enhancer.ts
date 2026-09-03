import './admin-config-menu.css'

type ConfigSection='pricing'|'security'|'users'
const KEY='psicogestao.admin.config.section'

function configButton(){return [...document.querySelectorAll<HTMLButtonElement>('.admin-sidebar nav button')].find(b=>(b.textContent||'').trim()==='Configurações')}
function configActive(){return configButton()?.classList.contains('active')===true}

function ensureMenu(){
  const button=configButton();if(!button)return null
  let menu=button.nextElementSibling as HTMLElement|null
  if(!menu?.classList.contains('admin-config-submenu')){
    menu=document.createElement('div');menu.className='admin-config-submenu';menu.innerHTML=`<button type="button" data-config-section="pricing">Tabelas de Preços</button><button type="button" data-config-section="security">Segurança</button><button type="button" data-config-section="users">Gestão de usuários</button>`;button.after(menu)
  }
  return menu
}

function historyPanel(){return document.querySelector<HTMLElement>('.admin-session-security .admin-security-subpanel:nth-of-type(2)')}
function sessionsPanel(){return document.querySelector<HTMLElement>('.admin-session-security .admin-security-subpanel:nth-of-type(1)')}

function apply(section:ConfigSection){
  if(!configActive())return
  localStorage.setItem(KEY,section)
  const menu=ensureMenu();menu?.querySelectorAll<HTMLButtonElement>('[data-config-section]').forEach(b=>b.classList.toggle('active',b.dataset.configSection===section))
  const pricing=document.querySelector<HTMLElement>('.settings-panel')
  const security=document.querySelector<HTMLElement>('.admin-security-panel')
  const users=document.querySelector<HTMLElement>('.admin-users-panel')
  const securityHeading=security?.querySelector<HTMLElement>('.admin-security-heading')
  const twofa=security?.querySelector<HTMLElement>('[data-admin-2fa-card]')
  const securityGrid=security?.querySelector<HTMLElement>('.admin-security-grid')
  const sessions=sessionsPanel(),history=historyPanel()
  if(pricing)pricing.hidden=section!=='pricing'
  if(security)security.hidden=section==='pricing'
  if(users)users.hidden=section!=='users'
  if(securityHeading)securityHeading.hidden=section==='users'
  if(twofa)twofa.hidden=section==='users'
  if(securityGrid)securityGrid.hidden=section==='users'
  if(sessions)sessions.hidden=section!=='security'
  if(history)history.hidden=section!=='users'
  security?.classList.toggle('config-users-history-only',section==='users')
}

function bindMenu(menu:HTMLElement){
  if(menu.dataset.bound)return;menu.dataset.bound='1'
  menu.addEventListener('click',event=>{
    const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-config-section]');if(!button)return
    event.preventDefault();event.stopPropagation();apply((button.dataset.configSection||'pricing') as ConfigSection)
  })
}

function scan(){
  const menu=ensureMenu();if(!menu)return
  bindMenu(menu);menu.hidden=!configActive()
  if(!configActive())return
  const saved=localStorage.getItem(KEY) as ConfigSection|null
  const safe:ConfigSection=saved==='security'||saved==='users'||saved==='pricing'?saved:'pricing'
  apply(safe)
}

export function installAdminConfigMenuEnhancer(){
  let timer:number|undefined
  const schedule=()=>{if(timer)clearTimeout(timer);timer=window.setTimeout(()=>{timer=undefined;scan()},120)}
  schedule();[250,600,1100].forEach(ms=>window.setTimeout(scan,ms))
  const root=document.getElementById('root');if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']})
  window.addEventListener('pageshow',schedule)
}
