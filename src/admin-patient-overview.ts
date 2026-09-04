import { readAdminSession } from './admin-session-reader'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}})

export async function handleAdminPatientOverview(request:Request,env:Env,path:string):Promise<Response|null>{
  const match=path.match(/^\/api\/admin\/patients\/(\d+)\/overview$/)
  if(!match)return null
  if(request.method!=='GET')return json({ok:false,message:'Método não permitido.'},405)
  const admin=await readAdminSession(request,env)
  if(!admin)return json({ok:false,message:'Acesso profissional necessário.'},401)
  if(admin.role!=='psychologist')return json({ok:false,message:'Dados clínicos e recorrência são restritos à psicóloga responsável.'},403)

  const patientId=Number(match[1])
  const patient=await env.DB.prepare('SELECT id,full_name,birth_date,cpf,phone,email,pricing_origin,created_at FROM patients WHERE id=?').bind(patientId).first<any>()
  if(!patient)return json({ok:false,message:'Paciente não encontrado.'},404)

  const appointments=await env.DB.prepare('SELECT a.id,a.status,a.amount_cents,a.paid_at,av.starts_at,av.ends_at FROM appointments a LEFT JOIN availability av ON av.id=a.availability_id WHERE a.patient_id=? ORDER BY av.starts_at DESC').bind(patientId).all<any>()
  const recurrence=await env.DB.prepare('SELECT id,patient_id,cadence_days,active,source_appointment_id,created_at,updated_at FROM patient_recurrence WHERE patient_id=? LIMIT 1').bind(patientId).first<any>().catch(()=>null)
  return json({ok:true,patient,appointments:appointments.results||[],recurrence})
}
