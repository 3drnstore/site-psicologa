import { readAdminSession } from './admin-session-reader'
import { decryptClinicalNote, encryptClinicalNote } from './clinical-crypto'
import { ensureClinicalEncryptionSchema } from './clinical-schema'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','pragma':'no-cache'}})

async function audit(env:Env,actorId:string,action:string,entityId:string|number|null,metadata?:unknown){
  await env.DB.prepare('INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,metadata_json) VALUES(?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),'admin',actorId,action,'clinical_note',entityId==null?null:String(entityId),metadata?JSON.stringify(metadata):null).run()
}

async function psychologist(request:Request,env:Env){
  const admin=await readAdminSession(request,env)
  if(!admin)return {error:json({ok:false,message:'Acesso profissional necessário.'},401)} as const
  if(admin.role!=='psychologist')return {error:json({ok:false,message:'Prontuários clínicos são restritos à psicóloga responsável.'},403)} as const
  return {admin} as const
}

async function decryptRows(rows:any[],env:Env){
  const out=[]
  for(const row of rows){
    if(!row.note_ciphertext||!row.note_iv||!row.wrapped_dek||!row.wrap_iv||!row.encryption_version)continue
    const note_text=await decryptClinicalNote({note_ciphertext:String(row.note_ciphertext),note_iv:String(row.note_iv),wrapped_dek:String(row.wrapped_dek),wrap_iv:String(row.wrap_iv),encryption_version:String(row.encryption_version)},env)
    out.push({id:row.id,appointment_id:row.appointment_id,session_date:row.session_date,note_text,created_at:row.created_at,updated_at:row.updated_at})
  }
  return out
}

export async function handleClinicalApi(request:Request,env:Env,path:string):Promise<Response|null>{
  const isDetail=/^\/api\/admin\/patients\/\d+$/.test(path)&&request.method==='GET'
  const isCreate=/^\/api\/admin\/patients\/\d+\/notes$/.test(path)&&request.method==='POST'
  const isDelete=/^\/api\/admin\/notes\/[^/]+$/.test(path)&&request.method==='DELETE'
  if(!isDetail&&!isCreate&&!isDelete)return null

  const auth=await psychologist(request,env);if('error'in auth)return auth.error
  await ensureClinicalEncryptionSchema(env)

  if(isDetail){
    const patientId=Number(path.split('/')[4])
    const patient=await env.DB.prepare('SELECT id,full_name,birth_date,cpf,phone,email,pricing_origin,created_at FROM patients WHERE id=?').bind(patientId).first<any>()
    if(!patient)return json({ok:false,message:'Paciente não encontrado.'},404)
    const appointments=await env.DB.prepare('SELECT a.id,a.status,a.amount_cents,a.paid_at,av.starts_at,av.ends_at FROM appointments a LEFT JOIN availability av ON av.id=a.availability_id WHERE a.patient_id=? ORDER BY av.starts_at DESC').bind(patientId).all<any>()
    const encrypted=await env.DB.prepare('SELECT id,appointment_id,session_date,note_ciphertext,note_iv,wrapped_dek,wrap_iv,encryption_version,created_at,updated_at FROM clinical_notes WHERE patient_id=? ORDER BY session_date DESC,created_at DESC').bind(patientId).all<any>()
    const recurrence=await env.DB.prepare('SELECT id,patient_id,cadence_days,active,source_appointment_id,created_at,updated_at FROM patient_recurrence WHERE patient_id=? LIMIT 1').bind(patientId).first<any>().catch(()=>null)
    const clinical_notes=await decryptRows(encrypted.results||[],env)
    return json({ok:true,patient,appointments:appointments.results||[],clinical_notes,recurrence})
  }

  if(isCreate){
    const patientId=Number(path.split('/')[4])
    const data=await request.json().catch(()=>({})) as any
    const noteText=String(data.note_text||'').trim(),sessionDate=String(data.session_date||'').trim(),appointmentId=data.appointment_id?Number(data.appointment_id):null
    if(!noteText||!sessionDate)return json({ok:false,message:'Informe data da sessão e anotação.'},400)
    const patient=await env.DB.prepare('SELECT id FROM patients WHERE id=?').bind(patientId).first<any>()
    if(!patient)return json({ok:false,message:'Paciente não encontrado.'},404)
    const id=crypto.randomUUID(),envelope=await encryptClinicalNote(noteText,env)
    await env.DB.prepare('INSERT INTO clinical_notes(id,patient_id,appointment_id,author_admin_id,session_date,note_text,note_ciphertext,note_iv,wrapped_dek,wrap_iv,encryption_version) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id,patientId,appointmentId,auth.admin.id,sessionDate,'',envelope.note_ciphertext,envelope.note_iv,envelope.wrapped_dek,envelope.wrap_iv,envelope.encryption_version).run()
    await audit(env,auth.admin.id,'clinical_note_created',id,{patient_id:patientId,appointment_id:appointmentId,encryption_version:envelope.encryption_version})
    return json({ok:true,id},201)
  }

  const id=decodeURIComponent(path.split('/')[4]||'')
  const existing=await env.DB.prepare('SELECT patient_id FROM clinical_notes WHERE id=?').bind(id).first<any>()
  if(!existing)return json({ok:false,message:'Anotação não encontrada.'},404)
  await env.DB.prepare('DELETE FROM clinical_notes WHERE id=?').bind(id).run()
  await audit(env,auth.admin.id,'clinical_note_deleted',id,{patient_id:existing.patient_id})
  return json({ok:true})
}
