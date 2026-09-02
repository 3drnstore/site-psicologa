let installed=false

function applyProfessionalPhotoTest(){
  const placeholder=document.querySelector<HTMLElement>('.site-shell .hero .portrait-placeholder')
  if(!placeholder)return false
  if(placeholder.dataset.photoTestReady==='1')return true

  placeholder.dataset.photoTestReady='1'
  placeholder.classList.add('portrait-photo-test')
  placeholder.innerHTML=''

  const img=document.createElement('img')
  img.src='/site-photo-test.jpg'
  img.alt='Foto profissional temporária para teste de layout'
  img.className='professional-photo-test'
  img.loading='eager'
  img.decoding='async'
  placeholder.appendChild(img)
  return true
}

export function installProfessionalPhotoTest(){
  if(installed)return
  installed=true
  let attempts=0
  const run=()=>{
    attempts+=1
    if(applyProfessionalPhotoTest()||attempts>=20)return
    window.setTimeout(run,80)
  }
  run()
  window.addEventListener('pageshow',run)
}
