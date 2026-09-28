import './admin-site.css'

type PhotoMeta={file_name:string;mime_type:string;size_bytes:number;version:string;updated_at?:string|null;url:string}

const MAX_SIZE=5*1024*1024
const ALLOWED_TYPES=new Set(['image/jpeg','image/png','image/webp'])
let mounting=false

function isSitePage(){return location.pathname.replace(/\/+$/,'')==='/admin/configuracoes/site'}
function esc(value:unknown){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))}
async function request(path:string,init?:RequestInit){
  const response=await fetch(path,{credentials:'include',cache:'no-store',...init})
  const data=await response.json().catch(()=>({})) as any
  if(!response.ok)throw new Error(data.message||'Não foi possível concluir a solicitação.')
  return data
}

function previewMarkup(photo:PhotoMeta|null){
  if(!photo)return '<div class="admin-site-photo-empty">Nenhuma foto de apresentação cadastrada.</div>'
  return `<div class="admin-site-photo-current"><img src="${esc(photo.url)}" alt="Foto de apresentação atual de Jacqueline Siqueira"><div><strong>${esc(photo.file_name)}</strong><span>${(Number(photo.size_bytes||0)/1024/1024).toFixed(2)} MB</span></div></div>`
}

function render(host:HTMLElement,photo:PhotoMeta|null,notice=''){
  host.innerHTML=`<section class="admin-panel admin-site-panel">
    <div class="admin-site-heading"><div><span class="section-kicker">Landing page</span><h2>Foto de apresentação</h2><p>Gerencie a foto profissional exibida na página inicial do site.</p></div></div>
    ${notice?`<div class="admin-site-notice">${esc(notice)}</div>`:''}
    <div class="admin-site-photo-preview">${previewMarkup(photo)}</div>
    <form class="admin-form admin-site-photo-form" data-site-photo-form>
      <label>Nova foto<input name="photo" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" required></label>
      <small>Formatos JPG, PNG ou WebP • máximo de 5 MB. Para melhor resultado, use uma foto vertical em boa resolução.</small>
      <div class="admin-site-actions">
        <button class="admin-primary" type="submit" data-site-photo-upload>${photo?'Enviar outra foto':'Fazer upload'}</button>
        ${photo?'<button class="secondary-button admin-site-delete" type="button" data-site-photo-delete>Remover foto</button>':''}
      </div>
    </form>
  </section>`

  const form=host.querySelector<HTMLFormElement>('[data-site-photo-form]')
  form?.addEventListener('submit',async event=>{
    event.preventDefault()
    const input=form.elements.namedItem('photo') as HTMLInputElement
    const file=input?.files?.[0]
    if(!file){render(host,photo,'Selecione uma imagem para enviar.');return}
    if(file.size<=0||file.size>MAX_SIZE){render(host,photo,'A imagem deve ter no máximo 5 MB.');return}
    if(file.type&&!ALLOWED_TYPES.has(file.type)){render(host,photo,'Use uma imagem JPG, PNG ou WebP.');return}

    const button=host.querySelector<HTMLButtonElement>('[data-site-photo-upload]')
    if(button){button.disabled=true;button.textContent='Enviando...'}
    try{
      const fd=new FormData();fd.append('photo',file)
      const data=await request('/api/admin/site-photo',{method:'POST',body:fd})
      render(host,data.photo||null,'Foto atualizada. A landing page já usará a nova imagem.')
    }catch(error){
      render(host,photo,error instanceof Error?error.message:'Não foi possível enviar a foto.')
    }
  })

  host.querySelector<HTMLButtonElement>('[data-site-photo-delete]')?.addEventListener('click',async()=>{
    if(!confirm('Remover a foto de apresentação atual? A landing page voltará a mostrar o espaço padrão até outra foto ser enviada.'))return
    const button=host.querySelector<HTMLButtonElement>('[data-site-photo-delete]')
    if(button){button.disabled=true;button.textContent='Removendo...'}
    try{
      await request('/api/admin/site-photo',{method:'DELETE'})
      render(host,null,'Foto removida. Você pode enviar outra quando quiser.')
    }catch(error){
      render(host,photo,error instanceof Error?error.message:'Não foi possível remover a foto.')
    }
  })
}

async function mount(){
  if(!isSitePage()||mounting)return
  const main=document.querySelector<HTMLElement>('.admin-main')
  if(!main)return
  let host=main.querySelector<HTMLElement>('.admin-site-host')
  if(host)return

  mounting=true
  document.querySelectorAll<HTMLElement>('.settings-panel').forEach(panel=>panel.style.display='none')
  document.querySelector('.admin-security-host')?.remove()
  host=document.createElement('div');host.className='admin-site-host'
  host.innerHTML='<div class="empty-state">Carregando configurações do site...</div>'
  main.appendChild(host)
  try{
    const data=await request('/api/admin/site-photo')
    if(host.isConnected)render(host,data.photo||null)
  }catch(error){
    if(host.isConnected)host.innerHTML=`<div class="error-box">${esc(error instanceof Error?error.message:'Não foi possível carregar esta área.')}</div>`
  }finally{mounting=false}
}

function cleanup(){
  if(isSitePage())return
  document.querySelector('.admin-site-host')?.remove()
}

export function installAdminSiteEnhancer(){
  let timer:number|undefined
  const schedule=()=>{if(timer)window.clearTimeout(timer);timer=window.setTimeout(()=>{timer=undefined;if(isSitePage())void mount();else cleanup()},70)}
  schedule()
  ;[150,350,700].forEach(ms=>window.setTimeout(schedule,ms))
  const root=document.getElementById('root')
  if(root)new MutationObserver(schedule).observe(root,{childList:true,subtree:true})
  window.addEventListener('popstate',schedule)
  window.addEventListener('pageshow',schedule)
  window.addEventListener('psicogestao:config-route',schedule as EventListener)
  window.addEventListener('psicogestao:config-route-exit',schedule as EventListener)
}
