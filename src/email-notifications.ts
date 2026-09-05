import type { Env } from './types'

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]||c))
const dateLabel=(v:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric',timeZone:'America/Sao_Paulo'}).format(new Date(v))
const dateTimeLabel=(v:string)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(v))
const timeLabel=(v:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(v))

function subjectFor(kind:string){
  const map:Record<string,string>={
    reservation_created:'Reserva de consulta realizada',
    recurring_created:'Sua próxima consulta foi reservada',
    payment_reminder:'Lembrete de pagamento da próxima consulta',
    payment_final:'Prazo de pagamento da consulta',
    reservation_expired:'Reserva de consulta expirada',
    rescheduled:'Consulta remarcada',
    professional_cancelled:'Alteração necessária na sua consulta',
    appointment_reminder:'Lembrete da sua consulta',
  }
  return map[kind]||'Atualização sobre sua consulta'
}

async function sendResend(env:Env,to:string,subject:string,message:string,actionUrl?:string){
  if(!env.RESEND_API_KEY||!env.EMAIL_FROM)return{ok:false,error:'E-mail não configurado.'}
  const html=`<div style="font-family:Arial,sans-serif;color:#29463f;line-height:1.6;max-width:640px"><h2 style="color:#244f44">${esc(subject)}</h2><p>${esc(message).replace(/\n/g,'<br>')}</p>${actionUrl?`<p><a href="${esc(actionUrl)}" style="display:inline-block;padding:10px 16px;background:#244f44;color:#fff;text-decoration:none;border-radius:8px">Acessar Portal do Paciente</a></p>`:''}<p style="font-size:12px;color:#667">Esta é uma mensagem automática com informações operacionais sobre seu atendimento.</p></div>`
  try{
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({from:env.EMAIL_FROM,to:[to],subject,html})})
    if(!r.ok)return{ok:false,error:(await r.text().catch(()=>String(r.status))).slice(0,500)}
    return{ok:true,error:''}
  }catch(error){return{ok:false,error:error instanceof Error?error.message:String(error)}}
}

async function deliver(env:Env,patientId:number,appointmentId:number|null,kind:string,message:string,dedupeKey:string,payload:Record<string,unknown>={}){
  const patient=await env.DB.prepare(`SELECT email FROM patients WHERE id=?`).bind(patientId).first<any>()
  if(!patient?.email)return false
  const id=crypto.randomUUID(),key=`${dedupeKey}:email`
  const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO patient_notifications(id,patient_id,appointment_id,kind,channel,status,message,payload_json,dedupe_key) VALUES(?,?,?,?,?,'sending',?,?,?)`).bind(id,patientId,appointmentId,kind,'email',message,JSON.stringify(payload),key).run()
  if(!Number(inserted.meta.changes||0))return false
  const result=await sendResend(env,String(patient.email),subjectFor(kind),message,String(payload.action_url||'' )||undefined)
  if(result.ok){await env.DB.prepare(`UPDATE patient_notifications SET status='sent',sent_at=CURRENT_TIMESTAMP,error_message=NULL WHERE id=?`).bind(id).run();return true}
  await env.DB.prepare(`UPDATE patient_notifications SET status='failed',error_message=? WHERE id=?`).bind(result.error,id).run()
  return false
}

export async function sendReservationCreatedEmail(env:Env,appointmentId:number){
  const row=await env.DB.prepare(`SELECT a.id,a.patient_id,a.reserved_until,a.payment_deadline_at,a.reservation_kind,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.id=?`).bind(appointmentId).first<any>()
  if(!row)return false
  const deadline=row.payment_deadline_at||row.reserved_until
  const message=row.reservation_kind==='recurring'
    ?`Sua próxima consulta está reservada para ${dateLabel(row.starts_at)} às ${timeLabel(row.starts_at)}.${deadline?` O pagamento deve ser realizado até ${dateTimeLabel(deadline)}.`:''}`
    :`Sua reserva foi realizada para ${dateLabel(row.starts_at)} às ${timeLabel(row.starts_at)}.${deadline?` Conclua o pagamento até ${dateTimeLabel(deadline)} para confirmar o horário.`:''}`
  return deliver(env,Number(row.patient_id),appointmentId,row.reservation_kind==='recurring'?'recurring_created':'reservation_created',message,`${row.reservation_kind==='recurring'?'recurring':'reservation'}:${appointmentId}`,{action_url:`${env.APP_ORIGIN||''}/paciente`})
}

async function mirrorInternalNotifications(env:Env){
  const rows=await env.DB.prepare(`SELECT n.id,n.patient_id,n.appointment_id,n.kind,n.message FROM patient_notifications n WHERE n.channel='internal' AND n.kind IN ('payment_reminder','payment_final','reservation_expired','rescheduled','professional_cancelled') ORDER BY n.created_at DESC LIMIT 100`).all<any>()
  for(const row of rows.results||[])await deliver(env,Number(row.patient_id),row.appointment_id==null?null:Number(row.appointment_id),String(row.kind),String(row.message),`internal:${row.id}`,{action_url:`${env.APP_ORIGIN||''}/paciente`})
}

async function recurringCreated(env:Env){
  const rows=await env.DB.prepare(`SELECT id FROM appointments WHERE reservation_kind='recurring' AND status='pending_payment' AND workflow_state='recurring_reserved' AND created_at>=datetime('now','-14 days') ORDER BY created_at DESC LIMIT 100`).all<any>()
  for(const row of rows.results||[])await sendReservationCreatedEmail(env,Number(row.id))
}

async function appointmentReminders(env:Env){
  const now=Date.now(),from=new Date(now+23.5*3600000).toISOString(),to=new Date(now+24.5*3600000).toISOString()
  const rows=await env.DB.prepare(`SELECT a.id,a.patient_id,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.status='confirmed' AND av.starts_at>=? AND av.starts_at<?`).bind(from,to).all<any>()
  for(const row of rows.results||[]){const message=`Lembrete: sua consulta está confirmada para ${dateLabel(row.starts_at)} às ${timeLabel(row.starts_at)}.`;await deliver(env,Number(row.patient_id),Number(row.id),'appointment_reminder',message,`appt24:${row.id}`,{action_url:`${env.APP_ORIGIN||''}/paciente`})}
}

async function retryFailed(env:Env){
  if(!env.RESEND_API_KEY||!env.EMAIL_FROM)return
  const rows=await env.DB.prepare(`SELECT n.id,n.patient_id,n.appointment_id,n.kind,n.message,n.payload_json,p.email FROM patient_notifications n JOIN patients p ON p.id=n.patient_id WHERE n.channel='email' AND n.status='failed' AND n.created_at>=datetime('now','-2 days') ORDER BY n.created_at LIMIT 20`).all<any>()
  for(const row of rows.results||[]){const payload=JSON.parse(row.payload_json||'{}');const result=await sendResend(env,row.email,subjectFor(row.kind),row.message,payload.action_url);if(result.ok)await env.DB.prepare(`UPDATE patient_notifications SET status='sent',sent_at=CURRENT_TIMESTAMP,error_message=NULL WHERE id=?`).bind(row.id).run()}
}

export async function runEmailNotificationTasks(env:Env){
  await recurringCreated(env)
  await mirrorInternalNotifications(env)
  await appointmentReminders(env)
  await retryFailed(env)
}
