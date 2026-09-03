import './admin-config-menu.css'

type ConfigPage='pricing'|'security'|'users'
const routes:Record<ConfigPage,string>={pricing:'/admin/configuracoes/tabelas-precos',security:'/admin/configuracoes/seguranca',users:'/admin/configuracoes/usuarios'}
let activating=false

function configButton(){return [...document.querySelectorAll<HTMLButtonElement>('.admin-sidebar nav button')].find(b=>(b.textContent||'').trim()==='Configurações')}
function pageFromPath():ConfigPage|null{const p=location.pathname.replace(/\/+$/,'');if(p===routes.pricing)return'pricing';if(p===routes.security)return'security';if(p===routes.users)return'users';return null}
function setHeader(page:ConfigPage){const h=document.querySelector<HTMLElement>('.admin-topbar h1');const k=document.querySelector<HTMLElement>('.admin-topbar .section-kicker');if(h)h.textContent=page==='pricing'?'Tabelas de Preços':page==='security'?'Segurança':'Gestão de usuários';if(k)k.textContent='Configurações'}
function setConfigActive(){document.querySelectorAll<HTMLButtonElement>('.admin-sidebar nav button').forEach(b=>b.classList.toggle('active',b===configButton()))}

function leaveConfigRoute(){
  if(pageFromPath())history.replaceState({},'','/admin')
  const menu=document.querySelector<HTMLElement>('.admin-config-submenu')
  if(menu){menu.hidden=true;menu.querySelectorAll<HTMLElement>('[data-config-page]').forEach(el=>el.classList.remove('active'))}
  delete document.documentElement.dataset.adminConfigPage
  window.dispatchEvent(new CustomEvent('psicogestao:config-route-exit'))
}

function ensureMenu(){
  const parent=configButton();if(!parent)return null
  let menu=parent.nextElementSibling as HTMLElement|null
  if(!menu?.classList.contains('admin-config-submenu')){
    menu=document.createElement('div');menu.className='admin-config-submenu';menu.innerHTML=`<a href="${routes.pricing}" data-config-page="pricing">Tabelas de Preços</a><a href="${routes.security}" data-config-page="security">Segurança</a><a href="${routes.users}" data-config-page="users">Gestão de usuários</a>`;parent.after(menu)
  }
  if(!parent.dataset.configRouteBound){parent.dataset.configRouteBound='1';parent.addEventListener('click',()=>{if(!pageFromPath())window.setTimeout(()=>navigate('pricing'),0)})}
  if(!menu.dataset.bound){menu.dataset.bound='1';menu.addEventListener('click',e=>{const a=(e.target as HTMLElement).closest<HTMLAnchorElement>('[data-config-page]');if(!a)return;e.preventDefault();navigate(a.dataset.configPage as ConfigPage)})}
  const nav=parent.closest('nav')
  if(nav&&!nav.hasAttribute('data-config-exit-bound')){
    nav.setAttribute('data-config-exit-bound','1')
    nav.addEventListener('click',e=>{
      const button=(e.target as HTMLElement).closest<HTMLButtonElement>('button')
      if(!button||button===configButton())return
      leaveConfigRoute()
    },true)
  }
  return menu
}

function navigate(page:ConfigPage,replace=false){const url=routes[page];if(location.pathname!==url)history[replace?'replaceState':'pushState']({},'',url);localStorage.setItem('psicogestao.admin.view','configuracoes');render(page);window.dispatchEvent(new CustomEvent('psicogestao:config-route',{detail:{page}}))}
function render(page:ConfigPage){const button=configButton(),menu=ensureMenu();if(!button||!menu)return;setConfigActive();setHeader(page);menu.hidden=false;menu.querySelectorAll<HTMLElement>('[data-config-page]').forEach(el=>el.classList.toggle('active',el.dataset.configPage===page));document.documentElement.dataset.adminConfigPage=page}
function ensureReactConfigMounted(){const button=configButton();if(!button||document.querySelector('.settings-panel')||activating)return;activating=true;button.click();window.setTimeout(()=>{activating=false;const page=pageFromPath();if(page){render(page);window.dispatchEvent(new CustomEvent('psicogestao:config-route',{detail:{page}}))}},80)}
function scan(){const menu=ensureMenu();if(!menu)return;const page=pageFromPath();if(page){ensureReactConfigMounted();render(page);return}menu.hidden=true;menu.querySelectorAll<HTMLElement>('[data-config-page]').forEach(el=>el.classList.remove('active'));delete document.documentElement.dataset.adminConfigPage}
export function installAdminConfigMenuEnhancer(){let timer:number|undefined;const schedule=()=>{if(timer)clearTimeout(timer);timer=window.setTimeout(()=>{timer=undefined;scan()},80)};schedule();[180,450,900].forEach(ms=>window.setTimeout(scan,ms));const root=document.getElementById('root');if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true});window.addEventListener('popstate',schedule);window.addEventListener('pageshow',schedule)}
