import './admin-messages.css'
import './admin-blue-final.css'
import { installAdminConsultationsV2 } from './admin-consultations-v2'
import { installAdminClinicalExport } from './admin-clinical-export'
import { installAdminFinanceEnhancer } from './admin-finance-enhancer'

type ContactMessage={id:number;name:string;email:string;phone:string;message:string;status:string;created_at:string}
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]||c))
const dateTime=(value:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))

// A API de mensagens administrativas compartilha o endpoint de contato.
// O parâmetro admin=1 mantém a rota pública /api/contact isolada da leitura do painel.
async function getMessages(){const r=await fetch('/api/contact?admin=1',{credentials:'include'});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível carregar as mensagens.');return (d.messages||[]) as ContactMessage[]}
async function setMessageStatus(id:number,status:'new'|'read'){const r=await fetch('/api/contact?admin=1',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({admin_action:'status',id,status})});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível atualizar a mensagem.')}

function topTitle(){return (document.querySelector<HTMLElement>('.admin-topbar h1')?.textContent||'').trim()}
function cleanupCustomViews(){
  const title=topTitle();const host=document.querySelector<HTMLElement>('.admin-custom-view');if(!host)return
  if(title==='Visão geral'||title==='Consultas'||title==='Pagamentos'||title==='Financeiro')host.querySelector('.admin-dashboard-actions')?.remove()
  if(title==='Consultas'||title==='Pagamentos'||title==='Financeiro')host.querySelector('.admin-section-title')?.remove()
  if(title==='Pagamentos'||title==='Financeiro')host.querySelectorAll<HTMLElement>('.admin-table-row:not(.header)').forEach(row=>row.children[1]?.querySelector('small')?.remove())
}

function setHeader(title:string){const h=document.querySelector<HTMLElement>('.admin-topbar h1');const k=document.querySelector<HTMLElement>('.admin-topbar .section-kicker');if(h)h.textContent=title;if(k)k.textContent='Gestão profissional'}
function setActive(button:HTMLButtonElement){document.querySelectorAll<HTMLButtonElement>('.admin-sidebar nav button').forEach(b=>b.classList.toggle('active',b===button))}
function menuLabelForTitle(title:string){
  if(title==='Visão geral'||title==='Painel')return 'Painel'
  if(title==='Agenda')return 'Agenda'
  if(title==='Consultas')return 'Consultas'
  if(title==='Financeiro'||title==='Pagamentos')return 'Financeiro'
  if(title==='Pacientes e prontuários'||title==='Pacientes')return 'Pacientes'
  if(title==='Mensagens')return 'Mensagens'
  if(title==='Configurações'||title==='Tabelas de Preços'||title==='Segurança'||title==='Gestão de usuários')return 'Configurações'
  return ''
}
function normalizeSidebarActive(){
  const buttons=[...document.querySelectorAll<HTMLButtonElement>('.admin-sidebar nav button')]
  if(!buttons.length)return
  const wanted=menuLabelForTitle(topTitle())
  if(!wanted)return
  const target=buttons.find(button=>{const label=(button.textContent||'').trim();return label===wanted||(wanted==='Financeiro'&&label==='Pagamentos')})
  if(target)setActive(target)
}
function bindSingleActiveNavigation(){
  const sidebar=document.querySelector<HTMLElement>('.admin-sidebar');if(!sidebar||sidebar.dataset.singleActiveBound)return
  sidebar.dataset.singleActiveBound='1'
  sidebar.addEventListener('click',event=>{
    const target=(event.target as HTMLElement|null)?.closest<HTMLButtonElement>('nav button');if(!target)return
    ;[0,40,140,300].forEach(ms=>window.setTimeout(()=>{
      const label=(target.textContent||'').trim()
      if(label==='Mensagens')setActive(target)
      else normalizeSidebarActive()
    },ms))
  },true)
}

async function renderMessages(button:HTMLButtonElement){
  const main=document.querySelector<HTMLElement>('.admin-main');if(!main)return
  main.classList.add('admin-custom-mode');main.querySelector('.admin-custom-view')?.remove();setActive(button);setHeader('Mensagens');localStorage.setItem('psicogestao.admin.view','mensagens')
  const host=document.createElement('div');host.className='admin-custom-view admin-messages-view';host.innerHTML='<div class="admin-dashboard-empty">Carregando mensagens...</div>';main.appendChild(host)
  try{
    const messages=await getMessages(),unread=messages.filter(m=>m.status==='new').length
    host.innerHTML=`<div class="admin-messages-summary"><span><strong>${unread}</strong> nova(s)</span><span>${messages.length} mensagem(ns)</span></div><div class="admin-messages-list">${messages.length?messages.map(m=>`<article class="admin-message-card ${m.status==='new'?'is-new':''}" data-message-id="${m.id}"><div class="admin-message-head"><div><strong>${esc(m.name)}</strong><span>${esc(dateTime(m.created_at))}</span></div><span class="admin-message-status">${m.status==='new'?'Nova':'Lida'}</span></div><div class="admin-message-contact"><a href="mailto:${esc(m.email)}">${esc(m.email)}</a><a href="tel:${esc(m.phone)}">${esc(m.phone)}</a></div><p>${esc(m.message)}</p><button type="button" class="secondary-button" data-message-toggle="${m.status==='new'?'read':'new'}">${m.status==='new'?'Marcar como lida':'Marcar como nova'}</button></article>`).join(''):'<div class="admin-dashboard-empty">Nenhuma mensagem recebida.</div>'}</div>`
    host.querySelectorAll<HTMLButtonElement>('[data-message-toggle]').forEach(action=>action.addEventListener('click',async()=>{const card=action.closest<HTMLElement>('[data-message-id]');if(!card)return;action.disabled=true;try{await setMessageStatus(Number(card.dataset.messageId),action.dataset.messageToggle as 'new'|'read');await renderMessages(button)}catch(e){action.disabled=false;alert(e instanceof Error?e.message:'Não foi possível atualizar a mensagem.')}}))
  }catch(e){host.innerHTML=`<div class="error-box">${esc(e instanceof Error?e.message:'Não foi possível carregar as mensagens.')}</div>`}
}

function bindMessages(){
  const button=[...document.querySelectorAll<HTMLButtonElement>('.admin-sidebar nav button')].find(b=>(b.textContent||'').trim()==='Mensagens');if(!button)return false
  button.disabled=false
  if(!button.dataset.messagesBound){button.dataset.messagesBound='1';button.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();void renderMessages(button)},true)}
  return true
}

export function installAdminMessagesEnhancer(){
  installAdminConsultationsV2();installAdminClinicalExport();installAdminFinanceEnhancer()
  const apply=()=>{bindMessages();bindSingleActiveNavigation();cleanupCustomViews();normalizeSidebarActive()}
  ;[0,100,300,700].forEach(ms=>setTimeout(apply,ms))
  const root=document.getElementById('root');if(root)new MutationObserver(()=>apply()).observe(root,{childList:true,subtree:true})
}
