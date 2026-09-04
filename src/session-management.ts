import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()
const SAO_PAULO_OFFSET='-03:00'

async function patient(request:Request,env:Env){
  const token=readCookie(request,'ps_session');if(!token)return null
  return env.DB.prepare(`SELECT p.* FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>? AND COALESCE(p.portal_active,1)=1`)
    .bind(await sha256(token),nowIso()).first<any>()
}
async function admin(request:Request,env:Env){
  const token=readCookie(request,'ps_admin_session');if(!token)return null
  return env.DB.prepare(`SELECT a.* FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`)
    .bind(await sha256(token),nowIso()).first<any>()
}
const digits=(v:unknown)=>String(v??'').replace(/\D/g,'')
const ptDate=(v:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',weekday:'long',day:'2-digit',month:'2-digit'}).format(new Date(v))
const ptTime=(v:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(v))
const plusDaysIso=(v:string,days:number)=>new Date(new Date(v).getTime()+days*86400000).toISOString()
const minusHoursIso=(v:string,hours:number)=>new Date(new Date(v).getTime()-hours*3600000).toISOString()

async function audit(env:Env,actorType:string,actorId:string|number|null,action:string,entityType:string,entityId?:string|number|null,metadata?:unknown){
  await env.DB.prepare(`INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,metadata_json) VALUES(?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(),actorType,actorId==null?null:String(actorId),action,entityType,entityId==null?null:String(entityId),metadata?JSON.stringify(metadata):null).run()
}

async function googleToken(env:Env){
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_REFRESH_TOKEN)return null
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})})
  if(!r.ok)return null
  return ((await r.json()) as any).access_token||null
}

async function syncCalendarEvent(env:Env,appointmentId:number,mode:'upsert'|'remove'='upsert'){
  const row=await env.DB.prepare(`SELECT a.id,a.google_calendar_event_id,av.starts_at,av.ends_at,p.full_name,p.email,p.phone FROM appointments a JOIN availability av ON av.id=a.availability_id JOIN patients p ON p.id=a.patient_id WHERE a.id=?`).bind(appointmentId).first<any>()
  if(!row)return false
  const token=await googleToken(env);if(!token)return false
  const calendar=encodeURIComponent(env.GOOGLE_CALENDAR_ID||'primary')
  if(mode==='remove'){
    if(row.google_calendar_event_id){
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${encodeURIComponent(row.google_calendar_event_id)}`,{method:'DELETE',headers:{authorization:`Bearer ${token}`}}).catch(()=>null)
      await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=NULL,calendar_sync_state='removed',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(appointmentId).run()
    }
    return true
  }
  const payload={summary:`Sessão – ${row.full_name}`,description:`Sessão psicológica. Contato: ${row.phone||row.email}.`,start:{dateTime:row.starts_at,timeZone:'America/Sao_Paulo'},end:{dateTime:row.ends_at,timeZone:'America/Sao_Paulo'}}
  let r:Response
  if(row.google_calendar_event_id){
    r=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${encodeURIComponent(row.google_calendar_event_id)}`,{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(payload)})
  }else{
    r=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(payload)})
  }
  if(!r.ok){await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='pending',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(appointmentId).run();return false}
  const data=await r.json().catch(()=>({})) as any
  await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=COALESCE(?,google_calendar_event_id),calendar_sync_state='synced',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(data.id||null,appointmentId).run()
  return true
}

function whatsappTemplateName(env:Env,kind:string){
  const map:Record<string,string|undefined>={
    rescheduled:env.WHATSAPP_TEMPLATE_RESCHEDULED,
    professional_cancelled:env.WHATSAPP_TEMPLATE_CANCELLED,
    payment_reminder:env.WHATSAPP_TEMPLATE_PAYMENT_REMINDER,
    payment_final:env.WHATSAPP_TEMPLATE_PAYMENT_FINAL,
    reservation_expired:env.WHATSAPP_TEMPLATE_RESERVATION_EXPIRED,
  }
  return map[kind]||''
}

async function sendWhatsApp(env:Env,notification:any){
  if(!env.WHATSAPP_PHONE_NUMBER_ID||!env.WHATSAPP_ACCESS_TOKEN)return {ok:false,pending:true,error:'WhatsApp não configurado.'}
  const payload=JSON.parse(notification.payload_json||'{}')
  const template=notification.template_name||whatsappTemplateName(env,notification.kind)
  if(!template)return {ok:false,pending:true,error:'Template do WhatsApp não configurado.'}
  const values=(payload.parameters||[]).map((value:unknown)=>({type:'text',text:String(value??'')}))
  const body:any={messaging_product:'whatsapp',to:digits(notification.phone),type:'template',template:{name:template,language:{code:env.WHATSAPP_TEMPLATE_LANGUAGE||'pt_BR'}}}
  if(values.length)body.template.components=[{type:'body',parameters:values}]
  const version=env.WHATSAPP_API_VERSION||'v22.0'
  const r=await fetch(`https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{authorization:`Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(body)})
  if(!r.ok)return {ok:false,pending:false,error:JSON.stringify(await r.json().catch(()=>({}))).slice(0,500)}
  return {ok:true,pending:false,error:''}
}

async function queueNotification(env:Env,patientId:number,appointmentId:number|null,kind:string,message:string,parameters:string[],dedupeKey:string){
  const p=await env.DB.prepare(`SELECT full_name,phone FROM patients WHERE id=?`).bind(patientId).first<any>();if(!p)return
  await env.DB.prepare(`INSERT OR IGNORE INTO patient_notifications(id,patient_id,appointment_id,kind,channel,status,message,template_name,payload_json,dedupe_key) VALUES(?,?,?,?,?,'pending',?,?,?,?,?)`)
    .bind(crypto.randomUUID(),patientId,appointmentId,kind,'internal',message,null,JSON.stringify({parameters}),`${dedupeKey}:internal`).run()
  await env.DB.prepare(`INSERT OR IGNORE INTO patient_notifications(id,patient_id,appointment_id,kind,channel,status,message,template_name,payload_json,dedupe_key) VALUES(?,?,?,?,?,'pending',?,?,?,?,?)`)
    .bind(crypto.randomUUID(),patientId,appointmentId,kind,'whatsapp',message,whatsappTemplateName(env,kind)||null,JSON.stringify({parameters}),`${dedupeKey}:whatsapp`).run()
  await dispatchPendingWhatsApp(env,5)
}

async function dispatchPendingWhatsApp(env:Env,limit=25){
  const rows=await env.DB.prepare(`SELECT n.*,p.phone FROM patient_notifications n JOIN patients p ON p.id=n.patient_id WHERE n.channel='whatsapp' AND n.status='pending' ORDER BY n.created_at LIMIT ?`).bind(limit).all<any>()
  for(const row of rows.results||[]){
    const result=await sendWhatsApp(env,row)
    if(result.ok)await env.DB.prepare(`UPDATE patient_notifications SET status='sent',sent_at=CURRENT_TIMESTAMP,error_message=NULL WHERE id=?`).bind(row.id).run()
    else if(!result.pending)await env.DB.prepare(`UPDATE patient_notifications SET status='failed',error_message=? WHERE id=?`).bind(result.error,row.id).run()
  }
}

async function moveAppointment(env:Env,appointment:any,newSlotId:number,actorType:'patient'|'admin',actorId:string|number,reason?:string){
  const oldSlot=await env.DB.prepare(`SELECT * FROM availability WHERE id=?`).bind(appointment.availability_id).first<any>()
  const newSlot=await env.DB.prepare(`SELECT * FROM availability WHERE id=? AND status='free'`).bind(newSlotId).first<any>()
  if(!newSlot)throw new Error('O novo horário não está mais disponível.')
  const claim=await env.DB.prepare(`UPDATE availability SET status='confirmed',public_visibility='visible',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='free'`).bind(newSlotId).run()
  if(!claim.meta.changes)throw new Error('O novo horário acabou de ser ocupado.')
  const oldMode=appointment.workflow_state==='awaiting_reschedule'?'blocked':'free'
  await env.DB.batch([
    env.DB.prepare(`UPDATE availability SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(oldMode,appointment.availability_id),
    env.DB.prepare(`UPDATE appointments SET availability_id=?,workflow_state='normal',reschedule_reason=?,rescheduled_at=CURRENT_TIMESTAMP,rescheduled_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(newSlotId,reason||null,actorType,appointment.id),
    env.DB.prepare(`INSERT INTO appointment_changes(id,appointment_id,actor_type,actor_id,change_type,old_starts_at,new_starts_at,reason) VALUES(?,?,?,?, 'rescheduled',?,?,?)`).bind(crypto.randomUUID(),appointment.id,actorType,String(actorId),oldSlot?.starts_at||null,newSlot.starts_at,reason||null),
  ])
  await syncCalendarEvent(env,Number(appointment.id),'upsert')
  await audit(env,actorType,actorId,'appointment_rescheduled','appointment',appointment.id,{from:oldSlot?.starts_at,to:newSlot.starts_at,reason})
  return {oldSlot,newSlot}
}

export async function ensureNextRecurringReservation(env:Env,confirmedAppointmentId:number){
  const current=await env.DB.prepare(`SELECT a.*,av.starts_at,av.ends_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.id=? AND a.status='confirmed'`).bind(confirmedAppointmentId).first<any>()
  if(!current)return null
  const rule=await env.DB.prepare(`SELECT * FROM patient_recurrence WHERE patient_id=? AND active=1`).bind(current.patient_id).first<any>()
  if(!rule)return null
  const existing=await env.DB.prepare(`SELECT id FROM appointments WHERE recurrence_parent_appointment_id=? LIMIT 1`).bind(confirmedAppointmentId).first<any>()
  if(existing)return existing.id
  const days=Number(rule.cadence_days)===14?14:7
  const startsAt=plusDaysIso(current.starts_at,days),endsAt=plusDaysIso(current.ends_at,days)
  let slot=await env.DB.prepare(`SELECT * FROM availability WHERE starts_at=? AND ends_at=? LIMIT 1`).bind(startsAt,endsAt).first<any>()
  if(slot&&slot.status!=='free'){await audit(env,'system',null,'recurrence_conflict','patient',current.patient_id,{starts_at:startsAt});return null}
  if(!slot){
    const inserted=await env.DB.prepare(`INSERT INTO availability(starts_at,ends_at,status,public_visibility,source) VALUES(?,?,'held','visible','recurring_patient')`).bind(startsAt,endsAt).run()
    slot={id:Number(inserted.meta.last_row_id),starts_at:startsAt,ends_at:endsAt,status:'held'}
  }else{
    const claim=await env.DB.prepare(`UPDATE availability SET status='held',source='recurring_patient',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='free'`).bind(slot.id).run();if(!claim.meta.changes)return null
  }
  const deadline=minusHoursIso(startsAt,48)
  const inserted=await env.DB.prepare(`INSERT INTO appointments(patient_id,availability_id,status,amount_cents,reserved_until,payment_deadline_at,reservation_kind,workflow_state,recurrence_rule_id,recurrence_parent_appointment_id) VALUES(?,?,'pending_payment',?,?,?,?,?,?,?)`)
    .bind(current.patient_id,slot.id,current.amount_cents,deadline,deadline,'recurring','recurring_reserved',rule.id,confirmedAppointmentId).run()
  const id=Number(inserted.meta.last_row_id)
  await audit(env,'system',null,'recurring_reservation_created','appointment',id,{starts_at:startsAt,deadline})
  return id
}

export async function afterAppointmentConfirmed(env:Env,appointmentId:number){
  await ensureNextRecurringReservation(env,appointmentId)
}

async function expireRecurring(env:Env){
  const rows=await env.DB.prepare(`SELECT a.id,a.patient_id,a.availability_id,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.status='pending_payment' AND a.reservation_kind='recurring' AND a.reserved_until IS NOT NULL AND a.reserved_until<=?`).bind(nowIso()).all<any>()
  for(const row of rows.results||[]){
    await env.DB.batch([
      env.DB.prepare(`UPDATE appointments SET status='expired',workflow_state='expired',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending_payment'`).bind(row.id),
      env.DB.prepare(`UPDATE availability SET status='free',source='manual',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='held'`).bind(row.availability_id),
    ])
    await queueNotification(env,row.patient_id,row.id,'reservation_expired',`Sua reserva recorrente para ${ptDate(row.starts_at)} às ${ptTime(row.starts_at)} expirou e o horário foi liberado.`,[ptDate(row.starts_at),ptTime(row.starts_at)],`expired:${row.id}`)
  }
}

async function recurringReminders(env:Env){
  const now=Date.now()
  const rows=await env.DB.prepare(`SELECT a.id,a.patient_id,a.reserved_until,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.status='pending_payment' AND a.reservation_kind='recurring' AND av.starts_at>? AND av.starts_at<?`).bind(new Date(now+47*3600000).toISOString(),new Date(now+73*3600000).toISOString()).all<any>()
  const origin=env.APP_ORIGIN||''
  for(const row of rows.results||[]){
    const hours=(new Date(row.starts_at).getTime()-now)/3600000
    const deadline=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(row.reserved_until))
    if(hours<=72&&hours>71.5){
      await queueNotification(env,row.patient_id,row.id,'payment_reminder',`Sua próxima sessão está reservada para ${ptDate(row.starts_at)} às ${ptTime(row.starts_at)}. Confirme o pagamento até ${deadline}.`,[ptDate(row.starts_at),ptTime(row.starts_at),deadline,`${origin}/paciente`],`pay72:${row.id}`)
    }
    if(hours<=50&&hours>49.5){
      await queueNotification(env,row.patient_id,row.id,'payment_final',`Último lembrete: confirme sua sessão de ${ptDate(row.starts_at)} às ${ptTime(row.starts_at)} até ${deadline}.`,[ptDate(row.starts_at),ptTime(row.starts_at),deadline,`${origin}/paciente`],`pay50:${row.id}`)
    }
  }
}

export async function runScheduledSessionTasks(env:Env){
  await expireRecurring(env)
  await recurringReminders(env)
  await dispatchPendingWhatsApp(env,50)
}

export async function handleSessionManagement(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path==='/api/notifications'&&request.method==='GET'){
    const p=await patient(request,env);if(!p)return json({ok:false,message:'Faça login para continuar.'},401)
    const rows=await env.DB.prepare(`SELECT id,kind,message,created_at,read_at FROM patient_notifications WHERE patient_id=? AND channel='internal' ORDER BY created_at DESC LIMIT 50`).bind(p.id).all<any>()
    return json({ok:true,notifications:rows.results||[]})
  }

  if(path==='/api/appointments/mine'&&request.method==='GET'){
    const p=await patient(request,env);if(!p)return json({ok:false,message:'Faça login para continuar.'},401)
    await expireRecurring(env)
    const rows=await env.DB.prepare(`SELECT a.id,a.status,a.amount_cents,a.payment_method,a.reserved_until,a.paid_at,a.workflow_state,a.reservation_kind,a.payment_deadline_at,a.rescheduled_at,a.reschedule_reason,av.starts_at,av.ends_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.patient_id=? ORDER BY av.starts_at DESC`).bind(p.id).all<any>()
    return json({ok:true,appointments:rows.results||[]})
  }

  const patientReschedule=path.match(/^\/api\/appointments\/(\d+)\/reschedule$/)
  if(patientReschedule&&request.method==='POST'){
    const p=await patient(request,env);if(!p)return json({ok:false,message:'Faça login para continuar.'},401)
    const id=Number(patientReschedule[1]);const data=await request.json().catch(()=>({})) as any
    const appt=await env.DB.prepare(`SELECT a.*,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.id=? AND a.patient_id=?`).bind(id,p.id).first<any>()
    if(!appt||appt.status!=='confirmed')return json({ok:false,message:'Esta sessão não pode ser reagendada.'},409)
    if(new Date(appt.starts_at).getTime()-Date.now()<24*3600000)return json({ok:false,message:'O reagendamento pelo portal é permitido até 24 horas antes da sessão.'},409)
    try{const moved=await moveAppointment(env,appt,Number(data.slot_id),'patient',p.id);return json({ok:true,starts_at:moved.newSlot.starts_at})}catch(e){return json({ok:false,message:e instanceof Error?e.message:'Não foi possível reagendar.'},409)}
  }

  if(path==='/api/admin/session-management/appointments'&&request.method==='GET'){
    const a=await admin(request,env);if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
    const rows=await env.DB.prepare(`SELECT ap.id,ap.patient_id,ap.status,ap.amount_cents,ap.workflow_state,ap.reservation_kind,ap.payment_deadline_at,ap.rescheduled_at,ap.reschedule_reason,av.starts_at,av.ends_at,p.full_name,p.email,p.phone FROM appointments ap JOIN availability av ON av.id=ap.availability_id JOIN patients p ON p.id=ap.patient_id ORDER BY av.starts_at DESC`).all<any>()
    return json({ok:true,appointments:rows.results||[]})
  }

  const adminReschedule=path.match(/^\/api\/admin\/appointments\/(\d+)\/reschedule$/)
  if(adminReschedule&&request.method==='POST'){
    const a=await admin(request,env);if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
    const data=await request.json().catch(()=>({})) as any;const id=Number(adminReschedule[1])
    const appt=await env.DB.prepare(`SELECT a.*,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.id=?`).bind(id).first<any>()
    if(!appt||appt.status!=='confirmed')return json({ok:false,message:'Sessão não encontrada ou não confirmada.'},404)
    try{
      const moved=await moveAppointment(env,appt,Number(data.slot_id),'admin',a.id,String(data.reason||'').trim())
      await queueNotification(env,appt.patient_id,id,'rescheduled',`Sua sessão foi reagendada pela profissional para ${ptDate(moved.newSlot.starts_at)} às ${ptTime(moved.newSlot.starts_at)}.${data.reason?` Motivo: ${String(data.reason).trim()}`:''}`,[ptDate(moved.newSlot.starts_at),ptTime(moved.newSlot.starts_at),String(data.reason||'')],`rescheduled:${id}:${moved.newSlot.starts_at}`)
      return json({ok:true})
    }catch(e){return json({ok:false,message:e instanceof Error?e.message:'Não foi possível reagendar.'},409)}
  }

  if(path==='/api/admin/agenda/cancel-day'&&request.method==='POST'){
    const a=await admin(request,env);if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
    const data=await request.json().catch(()=>({})) as any;const date=String(data.date||'')
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({ok:false,message:'Informe uma data válida.'},400)
    const from=new Date(`${date}T00:00:00${SAO_PAULO_OFFSET}`).toISOString(),to=new Date(`${date}T23:59:59${SAO_PAULO_OFFSET}`).toISOString()
    const rows=await env.DB.prepare(`SELECT ap.id,ap.patient_id,ap.availability_id,av.starts_at FROM appointments ap JOIN availability av ON av.id=ap.availability_id WHERE ap.status='confirmed' AND av.starts_at>=? AND av.starts_at<=?`).bind(from,to).all<any>()
    const affected=rows.results||[]
    await env.DB.prepare(`UPDATE availability SET status='blocked',source='professional_cancelled_day',updated_at=CURRENT_TIMESTAMP WHERE starts_at>=? AND starts_at<=?`).bind(from,to).run()
    for(const row of affected){
      await env.DB.prepare(`UPDATE appointments SET workflow_state='awaiting_reschedule',cancellation_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(String(data.reason||'').trim()||null,row.id).run()
      await env.DB.prepare(`INSERT INTO appointment_changes(id,appointment_id,actor_type,actor_id,change_type,old_starts_at,reason) VALUES(?,?,?,?, 'professional_day_cancelled',?,?)`).bind(crypto.randomUUID(),row.id,'admin',String(a.id),row.starts_at,String(data.reason||'').trim()||null).run()
      await syncCalendarEvent(env,row.id,'remove')
      await queueNotification(env,row.patient_id,row.id,'professional_cancelled',`A agenda de ${ptDate(row.starts_at)} precisou ser cancelada pela profissional.${data.reason?` Motivo: ${String(data.reason).trim()}.`:''} Seu pagamento continua válido e entraremos em contato para reagendar.`,[ptDate(row.starts_at),ptTime(row.starts_at),String(data.reason||'')],`cancel-day:${row.id}:${date}`)
    }
    await audit(env,'admin',a.id,'agenda_day_cancelled','agenda',date,{reason:data.reason||null,affected:affected.length})
    return json({ok:true,affected:affected.length})
  }

  const recurrence=path.match(/^\/api\/admin\/patients\/(\d+)\/recurrence$/)
  if(recurrence){
    const a=await admin(request,env);if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
    const patientId=Number(recurrence[1])
    if(request.method==='GET'){
      const rule=await env.DB.prepare(`SELECT * FROM patient_recurrence WHERE patient_id=?`).bind(patientId).first<any>()
      return json({ok:true,recurrence:rule||null})
    }
    if(request.method==='DELETE'){
      await env.DB.prepare(`UPDATE patient_recurrence SET active=0,updated_at=CURRENT_TIMESTAMP WHERE patient_id=?`).bind(patientId).run();return json({ok:true})
    }
    if(request.method==='PUT'){
      const data=await request.json().catch(()=>({})) as any;const cadence=Number(data.cadence_days)===14?14:7;const sourceId=Number(data.source_appointment_id)
      const source=await env.DB.prepare(`SELECT a.id,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.id=? AND a.patient_id=? AND a.status='confirmed'`).bind(sourceId,patientId).first<any>()
      if(!source)return json({ok:false,message:'Escolha uma sessão confirmada deste paciente como referência.'},409)
      const local=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(source.starts_at))
      const weekdayMap:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};const wd=weekdayMap[local.find(x=>x.type==='weekday')?.value||'Mon']
      const hh=local.find(x=>x.type==='hour')?.value||'00',mm=local.find(x=>x.type==='minute')?.value||'00';const id=crypto.randomUUID()
      await env.DB.prepare(`INSERT INTO patient_recurrence(id,patient_id,cadence_days,weekday,start_time,active,source_appointment_id) VALUES(?,?,?,?,?,1,?) ON CONFLICT(patient_id) DO UPDATE SET cadence_days=excluded.cadence_days,weekday=excluded.weekday,start_time=excluded.start_time,active=1,source_appointment_id=excluded.source_appointment_id,updated_at=CURRENT_TIMESTAMP`).bind(id,patientId,cadence,wd,`${hh}:${mm}`,sourceId).run()
      await ensureNextRecurringReservation(env,sourceId)
      return json({ok:true,cadence_days:cadence})
    }
  }

  return null
}
