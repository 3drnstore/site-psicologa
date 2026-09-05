import type { Env } from './types'

const SYNC_TTL_MS=60*1000
const PREFIX_SLOT='google_calendar_slot:'
const PREFIX_EVENT='google_calendar_event:'
const AVAILABILITY_EVENT_KEY='google_availability_event:'

async function accessToken(env:Env){
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_REFRESH_TOKEN)return null
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})})
  if(!response.ok)return null
  return String(((await response.json())as any).access_token||'')||null
}
const calendarId=(env:Env)=>encodeURIComponent(env.GOOGLE_CALENDAR_ID||'primary')
const eventUrl=(env:Env,eventId?:string)=>`https://www.googleapis.com/calendar/v3/calendars/${calendarId(env)}/events${eventId?`/${encodeURIComponent(eventId)}`:''}`

function eventRange(event:any){
  const startRaw=event?.start?.dateTime||event?.start?.date,endRaw=event?.end?.dateTime||event?.end?.date
  if(!startRaw||!endRaw)return null
  const start=event?.start?.dateTime?new Date(startRaw):new Date(`${startRaw}T00:00:00-03:00`),end=event?.end?.dateTime?new Date(endRaw):new Date(`${endRaw}T00:00:00-03:00`)
  if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<=start)return null
  return{starts_at:start.toISOString(),ends_at:end.toISOString()}
}
function rangeSyncKey(from:string,to:string){return `google_calendar_last_sync_at:${new Date(from).toISOString().slice(0,10)}:${new Date(to).toISOString().slice(0,10)}`}
async function lastSync(env:Env,key:string){const row=await env.DB.prepare(`SELECT value FROM settings WHERE key=?`).bind(key).first<any>();return row?.value?new Date(String(row.value)).getTime():0}
async function setSetting(env:Env,key:string,value:string){await env.DB.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(key,value).run()}
async function deleteSetting(env:Env,key:string){await env.DB.prepare(`DELETE FROM settings WHERE key=?`).bind(key).run()}
async function markSync(env:Env,key:string){await setSetting(env,key,new Date().toISOString())}

function standardPortalRanges(range:{starts_at:string;ends_at:string}){
  const eventStart=new Date(range.starts_at),eventEnd=new Date(range.ends_at),first=new Date(eventStart);first.setMinutes(0,0,0)
  const blocks:{starts_at:string;ends_at:string}[]=[]
  for(let cursor=new Date(first);cursor<eventEnd;cursor=new Date(cursor.getTime()+3600000)){const blockEnd=new Date(cursor.getTime()+3000000);if(cursor<eventEnd&&blockEnd>eventStart)blocks.push({starts_at:cursor.toISOString(),ends_at:blockEnd.toISOString()})}
  return blocks
}
function portalEventContent(a:any){
  const confirmed=String(a.status)==='confirmed'
  return{summary:confirmed?`Sessão – ${a.full_name} (Confirmada)`:`Reserva – ${a.full_name} (Pendente de pagamento)`,description:confirmed?`Sessão confirmada pelo portal. Contato: ${a.phone||a.email||''}.`:`Horário reservado pelo portal e aguardando confirmação de pagamento. Contato: ${a.phone||a.email||''}.`,start:{dateTime:a.starts_at,timeZone:'America/Sao_Paulo'},end:{dateTime:a.ends_at,timeZone:'America/Sao_Paulo'},extendedProperties:{private:{portal_source:'site-psicologa',portal_kind:'appointment',appointment_id:String(a.id)}}}
}

export async function syncPortalAppointmentToGoogle(env:Env,appointmentId:number){
  const appointment=await env.DB.prepare(`SELECT a.id,a.status,a.google_calendar_event_id,av.starts_at,av.ends_at,p.full_name,p.email,p.phone FROM appointments a JOIN availability av ON av.id=a.availability_id JOIN patients p ON p.id=a.patient_id WHERE a.id=?`).bind(appointmentId).first<any>()
  if(!appointment||!['pending_payment','confirmed'].includes(String(appointment.status)))return null
  const token=await accessToken(env);if(!token){await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='pending' WHERE id=?`).bind(appointmentId).run().catch(()=>null);return null}
  const content=portalEventContent(appointment)
  if(appointment.google_calendar_event_id){
    const eventId=String(appointment.google_calendar_event_id),response=await fetch(eventUrl(env,eventId),{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(content)})
    if(response.ok){await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='synced',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(appointmentId).run().catch(()=>null);return eventId}
    if(response.status!==404&&response.status!==410){await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='pending' WHERE id=?`).bind(appointmentId).run().catch(()=>null);return null}
    await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=NULL,calendar_sync_state='pending',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(appointmentId).run()
  }
  const response=await fetch(eventUrl(env),{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(content)})
  if(!response.ok){await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='pending' WHERE id=?`).bind(appointmentId).run().catch(()=>null);return null}
  const event=await response.json() as any
  if(event.id)await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=?,calendar_sync_state='synced',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(event.id,appointmentId).run()
  return event.id||null
}

const availabilityKey=(id:number)=>`${AVAILABILITY_EVENT_KEY}${id}`
async function availabilityEventId(env:Env,id:number){const row=await env.DB.prepare(`SELECT value FROM settings WHERE key=?`).bind(availabilityKey(id)).first<any>();return row?.value?String(row.value):''}
export async function removePortalAvailabilityFromGoogle(env:Env,id:number){
  const eventId=await availabilityEventId(env,id);if(!eventId)return true
  const token=await accessToken(env);if(!token)return false
  const response=await fetch(eventUrl(env,eventId),{method:'DELETE',headers:{authorization:`Bearer ${token}`}}).catch(()=>null)
  if(response&&response.status!==404&&response.status!==410&&!response.ok)return false
  await deleteSetting(env,availabilityKey(id));return true
}
export async function syncPortalAvailabilityToGoogle(env:Env,id:number){
  const row=await env.DB.prepare(`SELECT id,starts_at,ends_at,status,source,public_visibility FROM availability WHERE id=?`).bind(id).first<any>()
  if(!row)return removePortalAvailabilityFromGoogle(env,id)
  if(String(row.source||'').startsWith('google_calendar_'))return true
  if(!['blocked','occupied'].includes(String(row.status))||String(row.public_visibility||'visible')==='hidden')return removePortalAvailabilityFromGoogle(env,id)
  const token=await accessToken(env);if(!token)return false
  const content={summary:String(row.status)==='blocked'?'Agenda bloqueada (Portal)':'Horário ocupado (Portal)',description:'Bloqueio criado no painel profissional.',start:{dateTime:row.starts_at,timeZone:'America/Sao_Paulo'},end:{dateTime:row.ends_at,timeZone:'America/Sao_Paulo'},extendedProperties:{private:{portal_source:'site-psicologa',portal_kind:'availability',availability_id:String(row.id)}}}
  let eventId=await availabilityEventId(env,id)
  if(eventId){const patch=await fetch(eventUrl(env,eventId),{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(content)});if(patch.ok)return true;if(patch.status!==404&&patch.status!==410)return false;await deleteSetting(env,availabilityKey(id));eventId=''}
  const create=await fetch(eventUrl(env),{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(content)});if(!create.ok)return false
  const event=await create.json() as any;if(!event.id)return false;await setSetting(env,availabilityKey(id),String(event.id));return true
}

async function cleanupInactivePortalEvents(env:Env,token:string){
  const rows=await env.DB.prepare(`SELECT id,google_calendar_event_id FROM appointments WHERE google_calendar_event_id IS NOT NULL AND google_calendar_event_id<>'' AND status NOT IN ('pending_payment','confirmed')`).all<any>()
  for(const row of rows.results||[]){const eventId=String(row.google_calendar_event_id||'');if(!eventId)continue;const response=await fetch(eventUrl(env,eventId),{method:'DELETE',headers:{authorization:`Bearer ${token}`}}).catch(()=>null);if(!response||response.ok||response.status===404||response.status===410)await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=NULL,calendar_sync_state='synced',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.id).run()}
}

export async function syncGoogleCalendarAvailability(env:Env,from:string,to:string,force=false){
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_REFRESH_TOKEN)return{configured:false,synced:false}
  const syncKey=rangeSyncKey(from,to);if(!force&&Date.now()-await lastSync(env,syncKey)<SYNC_TTL_MS)return{configured:true,synced:false,cached:true}
  const token=await accessToken(env);if(!token)return{configured:true,synced:false,error:'token'}
  await cleanupInactivePortalEvents(env,token)
  const min=new Date(from).toISOString(),max=new Date(to).toISOString()
  const activeAppointments=await env.DB.prepare(`SELECT a.id FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.status IN ('pending_payment','confirmed') AND av.starts_at<? AND av.ends_at>?`).bind(max,min).all<any>()
  let appointmentSyncFailures=0;for(const row of activeAppointments.results||[])if(!(await syncPortalAppointmentToGoogle(env,Number(row.id))))appointmentSyncFailures++
  const localAvailability=await env.DB.prepare(`SELECT id FROM availability WHERE status IN ('blocked','occupied') AND COALESCE(source,'manual') NOT LIKE 'google_calendar_%' AND starts_at<? AND ends_at>?`).bind(max,min).all<any>()
  let availabilitySyncFailures=0;for(const row of localAvailability.results||[])if(!(await syncPortalAvailabilityToGoogle(env,Number(row.id))))availabilitySyncFailures++

  const url=new URL(eventUrl(env));url.searchParams.set('timeMin',min);url.searchParams.set('timeMax',max);url.searchParams.set('singleEvents','true');url.searchParams.set('orderBy','startTime');url.searchParams.set('maxResults','2500')
  const response=await fetch(url.toString(),{headers:{authorization:`Bearer ${token}`,accept:'application/json'}});if(!response.ok)return{configured:true,synced:false,error:`google_${response.status}`,appointment_sync_failures:appointmentSyncFailures,availability_sync_failures:availabilitySyncFailures}
  const data=await response.json() as any,events=(data.items||[]).filter((e:any)=>e&&e.status!=='cancelled'&&e.transparency!=='transparent')
  const localEvents=await env.DB.prepare(`SELECT google_calendar_event_id FROM appointments WHERE google_calendar_event_id IS NOT NULL AND google_calendar_event_id<>''`).all<any>()
  const availabilityEvents=await env.DB.prepare(`SELECT value FROM settings WHERE key LIKE ?`).bind(`${AVAILABILITY_EVENT_KEY}%`).all<any>()
  const localIds=new Set([...(localEvents.results||[]).map((r:any)=>String(r.google_calendar_event_id)),...(availabilityEvents.results||[]).map((r:any)=>String(r.value))])
  const activeSources=new Set<string>()
  for(const event of events){
    const eventId=String(event.id||'');if(!eventId||localIds.has(eventId))continue
    const range=eventRange(event);if(!range)continue
    const existingImported=await env.DB.prepare(`SELECT id,source FROM availability WHERE source IN (?,?)`).bind(`${PREFIX_SLOT}${eventId}`,`${PREFIX_EVENT}${eventId}`).all<any>()
    if((existingImported.results||[]).length){for(const row of existingImported.results||[])activeSources.add(String(row.source));continue}
    const overlaps=await env.DB.prepare(`SELECT id,status,source FROM availability WHERE starts_at<? AND ends_at>? ORDER BY starts_at`).bind(range.ends_at,range.starts_at).all<any>()
    const free=(overlaps.results||[]).filter((r:any)=>String(r.status)==='free'&&!String(r.source||'').startsWith('google_calendar_'))
    if(free.length){const source=`${PREFIX_SLOT}${eventId}`;activeSources.add(source);for(const row of free)await env.DB.prepare(`UPDATE availability SET status='occupied',public_visibility='visible',source=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='free'`).bind(source,row.id).run();continue}
    if((overlaps.results||[]).some((r:any)=>['held','confirmed'].includes(String(r.status)))||(overlaps.results||[]).length)continue
    const source=`${PREFIX_EVENT}${eventId}`;activeSources.add(source);for(const block of standardPortalRanges(range))await env.DB.prepare(`INSERT INTO availability(starts_at,ends_at,status,public_visibility,source) VALUES(?,?,'occupied','visible',?)`).bind(block.starts_at,block.ends_at,source).run()
  }
  const imported=await env.DB.prepare(`SELECT id,source,status FROM availability WHERE (source LIKE 'google_calendar_slot:%' OR source LIKE 'google_calendar_event:%') AND starts_at<? AND ends_at>?`).bind(max,min).all<any>()
  for(const row of imported.results||[]){const source=String(row.source||'');if(activeSources.has(source))continue;if(source.startsWith(PREFIX_EVENT))await env.DB.prepare(`DELETE FROM availability WHERE id=? AND source=?`).bind(row.id,source).run();else if(source.startsWith(PREFIX_SLOT)&&String(row.status)==='occupied')await env.DB.prepare(`UPDATE availability SET status='free',source='manual',updated_at=CURRENT_TIMESTAMP WHERE id=? AND source=?`).bind(row.id,source).run()}
  await markSync(env,syncKey)
  return{configured:true,synced:true,events:events.length,appointment_sync_failures:appointmentSyncFailures,availability_sync_failures:availabilitySyncFailures}
}
