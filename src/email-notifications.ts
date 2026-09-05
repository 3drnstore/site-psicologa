import type { Env } from './types'

const TZ='America/Sao_Paulo'
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]||c))
const dateLabel=(v:string)=>new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric',timeZone:TZ}).format(new Date(v))
const dateTimeLabel=(v:string)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:TZ}).format(new Date(v))
const timeLabel=(v:string)=>new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:TZ}).format(new Date(v))
const MAX_EMAIL_ATTEMPTS=4

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

function nextRetryAt(attemptCount:number){
  const delaysMinutes=[15,60,360]
  const delay=delaysMinutes[Math.min(Math.max(attemptCount-1,0),delaysMinutes.length-1)]
  return new Date(Date.now()+delay*60000).toISOString()
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
  const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO patient_notifications(id,patient_id,appointment_id,kind,channel,status,message,payload_json,dedupe_key,retry_count,last_attempt_at) VALUES(?,?,?,?,?,'sending',?,?,?,?,CURRENT_TIMESTAMP)`).bind(id,patientId,appointmentId,kind,'email',message,JSON.stringify(payload),key,1).run()
  if(!Number(inserted.meta.changes||0))return false
  const result=await sendResend(env,String(patient.email),subjectFor(kind),message,String(payload.action_url||'')||undefined)
  if(result.ok){await env.DB.prepare(`UPDATE patient_notifications SET status='sent',sent_at=CURRENT_TIMESTAMP,error_message=NULL,next_retry_at=NULL WHERE id=?`).bind(id).run();return true}
  await env.DB.prepare(`UPDATE patient_notifications SET status='failed',error_message=?,next_retry_at=? WHERE id=?`).bind(result.error,nextRetryAt(1),id).run()
  return false
}

async function notificationAlreadyExists(env:Env,appointmentId:number,kind:string){
  const row=await env.DB.prepare(`SELECT id FROM patient_notifications WHERE appointment_id=? AND kind=? AND channel IN ('internal','email') LIMIT 1`).bind(appointmentId,kind).first<any>()
  return Boolean(row?.id)
}

export async function sendPatientEventEmail(env:Env,patientId:number,appointmentId:number|null,kind:string,message:string,dedupeKey:string){
  return deliver(env,patientId,appointmentId,kind,message,dedupeKey,{action_url:`${env.APP_ORIGIN||''}/paciente`})
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
  const rows=await env.DB.prepare(`SELECT id FROM appointments WHERE reservation_kind='recurring' AND status='pending_payment' AND workflow_state='recurring_reserved' AND created_at>=datetime('now','-30 days') ORDER BY created_at DESC LIMIT 200`).all<any>()
  for(const row of rows.results||[])await sendReservationCreatedEmail(env,Number(row.id))
}

async function reliableRecurringPaymentReminders(env:Env){
  const now=Date.now(),lower=new Date(now).toISOString(),upper=new Date(now+72*3600000).toISOString()
  const rows=await env.DB.prepare(`SELECT a.id,a.patient_id,a.payment_deadline_at,a.reserved_until,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.status='pending_payment' AND a.reservation_kind='recurring' AND av.starts_at>? AND av.starts_at<=? ORDER BY av.starts_at`).bind(lower,upper).all<any>()
  for(const row of rows.results||[]){
    const deadlineRaw=row.payment_deadline_at||row.reserved_until
    if(!deadlineRaw||new Date(deadlineRaw).getTime()<=now)continue
    const hours=(new Date(row.starts_at).getTime()-now)/3600000
    if(hours<=72&&hours>48){
      if(await notificationAlreadyExists(env,Number(row.id),'payment_reminder'))continue
      const deadline=dateTimeLabel(deadlineRaw)
      const message=`Sua próxima sessão está reservada para ${dateLabel(row.starts_at)} às ${timeLabel(row.starts_at)}. Confirme o pagamento até ${deadline}.`
      await deliver(env,Number(row.patient_id),Number(row.id),'payment_reminder',message,`auto-pay72:${row.id}`,{action_url:`${env.APP_ORIGIN||''}/paciente`})
    }
  }
}

async function reliableAppointmentReminders(env:Env){
  const now=Date.now(),from=new Date(now+30*60000).toISOString(),to=new Date(now+24*3600000).toISOString()
  const rows=await env.DB.prepare(`SELECT a.id,a.patient_id,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.status='confirmed' AND av.starts_at>=? AND av.starts_at<=? ORDER BY av.starts_at`).bind(from,to).all<any>()
  for(const row of rows.results||[]){
    if(await notificationAlreadyExists(env,Number(row.id),'appointment_reminder'))continue
    const message=`Lembrete: sua consulta está confirmada para ${dateLabel(row.starts_at)} às ${timeLabel(row.starts_at)}.`
    await deliver(env,Number(row.patient_id),Number(row.id),'appointment_reminder',message,`appt24:${row.id}`,{action_url:`${env.APP_ORIGIN||''}/paciente`})
  }
}

async function expiredRecurringBackfill(env:Env){
  const rows=await env.DB.prepare(`SELECT a.id,a.patient_id,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.status IN ('expired','cancelled') AND a.reservation_kind='recurring' AND a.updated_at>=datetime('now','-7 days') ORDER BY a.updated_at DESC LIMIT 100`).all<any>()
  for(const row of rows.results||[]){
    if(await notificationAlreadyExists(env,Number(row.id),'reservation_expired'))continue
    const message=`Sua reserva recorrente para ${dateLabel(row.starts_at)} às ${timeLabel(row.starts_at)} foi cancelada porque o pagamento não foi realizado no prazo e o horário foi liberado.`
    await deliver(env,Number(row.patient_id),Number(row.id),'reservation_expired',message,`expired-backfill:${row.id}`,{action_url:`${env.APP_ORIGIN||''}/paciente`})
  }
}

async function retryFailed(env:Env){
  if(!env.RESEND_API_KEY||!env.EMAIL_FROM)return
  const rows=await env.DB.prepare(`SELECT n.id,n.patient_id,n.appointment_id,n.kind,n.message,n.payload_json,n.retry_count,p.email FROM patient_notifications n JOIN patients p ON p.id=n.patient_id WHERE n.channel='email' AND n.status='failed' AND COALESCE(n.retry_count,0)<? AND n.created_at>=datetime('now','-2 days') AND (n.next_retry_at IS NULL OR n.next_retry_at<=CURRENT_TIMESTAMP) ORDER BY n.created_at LIMIT 20`).bind(MAX_EMAIL_ATTEMPTS).all<any>()
  for(const row of rows.results||[]){
    const payload=JSON.parse(row.payload_json||'{}')
    const attempt=Math.max(1,Number(row.retry_count||0)+1)
    await env.DB.prepare(`UPDATE patient_notifications SET status='sending',retry_count=?,last_attempt_at=CURRENT_TIMESTAMP WHERE id=?`).bind(attempt,row.id).run()
    const result=await sendResend(env,row.email,subjectFor(row.kind),row.message,payload.action_url)
    if(result.ok){await env.DB.prepare(`UPDATE patient_notifications SET status='sent',sent_at=CURRENT_TIMESTAMP,error_message=NULL,next_retry_at=NULL WHERE id=?`).bind(row.id).run();continue}
    const next=attempt<MAX_EMAIL_ATTEMPTS?nextRetryAt(attempt):null
    await env.DB.prepare(`UPDATE patient_notifications SET status='failed',error_message=?,next_retry_at=? WHERE id=?`).bind(result.error,next,row.id).run()
  }
}

export async function runEmailNotificationTasks(env:Env){
  await recurringCreated(env)
  await mirrorInternalNotifications(env)
  await reliableRecurringPaymentReminders(env)
  await expiredRecurringBackfill(env)
  await reliableAppointmentReminders(env)
  await retryFailed(env)
}
