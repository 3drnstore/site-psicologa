import './professional-photo.css'

let installed=false

async function applyPhoto(){
  const holder=document.querySelector<HTMLElement>('.site-shell .hero-art .portrait-placeholder')
  if(!holder)return false
  try{
    const response=await fetch('/api/site/professional-photo/meta',{cache:'no-store'})
    if(!response.ok)return true
    const data=await response.json().catch(()=>({})) as any
    const photo=data.photo
    if(!photo?.url)return true

    const image=new Image()
    image.className='professional-photo'
    image.alt='Foto profissional da psicóloga Jacqueline Siqueira'
    image.decoding='async'
    image.loading='eager'
    image.onload=()=>{
      if(!holder.isConnected)return
      holder.innerHTML=''
      holder.classList.add('has-professional-photo')
      holder.appendChild(image)
    }
    image.src=String(photo.url)
  }catch{}
  return true
}

export function installProfessionalPhotoEnhancer(){
  if(installed)return
  installed=true
  let attempts=0
  const run=async()=>{
    attempts+=1
    if(await applyPhoto()||attempts>=20)return
    window.setTimeout(()=>void run(),60)
  }
  void run()
}
