import { readCookie, sha256 } from './auth'
import { sendPatientEventEmail, sendReservationCreatedEmail } from './email-notifications'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()
const minusHours=(v:string,h:number)=>new Date(new Date(v).getTime()-h*3600000).toISOString()
const plusDays=(v:string,d:number)=>new Date(new Date(v).getTime()+d*86400000).toISOString()
const ptDate=(v:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',weekday:'long',day:'2-digit',month:'2-digit'}).format(new Date(v))
const ptTime=(v:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(v))

async function patient(request:Request,env:Env){const token=readCookie(request,'ps_session');if(!token)return null;return env.DB.prepare(`SELECT p.* FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>? AND COALESCE(p.portal_active,1)=1`).bind(await sha256(token),nowIso()).first<any>()}
async function admin(request:Request,env:Env){const token=readCookie(request,'ps_admin_session');if(!token)return null;return env.DB.prepare(`SELECT a.* FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),nowIso()).first<any>()}

async function googleToken(env:Env){if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_REFRESH_TOKEN)return null;const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})});if(!r.ok)return null;return((await r.json())as any).access_token||null}

async function syncCalendarEvent(env:Env,appointmentId:number){
  const row=await env.DB.prepare(`SELECT a.google_calendar_event_id,av.starts_at,av.ends_at,p.full_name,p.email,p.phone FROM appointments a JOIN availability av ON av.id=a.availability_id JOIN patients p ON p.id=a.patient_id WHERE a.id=?`).bind(appointmentId).first<any>();if(!row)return
  const token=await googleToken(env);if(!token){await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='pending' WHERE id=?`).bind(appointmentId).run();return}
  const calendar=encodeURIComponent(env.GOOGLE_CALENDAR_ID||'primary'),payload={summary:`Sessão – ${row.full_name}`,description:`Sessão psicológica. Contato: ${row.phone||row.email}.`,start:{dateTime:row.starts_at,timeZone:'America/Sao_Paulo'},end:{dateTime:row.ends_at,timeZone:'America/Sao_Paulo'}}
  const endpoint=row.google_calendar_event_id?`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${encodeURIComponent(row.google_calendar_event_id)}`:`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`,r=await fetch(endpoint,{method:row.google_calendar_event_id?'PATCH':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(payload)});if(!r.ok)return
  const data=await r.json().catch(()=>({})) as any;await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=COALESCE(?,google_calendar_event_id),calendar_sync_state='synced',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(data.id||null,appointmentId).run()
}

export async function normalizeHourlyDeadlines(env:Env){
  const rows=await env.DB.prepare(`SELECT a.id,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.status='pending_payment' AND a.reservation_kind='recurring'`).all<any>()
  for(const row of rows.results||[]){const deadline=minusHours(String(row.starts_at),48);await env.DB.prepare(`UPDATE appointments SET reserved_until=?,payment_deadline_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending_payment'`).bind(deadline,deadline,row.id).run()}
}

async function handleRecurrencePut(request:Request,env:Env,path:string){
  const match=path.match(/^\/api\/admin\/patients\/(\d+)\/recurrence$/);if(!match||request.method!=='PUT')return null
  const a=await admin(request,env);if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
  const patientId=Number(match[1]),data=await request.json().catch(()=>({})) as any,cadence=Number(data.cadence_days)===14?14:7,sourceId=Number(data.source_appointment_id)
  const source=await env.DB.prepare(`SELECT a.*,av.starts_at,av.ends_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.id=? AND a.patient_id=? AND a.status='confirmed'`).bind(sourceId,patientId).first<any>();if(!source)return json({ok:false,message:'Escolha uma sessão confirmada deste paciente como referência.'},409)
  const local=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(source.starts_at)),weekdayMap:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6},wd=weekdayMap[local.find(x=>x.type==='weekday')?.value||'Mon'],hh=local.find(x=>x.type==='hour')?.value||'00',mm=local.find(x=>x.type==='minute')?.value||'00',ruleId=crypto.randomUUID()
  await env.DB.prepare(`INSERT INTO patient_recurrence(id,patient_id,cadence_days,weekday,start_time,active,source_appointment_id) VALUES(?,?,?,?,?,1,?) ON CONFLICT(patient_id) DO UPDATE SET cadence_days=excluded.cadence_days,weekday=excluded.weekday,start_time=excluded.start_time,active=1,source_appointment_id=excluded.source_appointment_id,updated_at=CURRENT_TIMESTAMP`).bind(ruleId,patientId,cadence,wd,`${hh}:${mm}`,sourceId).run()
  const existing=await env.DB.prepare(`SELECT id FROM appointments WHERE recurrence_parent_appointment_id=? LIMIT 1`).bind(sourceId).first<any>();if(existing)return json({ok:true,cadence_days:cadence})
  const startsAt=plusDays(String(source.starts_at),cadence),endsAt=plusDays(String(source.ends_at),cadence);let slot=await env.DB.prepare(`SELECT * FROM availability WHERE starts_at=? AND ends_at=? LIMIT 1`).bind(startsAt,endsAt).first<any>()
  if(slot&&slot.status!=='free')return json({ok:true,cadence_days:cadence,warning:'O próximo horário recorrente já está ocupado.'})
  if(!slot){const ins=await env.DB.prepare(`INSERT INTO availability(starts_at,ends_at,status,public_visibility,source) VALUES(?,?,'held','visible','recurring_patient')`).bind(startsAt,endsAt).run();slot={id:Number(ins.meta.last_row_id)}}else{const claim=await env.DB.prepare(`UPDATE availability SET status='held',source='recurring_patient',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='free'`).bind(slot.id).run();if(!Number(claim.meta.changes||0))return json({ok:true,cadence_days:cadence,warning:'O próximo horário recorrente acabou de ser ocupado.'})}
  const deadline=minusHours(startsAt,48),inserted=await env.DB.prepare(`INSERT INTO appointments(patient_id,availability_id,status,amount_cents,reserved_until,payment_deadline_at,reservation_kind,workflow_state,recurrence_rule_id,recurrence_parent_appointment_id) VALUES(?,?,'pending_payment',?,?,?,?,?,?,?)`).bind(patientId,slot.id,source.amount_cents,deadline,deadline,'recurring','recurring_reserved',ruleId,sourceId).run(),appointmentId=Number(inserted.meta.last_row_id)
  await sendReservationCreatedEmail(env,appointmentId)
  return json({ok:true,cadence_days:cadence})
}

export async function handleHourlyPolicy(request:Request,env:Env,path:string):Promise<Response|null>{
  const recurrence=await handleRecurrencePut(request,env,path);if(recurrence)return recurrence
  const match=path.match(/^\/api\/appointments\/(\d+)\/reschedule$/)
  if(!match||request.method!=='POST')return null
  const p=await patient(request,env);if(!p)return json({ok:false,message:'Faça login para continuar.'},401)
  const id=Number(match[1]),data=await request.json().catch(()=>({})) as any
  const appt=await env.DB.prepare(`SELECT a.*,av.starts_at AS old_starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.id=? AND a.patient_id=?`).bind(id,p.id).first<any>()
  if(!appt||appt.status!=='confirmed')return json({ok:false,message:'Esta sessão não pode ser reagendada.'},409)
  if(new Date(appt.old_starts_at).getTime()-Date.now()<24*3600000)return json({ok:false,message:'O reagendamento pelo portal é permitido até 24 horas antes da sessão.'},409)
  const newSlot=await env.DB.prepare(`SELECT * FROM availability WHERE id=? AND status='free'`).bind(Number(data.slot_id)).first<any>();if(!newSlot)return json({ok:false,message:'O novo horário não está mais disponível.'},409)
  const claim=await env.DB.prepare(`UPDATE availability SET status='confirmed',public_visibility='visible',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='free'`).bind(newSlot.id).run();if(!Number(claim.meta.changes||0))return json({ok:false,message:'O novo horário acabou de ser ocupado.'},409)
  await env.DB.batch([
    env.DB.prepare(`UPDATE availability SET status='free',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(appt.availability_id),
    env.DB.prepare(`UPDATE appointments SET availability_id=?,workflow_state='normal',reschedule_reason=NULL,rescheduled_at=CURRENT_TIMESTAMP,rescheduled_by='patient',calendar_sync_state='pending',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(newSlot.id,id),
    env.DB.prepare(`INSERT INTO appointment_changes(id,appointment_id,actor_type,actor_id,change_type,old_starts_at,new_starts_at,reason) VALUES(?,?,?,?,'rescheduled',?,?,NULL)`).bind(crypto.randomUUID(),id,'patient',String(p.id),appt.old_starts_at,newSlot.starts_at),
    env.DB.prepare(`INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,metadata_json) VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),'patient',String(p.id),'appointment_rescheduled','appointment',String(id),JSON.stringify({from:appt.old_starts_at,to:newSlot.starts_at})),
  ])
  await syncCalendarEvent(env,id)
  const message=`Você remarcou sua sessão para ${ptDate(newSlot.starts_at)} às ${ptTime(newSlot.starts_at)}.`
  await env.DB.prepare(`INSERT OR IGNORE INTO patient_notifications(id,patient_id,appointment_id,kind,channel,status,message,dedupe_key) VALUES(?,?,?,?,?,'sent',?,?)`).bind(crypto.randomUUID(),p.id,id,'rescheduled','internal',message,`patient-rescheduled:${id}:${newSlot.starts_at}:internal`).run()
  await sendPatientEventEmail(env,p.id,id,'rescheduled',message,`patient-rescheduled:${id}:${newSlot.starts_at}`)
  return json({ok:true,starts_at:newSlot.starts_at})
}
