import { readCookie, sha256 } from './auth'
import { ensurePlatformPricing } from './platform-pricing'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const now=()=>new Date().toISOString()

async function admin(request:Request,env:Env){
  const token=readCookie(request,'ps_admin_session')
  if(!token)return null
  return env.DB.prepare(`SELECT a.id FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),now()).first<any>()
}
async function tableExists(env:Env,name:string){return Boolean(await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(name).first<any>())}

export async function handleAdminPatientsV2(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/admin/patients'&& !/^\/api\/admin\/patients\/\d+$/.test(path))return null
  const a=await admin(request,env)
  if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
  await ensurePlatformPricing(env)

  if(path==='/api/admin/patients'&&request.method==='GET'){
    try{
      const hasAppointments=await tableExists(env,'appointments')
      const hasAvailability=await tableExists(env,'availability')
      if(hasAppointments&&hasAvailability){
        const result=await env.DB.prepare(`
          SELECT p.id,p.full_name,p.birth_date,p.cpf,p.phone,p.email,p.pricing_origin,p.created_at,
                 COUNT(a.id) AS appointment_count,MAX(av.starts_at) AS last_appointment_at
          FROM patients p
          LEFT JOIN appointments a ON a.patient_id=p.id
          LEFT JOIN availability av ON av.id=a.availability_id
          GROUP BY p.id,p.full_name,p.birth_date,p.cpf,p.phone,p.email,p.pricing_origin,p.created_at
          ORDER BY p.full_name COLLATE NOCASE
        `).all<any>()
        return json({ok:true,patients:result.results||[]})
      }
      const result=await env.DB.prepare(`SELECT id,full_name,birth_date,cpf,phone,email,pricing_origin,created_at,0 AS appointment_count,NULL AS last_appointment_at FROM patients ORDER BY full_name COLLATE NOCASE`).all<any>()
      return json({ok:true,patients:result.results||[]})
    }catch(error){console.error('Admin patients list error:',error);return json({ok:false,message:'Não foi possível carregar os pacientes cadastrados.'},500)}
  }

  const match=path.match(/^\/api\/admin\/patients\/(\d+)$/)
  if(match&&request.method==='GET'){
    const id=Number(match[1])
    const patient=await env.DB.prepare(`SELECT id,full_name,birth_date,cpf,phone,email,pricing_origin,created_at FROM patients WHERE id=?`).bind(id).first<any>()
    if(!patient)return json({ok:false,message:'Paciente não encontrado.'},404)
    let appointments:any[]=[];let clinical_notes:any[]=[]
    if(await tableExists(env,'appointments')){const result=await env.DB.prepare(`SELECT a.id,a.status,a.amount_cents,a.paid_at,av.starts_at,av.ends_at FROM appointments a LEFT JOIN availability av ON av.id=a.availability_id WHERE a.patient_id=? ORDER BY av.starts_at DESC`).bind(id).all<any>();appointments=result.results||[]}
    if(await tableExists(env,'clinical_notes')){const result=await env.DB.prepare(`SELECT id,appointment_id,session_date,note_text,created_at,updated_at FROM clinical_notes WHERE patient_id=? ORDER BY session_date DESC,created_at DESC`).bind(id).all<any>();clinical_notes=result.results||[]}
    return json({ok:true,patient,appointments,clinical_notes})
  }

  return json({ok:false,message:'Método não permitido.'},405)
}
