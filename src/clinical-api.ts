import { readAdminSession } from './admin-session-reader'
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

function validEnvelope(data:any){return ['note_ciphertext','note_iv','wrapped_dek','wrap_iv','encryption_version'].every(k=>typeof data?.[k]==='string'&&data[k].length>0)}

export async function handleClinicalApi(request:Request,env:Env,path:string):Promise<Response|null>{
  const isDetail=/^\/api\/admin\/patients\/\d+$/.test(path)&&request.method==='GET'
  const isCreate=/^\/api\/admin\/patients\/\d+\/notes$/.test(path)&&request.method==='POST'
  const isDelete=/^\/api\/admin\/notes\/[^/]+$/.test(path)&&request.method==='DELETE'
  const isVault=path==='/api/admin/clinical-vault'&&(request.method==='GET'||request.method==='POST')
  if(!isDetail&&!isCreate&&!isDelete&&!isVault)return null

  const auth=await psychologist(request,env);if('error'in auth)return auth.error
  await ensureClinicalEncryptionSchema(env)

  if(isVault&&request.method==='GET'){
    const row=await env.DB.prepare('SELECT wrapped_vault_key,wrap_iv,kdf_salt,kdf_iterations,version FROM clinical_vaults WHERE admin_user_id=?').bind(auth.admin.id).first<any>()
    return row?json({configured:true,...row}):json({configured:false})
  }

  if(isVault&&request.method==='POST'){
    const data=await request.json().catch(()=>({})) as any
    if(!data.wrapped_vault_key||!data.wrap_iv||!data.kdf_salt||!Number(data.kdf_iterations)||!data.version)return json({ok:false,message:'Configuração do cofre inválida.'},400)
    const existing=await env.DB.prepare('SELECT admin_user_id FROM clinical_vaults WHERE admin_user_id=?').bind(auth.admin.id).first<any>()
    if(existing)return json({ok:false,message:'O cofre clínico já foi configurado.'},409)
    await env.DB.prepare('INSERT INTO clinical_vaults(admin_user_id,wrapped_vault_key,wrap_iv,kdf_salt,kdf_iterations,version) VALUES(?,?,?,?,?,?)')
      .bind(auth.admin.id,String(data.wrapped_vault_key),String(data.wrap_iv),String(data.kdf_salt),Number(data.kdf_iterations),String(data.version)).run()
    await audit(env,auth.admin.id,'clinical_vault_created',auth.admin.id,{version:String(data.version)})
    return json({ok:true},201)
  }

  if(isDetail){
    const patientId=Number(path.split('/')[4])
    const patient=await env.DB.prepare('SELECT id,full_name,birth_date,cpf,phone,email,pricing_origin,created_at FROM patients WHERE id=?').bind(patientId).first<any>()
    if(!patient)return json({ok:false,message:'Paciente não encontrado.'},404)
    const appointments=await env.DB.prepare('SELECT a.id,a.status,a.amount_cents,a.paid_at,av.starts_at,av.ends_at FROM appointments a LEFT JOIN availability av ON av.id=a.availability_id WHERE a.patient_id=? ORDER BY av.starts_at DESC').bind(patientId).all<any>()
    const recurrence=await env.DB.prepare('SELECT id,patient_id,cadence_days,active,source_appointment_id,created_at,updated_at FROM patient_recurrence WHERE patient_id=? LIMIT 1').bind(patientId).first<any>().catch(()=>null)
    const wantsClinical=new URL(request.url).searchParams.get('clinical')==='1'
    if(!wantsClinical)return json({ok:true,patient,appointments:appointments.results||[],clinical_notes:[],recurrence,clinical_locked:true})
    const encrypted=await env.DB.prepare('SELECT id,appointment_id,session_date,note_ciphertext,note_iv,wrapped_dek,wrap_iv,encryption_version,created_at,updated_at FROM clinical_notes WHERE patient_id=? ORDER BY session_date DESC,created_at DESC').bind(patientId).all<any>()
    return json({ok:true,patient,appointments:appointments.results||[],clinical_notes:encrypted.results||[],recurrence,clinical_locked:false})
  }

  if(isCreate){
    const patientId=Number(path.split('/')[4]),data=await request.json().catch(()=>({})) as any
    const sessionDate=String(data.session_date||'').trim(),appointmentId=data.appointment_id?Number(data.appointment_id):null
    if(!sessionDate||!validEnvelope(data)||data.encryption_version!=='e2e-aes-256-gcm-v1')return json({ok:false,message:'Payload clínico criptografado inválido.'},400)
    const patient=await env.DB.prepare('SELECT id FROM patients WHERE id=?').bind(patientId).first<any>()
    if(!patient)return json({ok:false,message:'Paciente não encontrado.'},404)
    const id=crypto.randomUUID()
    await env.DB.prepare('INSERT INTO clinical_notes(id,patient_id,appointment_id,author_admin_id,session_date,note_text,note_ciphertext,note_iv,wrapped_dek,wrap_iv,encryption_version) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id,patientId,appointmentId,auth.admin.id,sessionDate,'',data.note_ciphertext,data.note_iv,data.wrapped_dek,data.wrap_iv,data.encryption_version).run()
    await audit(env,auth.admin.id,'clinical_note_created',id,{patient_id:patientId,appointment_id:appointmentId,encryption_version:data.encryption_version})
    return json({ok:true,id},201)
  }

  const id=decodeURIComponent(path.split('/')[4]||'')
  const existing=await env.DB.prepare('SELECT patient_id FROM clinical_notes WHERE id=?').bind(id).first<any>()
  if(!existing)return json({ok:false,message:'Anotação não encontrada.'},404)
  await env.DB.prepare('DELETE FROM clinical_notes WHERE id=?').bind(id).run()
  await audit(env,auth.admin.id,'clinical_note_deleted',id,{patient_id:existing.patient_id})
  return json({ok:true})
}
