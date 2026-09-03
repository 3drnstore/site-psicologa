import './admin-clinical-export.css'
import { clinicalRtf, downloadBackupZip, downloadPdf, downloadWord, patientFolderName, sessionFolderName, utf8 } from './clinical-export-utils'

type Patient={id:number;full_name:string;email:string;phone?:string;birth_date?:string;cpf?:string}
type Note={id:string;session_date:string;note_text:string;created_at?:string}
type PatientDetail={patient:Patient;clinical_notes:Note[]}

async function json(path:string){const r=await fetch(path,{credentials:'include',cache:'no-store'});const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw new Error(d.message||'Não foi possível carregar os dados.');return d}
async function allPatients(){const d=await json('/api/admin/patients');return (d.patients||[]) as Patient[]}
async function detail(id:number){return await json(`/api/admin/patients/${id}`) as PatientDetail}

let exporting=false,lastSelected=''
async function enhanceSelectedPatient(){
  if(exporting)return
  const list=document.querySelector<HTMLElement>('.patient-list'),record=document.querySelector<HTMLElement>('.record-panel');if(!list||!record)return
  const active=list.querySelector<HTMLElement>('.patient-card.active');if(!active)return
  const email=(active.querySelector('span')?.textContent||'').trim();if(!email)return
  const articles=[...record.querySelectorAll<HTMLElement>('.note-list article')]
  if(!articles.length)return
  const key=email+'|'+articles.length;if(key===lastSelected&&articles.every(a=>a.querySelector('.clinical-export-actions')))return
  exporting=true
  try{
    const patients=await allPatients(),p=patients.find(x=>String(x.email).toLowerCase()===email.toLowerCase());if(!p)return
    const d=await detail(p.id);lastSelected=key
    articles.forEach((article,i)=>{
      article.querySelector('.clinical-export-actions')?.remove();const note=d.clinical_notes[i];if(!note)return
      const actions=document.createElement('div');actions.className='clinical-export-actions';actions.innerHTML='<button type="button" data-export-word>Exportar Word</button><button type="button" data-export-pdf>Exportar PDF</button>'
      actions.querySelector<HTMLButtonElement>('[data-export-word]')?.addEventListener('click',()=>downloadWord(d.patient,note))
      actions.querySelector<HTMLButtonElement>('[data-export-pdf]')?.addEventListener('click',()=>downloadPdf(d.patient,note))
      article.appendChild(actions)
    })
  }catch(e){console.error('Clinical export enhancer:',e)}finally{exporting=false}
}

function installBackupButton(){
  const list=document.querySelector<HTMLElement>('.patient-list'),head=list?.querySelector<HTMLElement>('.admin-section-head');if(!head||head.querySelector('.clinical-backup-button'))return
  const button=document.createElement('button');button.type='button';button.className='clinical-backup-button';button.textContent='Exportar backup dos prontuários';head.appendChild(button)
  button.addEventListener('click',async()=>{
    button.disabled=true;const original=button.textContent;button.textContent='Preparando backup...'
    try{
      const patients=await allPatients(),files:{name:string;data:Uint8Array}[]=[];let totalNotes=0
      for(let i=0;i<patients.length;i++){
        button.textContent=`Preparando ${i+1}/${patients.length}...`;const d=await detail(patients[i].id)
        for(const note of d.clinical_notes||[]){totalNotes++;const folder=`${patientFolderName(d.patient.full_name)}/${sessionFolderName(note.session_date)}`;files.push({name:`${folder}/anamnese.rtf`,data:utf8(clinicalRtf(d.patient,note))})}
      }
      files.push({name:'LEIA-ME.txt',data:utf8(`Backup de prontuários do PsicoGestão\nGerado em: ${new Date().toLocaleString('pt-BR')}\nPacientes consultados: ${patients.length}\nSessões exportadas: ${totalNotes}\n\nEstrutura: Pasta_do_paciente/sessao_DD-MM-AAAA/anamnese.rtf\nOs arquivos RTF podem ser abertos no Microsoft Word.`)})
      downloadBackupZip(files)
    }catch(e){alert(e instanceof Error?e.message:'Não foi possível gerar o backup dos prontuários.')}finally{button.disabled=false;button.textContent=original||'Exportar backup dos prontuários'}
  })
}

export function installAdminClinicalExport(){
  const apply=()=>{installBackupButton();void enhanceSelectedPatient()};[0,150,400,900].forEach(ms=>setTimeout(apply,ms));const root=document.getElementById('root');if(root)new MutationObserver(()=>apply()).observe(root,{childList:true,subtree:true})
}
