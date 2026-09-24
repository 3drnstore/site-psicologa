import { readCookie, sha256 } from './auth'
import { sendPatientEventEmail } from './email-notifications'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()
const SAO_PAULO_OFFSET='-03:00'
const TZ='America/Sao_Paulo'

async function patient(request:Request,env:Env){const token=readCookie(request,'ps_session');if(!token)return null;return env.DB.prepare(`SELECT p.* FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>? AND COALESCE(p.portal_active,1)=1`).bind(await sha256(token),nowIso()).first<any>()}
async function admin(request:Request,env:Env){const token=readCookie(request,'ps_admin_session');if(!token)return null;return env.DB.prepare(`SELECT a.* FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),nowIso()).first<any>()}
const digits=(v:unknown)=>String(v??'').replace(/\D/g,'')
const ptDate=(v:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:TZ,weekday:'long',day:'2-digit',month:'2-digit'}).format(new Date(v))
const ptTime=(v:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:TZ,hour:'2-digit',minute:'2-digit'}).format(new Date(v))
const plusDaysIso=(v:string,days:number)=>new Date(new Date(v).getTime()+days*86400000).toISOString()
function localDateParts(v:string|Date){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(v instanceof Date?v:new Date(v));return{year:Number(parts.find(p=>p.type==='year')?.value||0),month:Number(parts.find(p=>p.type==='month')?.value||0),day:Number(parts.find(p=>p.type==='day')?.value||0)}}
function localDayNumber(v:string|Date){const p=localDateParts(v);return Math.floor(Date.UTC(p.year,p.month-1,p.day)/86400000)}
const daysUntil=(v:string)=>localDayNumber(v)-localDayNumber(new Date())
function paymentDeadlineTwoDaysBefore(v:string){const p=localDateParts(v),base=new Date(Date.UTC(p.year,p.month-1,p.day));base.setUTCDate(base.getUTCDate()-2);const y=base.getUTCFullYear(),m=String(base.getUTCMonth()+1).padStart(2,'0'),d=String(base.getUTCDate()).padStart(2,'0');return new Date(`${y}-${m}-${d}T23:59:59-03:00`).toISOString()}

async function audit(env:Env,actorType:string,actorId:string|number|null,action:string,entityType:string,entityId?:string|number|null,metadata?:unknown){await env.DB.prepare(`INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,metadata_json) VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),actorType,actorId==null?null:String(actorId),action,entityType,entityId==null?null:String(entityId),metadata?JSON.stringify(metadata):null).run()}

async function googleToken(env:Env){if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_REFRESH_TOKEN)return null;const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})});if(!r.ok)return null;return((await r.json())as any).access_token||null}

async function syncCalendarEvent(env:Env,appointmentId:number,mode:'upsert'|'remove'='upsert'){
  const row=await env.DB.prepare(`SELECT a.id,a.google_calendar_event_id,av.starts_at,av.ends_at,p.full_name,p.email,p.phone FROM appointments a JOIN availability av ON av.id=a.availability_id JOIN patients p ON p.id=a.patient_id WHERE a.id=?`).bind(appointmentId).first<any>();if(!row)return false
  const token=await googleToken(env);if(!token){await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='pending' WHERE id=?`).bind(appointmentId).run();return false}
  const calendar=encodeURIComponent(env.GOOGLE_CALENDAR_ID||'primary')
  if(mode==='remove'){
    if(row.google_calendar_event_id)await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${encodeURIComponent(row.google_calendar_event_id)}`,{method:'DELETE',headers:{authorization:`Bearer ${token}`}}).catch(()=>null)
    await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=NULL,calendar_sync_state='removed',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(appointmentId).run();return true
  }
  const payload={summary:`Sessão – ${row.full_name}`,description:`Sessão psicológica. Contato: ${row.phone||row.email}.`,start:{dateTime:row.starts_at,timeZone:TZ},end:{dateTime:row.ends_at,timeZone:TZ}}
  const endpoint=row.google_calendar_event_id?`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${encodeURIComponent(row.google_calendar_event_id)}`:`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`
  const r=await fetch(endpoint,{method:row.google_calendar_event_id?'PATCH':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(payload)})
  if(!r.ok){await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='pending',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(appointmentId).run();return false}
  const data=await r.json().catch(()=>({}))as any;await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=COALESCE(?,google_calendar_event_id),calendar_sync_state='synced',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(data.id||null,appointmentId).run();return true
}

function whatsappTemplateName(env:Env,kind:string){const map:Record<string,string|undefined>={rescheduled:env.WHATSAPP_TEMPLATE_RESCHEDULED,professional_cancelled:env.WHATSAPP_TEMPLATE_CANCELLED,payment_reminder:env.WHATSAPP_TEMPLATE_PAYMENT_REMINDER,payment_final:env.WHATSAPP_TEMPLATE_PAYMENT_FINAL,reservation_expired:env.WHATSAPP_TEMPLATE_RESERVATION_EXPIRED};return map[kind]||''}
async function sendWhatsApp(env:Env,notification:any){
  if(!env.WHATSAPP_PHONE_NUMBER_ID||!env.WHATSAPP_ACCESS_TOKEN)return{ok:false,pending:true,error:'WhatsApp não configurado.'}
  const payload=JSON.parse(notification.payload_json||'{}'),template=notification.template_name||whatsappTemplateName(env,notification.kind);if(!template)return{ok:false,pending:true,error:'Template do WhatsApp não configurado.'}
  const params=(payload.parameters||[]).map((value:unknown)=>({type:'text',text:String(value??'')}));const body:any={messaging_product:'whatsapp',to:digits(notification.phone),type:'template',template:{name:template,language:{code:env.WHATSAPP_TEMPLATE_LANGUAGE||'pt_BR'}}};if(params.length)body.template.components=[{type:'body',parameters:params}]
  const version=env.WHATSAPP_API_VERSION||'v22.0',r=await fetch(`https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{authorization:`Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)return{ok:false,pending:false,error:JSON.stringify(await r.json().catch(()=>({}))).slice(0,500)};return{ok:true,pending:false,error:''}
}
async function dispatchPendingWhatsApp(env:Env,limit=25){const rows=await env.DB.prepare(`SELECT n.*,p.phone FROM patient_notifications n JOIN patients p ON p.id=n.patient_id WHERE n.channel='whatsapp' AND n.status='pending' ORDER BY n.created_at LIMIT ?`).bind(limit).all<any>();for(const row of rows.results||[]){const result=await sendWhatsApp(env,row);if(result.ok)await env.DB.prepare(`UPDATE patient_notifications SET status='sent',sent_at=CURRENT_TIMESTAMP,error_message=NULL WHERE id=?`).bind(row.id).run();else if(!result.pending)await env.DB.prepare(`UPDATE patient_notifications SET status='failed',error_message=? WHERE id=?`).bind(result.error,row.id).run()}}
async function queueNotification(env:Env,patientId:number,appointmentId:number|null,kind:string,message:string,parameters:string[],dedupeKey:string){
  const p=await env.DB.prepare(`SELECT phone FROM patients WHERE id=?`).bind(patientId).first<any>();if(!p)return
  const payload=JSON.stringify({parameters}),internalId=crypto.randomUUID()
  await env.DB.prepare(`INSERT OR IGNORE INTO patient_notifications(id,patient_id,appointment_id,kind,channel,status,message,template_name,payload_json,dedupe_key) VALUES(?,?,?,?,?,'pending',?,?,?,?)`).bind(internalId,patientId,appointmentId,kind,'internal',message,null,payload,`${dedupeKey}:internal`).run()
  await env.DB.prepare(`INSERT OR IGNORE INTO patient_notifications(id,patient_id,appointment_id,kind,channel,status,message,template_name,payload_json,dedupe_key) VALUES(?,?,?,?,?,'pending',?,?,?,?)`).bind(crypto.randomUUID(),patientId,appointmentId,kind,'whatsapp',message,whatsappTemplateName(env,kind)||null,payload,`${dedupeKey}:whatsapp`).run()
  await sendPatientEventEmail(env,patientId,appointmentId,kind,message,`internal:${internalId}`)
  await dispatchPendingWhatsApp(env,5)
}

async function moveAppointment(env:Env,appointment:any,newSlotId:number,actorType:'patient'|'admin',actorId:string|number,reason?:string){
  const oldSlot=await env.DB.prepare(`SELECT * FROM availability WHERE id=?`).bind(appointment.availability_id).first<any>(),newSlot=await env.DB.prepare(`SELECT * FROM availability WHERE id=? AND status='free'`).bind(newSlotId).first<any>();if(!newSlot)throw new Error('O novo horário não está mais disponível.')
  const claim=await env.DB.prepare(`UPDATE availability SET status='confirmed',public_visibility='visible',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='free'`).bind(newSlotId).run();if(!claim.meta.changes)throw new Error('O novo horário acabou de ser ocupado.')
  const oldMode=appointment.workflow_state==='awaiting_reschedule'?'blocked':'free'
  await env.DB.batch([env.DB.prepare(`UPDATE availability SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(oldMode,appointment.availability_id),env.DB.prepare(`UPDATE appointments SET availability_id=?,workflow_state='normal',reschedule_reason=?,rescheduled_at=CURRENT_TIMESTAMP,rescheduled_by=?,calendar_sync_state='pending',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(newSlotId,reason||null,actorType,appointment.id),env.DB.prepare(`INSERT INTO appointment_changes(id,appointment_id,actor_type,actor_id,change_type,old_starts_at,new_starts_at,reason) VALUES(?,?,?,?,'rescheduled',?,?,?)`).bind(crypto.randomUUID(),appointment.id,actorType,String(actorId),oldSlot?.starts_at||null,newSlot.starts_at,reason||null)])
  await syncCalendarEvent(env,Number(appointment.id),'upsert');await audit(env,actorType,actorId,'appointment_rescheduled','appointment',appointment.id,{from:oldSlot?.starts_at,to:newSlot.starts_at,reason});return{oldSlot,newSlot}
}

async function recurrenceDurationMinutes(env:Env){
  const row=await env.DB.prepare(`SELECT value FROM settings WHERE key='appointment_duration_minutes'`).first<any>()
  return Math.max(1,Number(row?.value||50)||50)
}
function recurrenceParts(value:string){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:TZ,weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(value))
  const weekdayMap:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}
  return{weekday:weekdayMap[parts.find(x=>x.type==='weekday')?.value||'Mon'],time:`${parts.find(x=>x.type==='hour')?.value||'00'}:${parts.find(x=>x.type==='minute')?.value||'00'}`}
}
function manualRecurrenceStart(date:string,time:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))return null
  const value=new Date(`${date}T${time}:00${SAO_PAULO_OFFSET}`)
  return Number.isNaN(value.getTime())?null:value.toISOString()
}
async function recurrenceAmountCents(env:Env,patientId:number){
  const previous=await env.DB.prepare(`SELECT a.amount_cents FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.patient_id=? AND a.status='confirmed' ORDER BY av.starts_at DESC LIMIT 1`).bind(patientId).first<any>()
  if(Number(previous?.amount_cents)>0)return Number(previous.amount_cents)
  const settings=await env.DB.prepare(`SELECT key,value FROM settings WHERE key IN ('card_price_cents','consultation_price_cents')`).all<any>()
  const map=Object.fromEntries((settings.results||[]).map((row:any)=>[row.key,row.value]))
  return Number(map.card_price_cents||map.consultation_price_cents||0)
}
async function createManualSlot(env:Env,startsAt:string,endsAt:string,status:'free'|'held'){
  const exact=await env.DB.prepare(`SELECT id,status FROM availability WHERE starts_at=? AND ends_at=? LIMIT 1`).bind(startsAt,endsAt).first<any>()
  if(exact){
    if(String(exact.status)!=='free')throw new Error('O horário informado já está ocupado ou bloqueado.')
    const changed=await env.DB.prepare(`UPDATE availability SET status=?,public_visibility='visible',source='recurring_patient',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='free'`).bind(status,exact.id).run()
    if(!Number(changed.meta.changes||0))throw new Error('O horário acabou de ser ocupado.')
    return Number(exact.id)
  }
  const overlap=await env.DB.prepare(`SELECT id,status FROM availability WHERE starts_at<? AND ends_at>? LIMIT 1`).bind(endsAt,startsAt).first<any>()
  if(overlap)throw new Error('O horário informado conflita com outro compromisso da agenda.')
  const inserted=await env.DB.prepare(`INSERT INTO availability(starts_at,ends_at,status,public_visibility,source) VALUES(?,?,?,'visible','recurring_patient')`).bind(startsAt,endsAt,status).run()
  return Number(inserted.meta.last_row_id)
}
async function reserveRecurringAt(env:Env,patientId:number,startsAt:string,ruleId:string,parentAppointmentId:number|null){
  const duration=await recurrenceDurationMinutes(env)
  const endsAt=new Date(new Date(startsAt).getTime()+duration*60000).toISOString()
  const existing=await env.DB.prepare(`SELECT a.id,a.availability_id,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.patient_id=? AND a.status='pending_payment' AND a.reservation_kind='recurring' AND av.starts_at>? ORDER BY av.starts_at LIMIT 1`).bind(patientId,nowIso()).first<any>()
  if(existing&&Math.abs(new Date(existing.starts_at).getTime()-new Date(startsAt).getTime())<60000)return Number(existing.id)
  const slotId=await createManualSlot(env,startsAt,endsAt,'held')
  const deadline=paymentDeadlineTwoDaysBefore(startsAt)
  if(existing){
    await env.DB.prepare(`UPDATE availability SET status='free',source='manual',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='held'`).bind(existing.availability_id).run()
    await env.DB.prepare(`UPDATE appointments SET availability_id=?,reserved_until=?,payment_deadline_at=?,workflow_state='recurring_reserved',recurrence_rule_id=?,recurrence_parent_appointment_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(slotId,deadline,deadline,ruleId,parentAppointmentId,existing.id).run()
    await audit(env,'system',null,'recurring_reservation_moved','appointment',existing.id,{starts_at:startsAt})
    return Number(existing.id)
  }
  const amount=await recurrenceAmountCents(env,patientId)
  const inserted=await env.DB.prepare(`INSERT INTO appointments(patient_id,availability_id,status,amount_cents,reserved_until,payment_deadline_at,reservation_kind,workflow_state,recurrence_rule_id,recurrence_parent_appointment_id) VALUES(?,?,'pending_payment',?,?,?,?,?,?,?)`).bind(patientId,slotId,amount,deadline,deadline,'recurring','recurring_reserved',ruleId,parentAppointmentId).run()
  const id=Number(inserted.meta.last_row_id)
  await audit(env,'system',null,'recurring_reservation_created','appointment',id,{starts_at:startsAt})
  return id
}

export async function ensureNextRecurringReservation(env:Env,confirmedAppointmentId:number){
  const current=await env.DB.prepare(`SELECT a.*,av.starts_at,av.ends_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.id=? AND a.status='confirmed'`).bind(confirmedAppointmentId).first<any>()
  if(!current)return null
  const rule=await env.DB.prepare(`SELECT * FROM patient_recurrence WHERE patient_id=? AND active=1`).bind(current.patient_id).first<any>()
  if(!rule)return null

  const future=await env.DB.prepare(`SELECT a.id FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.patient_id=? AND a.status IN ('pending_payment','confirmed') AND av.starts_at>? ORDER BY av.starts_at LIMIT 1`).bind(current.patient_id,nowIso()).first<any>()
  if(future)return Number(future.id)

  const days=Number(rule.cadence_days)===14?14:7
  let startsAt=plusDaysIso(current.starts_at,days)
  while(new Date(startsAt).getTime()<=Date.now())startsAt=plusDaysIso(startsAt,days)
  return reserveRecurringAt(env,Number(current.patient_id),startsAt,String(rule.id),Number(current.id))
}
export async function afterAppointmentConfirmed(env:Env,appointmentId:number){await ensureNextRecurringReservation(env,appointmentId)}

async function expireUnpaidReservations(env:Env){
  const rows=await env.DB.prepare(`SELECT a.id,a.patient_id,a.availability_id,a.reservation_kind,COALESCE(a.payment_deadline_at,a.reserved_until) AS deadline,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.status='pending_payment' AND COALESCE(a.payment_deadline_at,a.reserved_until) IS NOT NULL AND COALESCE(a.payment_deadline_at,a.reserved_until)<=?`).bind(nowIso()).all<any>()
  for(const row of rows.results||[]){
    const changed=await env.DB.prepare(`UPDATE appointments SET status='cancelled',workflow_state='payment_deadline_missed',cancellation_reason='Pagamento não realizado até o prazo',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending_payment'`).bind(row.id).run();if(!Number(changed.meta.changes||0))continue
    await env.DB.prepare(`UPDATE availability SET status='free',source='manual',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='held'`).bind(row.availability_id).run()
    await env.DB.prepare(`UPDATE payments SET status='failed',raw_status='reservation_cancelled_payment_deadline',updated_at=CURRENT_TIMESTAMP WHERE appointment_id=? AND status='pending'`).bind(row.id).run()
    await audit(env,'system',null,'reservation_cancelled_payment_deadline','appointment',row.id,{starts_at:row.starts_at,deadline:row.deadline,reservation_kind:row.reservation_kind})
    await queueNotification(env,row.patient_id,row.id,'reservation_expired',`Sua reserva para ${ptDate(row.starts_at)} às ${ptTime(row.starts_at)} foi cancelada automaticamente porque o pagamento não foi realizado até o prazo. O horário foi liberado.`,[ptDate(row.starts_at),ptTime(row.starts_at)],`payment-deadline-cancelled:${row.id}`)
  }
}
export async function runScheduledSessionTasks(env:Env){await expireUnpaidReservations(env);await dispatchPendingWhatsApp(env,50)}

export async function handleSessionManagement(request:Request,env:Env,path:string):Promise<Response|null>{

  if(path==='/api/notifications'&&request.method==='GET'){const p=await patient(request,env);if(!p)return json({ok:false,message:'Faça login para continuar.'},401);const rows=await env.DB.prepare(`SELECT id,kind,message,created_at,read_at FROM patient_notifications WHERE patient_id=? AND channel='internal' ORDER BY created_at DESC LIMIT 50`).bind(p.id).all<any>();return json({ok:true,notifications:rows.results||[]})}
  if(path==='/api/appointments/mine'&&request.method==='GET'){const p=await patient(request,env);if(!p)return json({ok:false,message:'Faça login para continuar.'},401);await expireUnpaidReservations(env);const rows=await env.DB.prepare(`SELECT a.id,a.status,a.amount_cents,a.payment_method,a.reserved_until,a.paid_at,a.workflow_state,a.reservation_kind,a.payment_deadline_at,a.rescheduled_at,a.reschedule_reason,a.cancellation_reason,av.starts_at,av.ends_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.patient_id=? ORDER BY av.starts_at DESC`).bind(p.id).all<any>();return json({ok:true,appointments:rows.results||[]})}

  const patientReschedule=path.match(/^\/api\/appointments\/(\d+)\/reschedule$/)
  if(patientReschedule&&request.method==='POST'){const p=await patient(request,env);if(!p)return json({ok:false,message:'Faça login para continuar.'},401);const id=Number(patientReschedule[1]),data=await request.json().catch(()=>({}))as any,appt=await env.DB.prepare(`SELECT a.*,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.id=? AND a.patient_id=?`).bind(id,p.id).first<any>();if(!appt||appt.status!=='confirmed')return json({ok:false,message:'Esta sessão não pode ser reagendada.'},409);if(daysUntil(appt.starts_at)<=1)return json({ok:false,message:'O reagendamento pelo portal não é permitido no dia anterior nem no dia da consulta.'},409);try{const moved=await moveAppointment(env,appt,Number(data.slot_id),'patient',p.id);await queueNotification(env,p.id,id,'rescheduled',`Você remarcou sua sessão para ${ptDate(moved.newSlot.starts_at)} às ${ptTime(moved.newSlot.starts_at)}.`,[ptDate(moved.newSlot.starts_at),ptTime(moved.newSlot.starts_at),''],`patient-rescheduled:${id}:${moved.newSlot.starts_at}`);return json({ok:true,starts_at:moved.newSlot.starts_at})}catch(e){return json({ok:false,message:e instanceof Error?e.message:'Não foi possível reagendar.'},409)}}

  if(path==='/api/admin/session-management/appointments'&&request.method==='GET'){const a=await admin(request,env);if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401);await expireUnpaidReservations(env);const rows=await env.DB.prepare(`SELECT ap.id,ap.patient_id,ap.status,ap.amount_cents,ap.paid_at,ap.workflow_state,ap.reservation_kind,ap.payment_deadline_at,ap.rescheduled_at,ap.reschedule_reason,ap.cancellation_reason,av.id AS availability_id,av.starts_at,av.ends_at,p.full_name,p.email,p.phone FROM appointments ap JOIN availability av ON av.id=ap.availability_id JOIN patients p ON p.id=ap.patient_id ORDER BY av.starts_at DESC`).all<any>();return json({ok:true,appointments:rows.results||[]})}

  const adminReschedule=path.match(/^\/api\/admin\/appointments\/(\d+)\/reschedule$/)
  if(adminReschedule&&request.method==='POST'){const a=await admin(request,env);if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401);const data=await request.json().catch(()=>({}))as any,id=Number(adminReschedule[1]),appt=await env.DB.prepare(`SELECT a.*,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.id=?`).bind(id).first<any>();if(!appt||appt.status!=='confirmed')return json({ok:false,message:'Sessão não encontrada ou não confirmada.'},404);try{const moved=await moveAppointment(env,appt,Number(data.slot_id),'admin',a.id,String(data.reason||'').trim());await queueNotification(env,appt.patient_id,id,'rescheduled',`Sua sessão foi reagendada pela profissional para ${ptDate(moved.newSlot.starts_at)} às ${ptTime(moved.newSlot.starts_at)}.${data.reason?` Motivo: ${String(data.reason).trim()}`:''}`,[ptDate(moved.newSlot.starts_at),ptTime(moved.newSlot.starts_at),String(data.reason||'')],`rescheduled:${id}:${moved.newSlot.starts_at}`);return json({ok:true})}catch(e){return json({ok:false,message:e instanceof Error?e.message:'Não foi possível reagendar.'},409)}}

  const adminCancel=path.match(/^\/api\/admin\/appointments\/(\d+)\/cancel$/)
  if(adminCancel&&request.method==='POST'){
    const a=await admin(request,env);if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
    const data=await request.json().catch(()=>({}))as any,id=Number(adminCancel[1]),reason=String(data.reason||'').trim()
    const appt=await env.DB.prepare(`SELECT a.*,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.id=?`).bind(id).first<any>()
    if(!appt||appt.status!=='confirmed')return json({ok:false,message:'Somente consultas confirmadas podem ser canceladas pelo painel.'},409)
    const changed=await env.DB.prepare(`UPDATE appointments SET status='cancelled',workflow_state='admin_cancelled',cancellation_reason=?,calendar_sync_state='pending',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='confirmed'`).bind(reason||'Cancelada pela profissional',id).run();if(!Number(changed.meta.changes||0))return json({ok:false,message:'A consulta já foi alterada por outra ação.'},409)
    await env.DB.prepare(`UPDATE availability SET status='free',source='manual',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(appt.availability_id).run()
    await env.DB.prepare(`INSERT INTO appointment_changes(id,appointment_id,actor_type,actor_id,change_type,old_starts_at,reason) VALUES(?,?,?,?,'admin_cancelled',?,?)`).bind(crypto.randomUUID(),id,'admin',String(a.id),appt.starts_at,reason||null).run()
    await syncCalendarEvent(env,id,'remove')
    await audit(env,'admin',a.id,'appointment_cancelled','appointment',id,{starts_at:appt.starts_at,reason:reason||null,paid:Boolean(appt.paid_at)})
    await queueNotification(env,appt.patient_id,id,'professional_cancelled',`Sua consulta de ${ptDate(appt.starts_at)} às ${ptTime(appt.starts_at)} foi cancelada pela profissional.${reason?` Motivo: ${reason}.`:''}`,[ptDate(appt.starts_at),ptTime(appt.starts_at),reason],`admin-cancel:${id}`)
    return json({ok:true,status:'cancelled'})
  }

  if(path==='/api/admin/agenda/cancel-day'&&request.method==='POST'){const a=await admin(request,env);if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401);const data=await request.json().catch(()=>({}))as any,date=String(data.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({ok:false,message:'Informe uma data válida.'},400);const from=new Date(`${date}T00:00:00${SAO_PAULO_OFFSET}`).toISOString(),to=new Date(`${date}T23:59:59${SAO_PAULO_OFFSET}`).toISOString(),rows=await env.DB.prepare(`SELECT ap.id,ap.patient_id,ap.availability_id,av.starts_at FROM appointments ap JOIN availability av ON av.id=ap.availability_id WHERE ap.status='confirmed' AND av.starts_at>=? AND av.starts_at<=?`).bind(from,to).all<any>(),affected=rows.results||[];await env.DB.prepare(`UPDATE availability SET status='blocked',source='professional_cancelled_day',updated_at=CURRENT_TIMESTAMP WHERE starts_at>=? AND starts_at<=?`).bind(from,to).run();for(const row of affected){await env.DB.prepare(`UPDATE appointments SET workflow_state='awaiting_reschedule',cancellation_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(String(data.reason||'').trim()||null,row.id).run();await env.DB.prepare(`INSERT INTO appointment_changes(id,appointment_id,actor_type,actor_id,change_type,old_starts_at,reason) VALUES(?,?,?,?,'professional_day_cancelled',?,?)`).bind(crypto.randomUUID(),row.id,'admin',String(a.id),row.starts_at,String(data.reason||'').trim()||null).run();await syncCalendarEvent(env,row.id,'remove');await queueNotification(env,row.patient_id,row.id,'professional_cancelled',`A agenda de ${ptDate(row.starts_at)} precisou ser cancelada pela profissional.${data.reason?` Motivo: ${String(data.reason).trim()}.`:''} Seu pagamento continua válido e entraremos em contato para reagendar.`,[ptDate(row.starts_at),ptTime(row.starts_at),String(data.reason||'')],`cancel-day:${row.id}:${date}`)}await audit(env,'admin',a.id,'agenda_day_cancelled','agenda',date,{reason:data.reason||null,affected:affected.length});return json({ok:true,affected:affected.length})}

  const recurrence=path.match(/^\/api\/admin\/patients\/(\d+)\/recurrence$/)
  if(recurrence){
    const a=await admin(request,env)
    if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
    const patientId=Number(recurrence[1])

    if(request.method==='GET'){
      const rule=await env.DB.prepare(`SELECT * FROM patient_recurrence WHERE patient_id=?`).bind(patientId).first<any>()
      return json({ok:true,recurrence:rule||null})
    }
    if(request.method==='DELETE'){
      await env.DB.prepare(`UPDATE patient_recurrence SET active=0,updated_at=CURRENT_TIMESTAMP WHERE patient_id=?`).bind(patientId).run()
      return json({ok:true})
    }
    if(request.method==='PUT'){
      const data=await request.json().catch(()=>({}))as any
      const cadence=Number(data.cadence_days)===14?14:7
      const mode=String(data.reference_mode||'session')
      const id=crypto.randomUUID()

      if(mode==='manual'){
        const startsAt=manualRecurrenceStart(String(data.manual_date||''),String(data.manual_time||''))
        if(!startsAt)return json({ok:false,message:'Informe uma data e um horário válidos.'},400)
        if(new Date(startsAt).getTime()<=Date.now())return json({ok:false,message:'A data e o horário precisam estar no futuro.'},400)

        const parts=recurrenceParts(startsAt)
        const duration=await recurrenceDurationMinutes(env)
        const endsAt=new Date(new Date(startsAt).getTime()+duration*60000).toISOString()
        const awaiting=await env.DB.prepare(`SELECT a.*,av.starts_at,av.ends_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.patient_id=? AND a.status='confirmed' AND a.workflow_state='awaiting_reschedule' ORDER BY av.starts_at LIMIT 1`).bind(patientId).first<any>()

        if(!awaiting){
          const exact=await env.DB.prepare(`SELECT id,status FROM availability WHERE starts_at=? AND ends_at=? LIMIT 1`).bind(startsAt,endsAt).first<any>()
          if(exact&&String(exact.status)!=='free')return json({ok:false,message:'O horário informado já está ocupado ou bloqueado.'},409)
          const overlap=await env.DB.prepare(`SELECT id FROM availability WHERE starts_at<? AND ends_at>? AND NOT(starts_at=? AND ends_at=?) LIMIT 1`).bind(endsAt,startsAt,startsAt,endsAt).first<any>()
          if(overlap)return json({ok:false,message:'O horário informado conflita com outro compromisso da agenda.'},409)
        }

        await env.DB.prepare(`INSERT INTO patient_recurrence(id,patient_id,cadence_days,weekday,start_time,active,source_appointment_id,manual_reference_at) VALUES(?,?,?,?,?,1,NULL,?) ON CONFLICT(patient_id) DO UPDATE SET cadence_days=excluded.cadence_days,weekday=excluded.weekday,start_time=excluded.start_time,active=1,source_appointment_id=NULL,manual_reference_at=excluded.manual_reference_at,updated_at=CURRENT_TIMESTAMP`).bind(id,patientId,cadence,parts.weekday,parts.time,startsAt).run()
        const rule=await env.DB.prepare(`SELECT id FROM patient_recurrence WHERE patient_id=?`).bind(patientId).first<any>()
        const ruleId=String(rule?.id||id)

        if(awaiting){
          if(Math.abs(new Date(awaiting.starts_at).getTime()-new Date(startsAt).getTime())>=60000){
            const targetSlotId=await createManualSlot(env,startsAt,endsAt,'free')
            const moved=await moveAppointment(env,awaiting,targetSlotId,'admin',a.id,'Reagendamento definido manualmente na recorrência')
            await queueNotification(env,patientId,Number(awaiting.id),'rescheduled',`Sua sessão foi reagendada pela profissional para ${ptDate(moved.newSlot.starts_at)} às ${ptTime(moved.newSlot.starts_at)}.`,[ptDate(moved.newSlot.starts_at),ptTime(moved.newSlot.starts_at),''],`recurrence-manual-reschedule:${awaiting.id}:${moved.newSlot.starts_at}`)
          }
          await audit(env,'admin',a.id,'recurrence_manual_reschedule','patient',patientId,{starts_at:startsAt,cadence_days:cadence})
          return json({ok:true,cadence_days:cadence,action:'rescheduled'})
        }

        await reserveRecurringAt(env,patientId,startsAt,ruleId,null)
        await audit(env,'admin',a.id,'recurrence_manual_set','patient',patientId,{starts_at:startsAt,cadence_days:cadence})
        return json({ok:true,cadence_days:cadence,action:'reserved'})
      }

      const sourceId=Number(data.source_appointment_id)
      const source=await env.DB.prepare(`SELECT a.id,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.id=? AND a.patient_id=? AND a.status='confirmed'`).bind(sourceId,patientId).first<any>()
      if(!source)return json({ok:false,message:'Escolha uma sessão confirmada deste paciente como referência.'},409)
      const parts=recurrenceParts(source.starts_at)
      await env.DB.prepare(`INSERT INTO patient_recurrence(id,patient_id,cadence_days,weekday,start_time,active,source_appointment_id,manual_reference_at) VALUES(?,?,?,?,?,1,?,NULL) ON CONFLICT(patient_id) DO UPDATE SET cadence_days=excluded.cadence_days,weekday=excluded.weekday,start_time=excluded.start_time,active=1,source_appointment_id=excluded.source_appointment_id,manual_reference_at=NULL,updated_at=CURRENT_TIMESTAMP`).bind(id,patientId,cadence,parts.weekday,parts.time,sourceId).run()
      await ensureNextRecurringReservation(env,sourceId)
      await audit(env,'admin',a.id,'recurrence_session_reference_set','patient',patientId,{source_appointment_id:sourceId,cadence_days:cadence})
      return json({ok:true,cadence_days:cadence,action:'reference'})
    }
  }

  return null
}
