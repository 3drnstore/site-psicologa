import type { Env } from './types'

const SYNC_TTL_MS=60*1000
const PREFIX_SLOT='google_calendar_slot:'
const PREFIX_EVENT='google_calendar_event:'

async function accessToken(env:Env){
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_REFRESH_TOKEN)return null
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})})
  if(!response.ok)return null
  return String(((await response.json())as any).access_token||'')||null
}

function eventRange(event:any){
  const startRaw=event?.start?.dateTime||event?.start?.date
  const endRaw=event?.end?.dateTime||event?.end?.date
  if(!startRaw||!endRaw)return null
  const start=event?.start?.dateTime?new Date(startRaw):new Date(`${startRaw}T00:00:00-03:00`)
  const end=event?.end?.dateTime?new Date(endRaw):new Date(`${endRaw}T00:00:00-03:00`)
  if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<=start)return null
  return{starts_at:start.toISOString(),ends_at:end.toISOString()}
}

function rangeSyncKey(from:string,to:string){
  const fromDay=new Date(from).toISOString().slice(0,10)
  const toDay=new Date(to).toISOString().slice(0,10)
  return `google_calendar_last_sync_at:${fromDay}:${toDay}`
}

async function lastSync(env:Env,key:string){const row=await env.DB.prepare(`SELECT value FROM settings WHERE key=?`).bind(key).first<any>();return row?.value?new Date(String(row.value)).getTime():0}
async function markSync(env:Env,key:string){await env.DB.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(key,new Date().toISOString()).run()}

function standardPortalRanges(range:{starts_at:string;ends_at:string}){
  const eventStart=new Date(range.starts_at),eventEnd=new Date(range.ends_at)
  const first=new Date(eventStart)
  first.setMinutes(0,0,0)
  const blocks:{starts_at:string;ends_at:string}[]=[]
  for(let cursor=new Date(first);cursor<eventEnd;cursor=new Date(cursor.getTime()+60*60*1000)){
    const blockEnd=new Date(cursor.getTime()+50*60*1000)
    if(cursor<eventEnd&&blockEnd>eventStart)blocks.push({starts_at:cursor.toISOString(),ends_at:blockEnd.toISOString()})
  }
  return blocks
}

export async function syncPortalAppointmentToGoogle(env:Env,appointmentId:number){
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_REFRESH_TOKEN)return null
  const appointment=await env.DB.prepare(`SELECT a.id,a.status,a.google_calendar_event_id,av.starts_at,av.ends_at,p.full_name,p.email,p.phone FROM appointments a JOIN availability av ON av.id=a.availability_id JOIN patients p ON p.id=a.patient_id WHERE a.id=?`).bind(appointmentId).first<any>()
  if(!appointment||!['pending_payment','confirmed'].includes(String(appointment.status)))return null
  if(appointment.google_calendar_event_id)return String(appointment.google_calendar_event_id)
  const token=await accessToken(env);if(!token)return null
  const calendar=encodeURIComponent(env.GOOGLE_CALENDAR_ID||'primary')
  const response=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`,{
    method:'POST',
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    body:JSON.stringify({
      summary:`Sessão – ${appointment.full_name}`,
      description:'Horário reservado pelo portal de atendimento.',
      start:{dateTime:appointment.starts_at,timeZone:'America/Sao_Paulo'},
      end:{dateTime:appointment.ends_at,timeZone:'America/Sao_Paulo'},
    }),
  })
  if(!response.ok)return null
  const event=await response.json() as any
  if(event.id)await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(event.id,appointmentId).run()
  return event.id||null
}

async function cleanupInactivePortalEvents(env:Env,token:string){
  const rows=await env.DB.prepare(`SELECT id,google_calendar_event_id FROM appointments WHERE google_calendar_event_id IS NOT NULL AND google_calendar_event_id<>'' AND status NOT IN ('pending_payment','confirmed')`).all<any>()
  const calendar=encodeURIComponent(env.GOOGLE_CALENDAR_ID||'primary')
  for(const row of rows.results||[]){
    const eventId=String(row.google_calendar_event_id||'');if(!eventId)continue
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${encodeURIComponent(eventId)}`,{method:'DELETE',headers:{authorization:`Bearer ${token}`}}).catch(()=>null)
    await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.id).run()
  }
}

export async function syncGoogleCalendarAvailability(env:Env,from:string,to:string,force=false){
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_REFRESH_TOKEN)return{configured:false,synced:false}
  const syncKey=rangeSyncKey(from,to)
  if(!force&&Date.now()-await lastSync(env,syncKey)<SYNC_TTL_MS)return{configured:true,synced:false,cached:true}
  const token=await accessToken(env);if(!token)return{configured:true,synced:false,error:'token'}
  await cleanupInactivePortalEvents(env,token)
  const activeAppointments=await env.DB.prepare(`SELECT a.id FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.status IN ('pending_payment','confirmed') AND av.starts_at<? AND av.ends_at>?`).bind(new Date(to).toISOString(),new Date(from).toISOString()).all<any>()
  for(const row of activeAppointments.results||[])await syncPortalAppointmentToGoogle(env,Number(row.id))
  const calendar=encodeURIComponent(env.GOOGLE_CALENDAR_ID||'primary')
  const url=new URL(`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`)
  url.searchParams.set('timeMin',new Date(from).toISOString());url.searchParams.set('timeMax',new Date(to).toISOString());url.searchParams.set('singleEvents','true');url.searchParams.set('orderBy','startTime');url.searchParams.set('maxResults','2500')
  const response=await fetch(url.toString(),{headers:{authorization:`Bearer ${token}`,accept:'application/json'}})
  if(!response.ok)return{configured:true,synced:false,error:`google_${response.status}`}
  const data=await response.json() as any,events=(data.items||[]).filter((e:any)=>e&&e.status!=='cancelled'&&e.transparency!=='transparent')
  const localEvents=await env.DB.prepare(`SELECT google_calendar_event_id FROM appointments WHERE google_calendar_event_id IS NOT NULL AND google_calendar_event_id<>''`).all<any>()
  const localIds=new Set((localEvents.results||[]).map((r:any)=>String(r.google_calendar_event_id)))
  const activeSources=new Set<string>()
  for(const event of events){
    const eventId=String(event.id||'');if(!eventId||localIds.has(eventId))continue
    const range=eventRange(event);if(!range)continue
    const existingImported=await env.DB.prepare(`SELECT id,source FROM availability WHERE source IN (?,?)`).bind(`${PREFIX_SLOT}${eventId}`,`${PREFIX_EVENT}${eventId}`).all<any>()
    if((existingImported.results||[]).length){for(const row of existingImported.results||[])activeSources.add(String(row.source));continue}
    const overlaps=await env.DB.prepare(`SELECT id,status,source FROM availability WHERE starts_at<? AND ends_at>? ORDER BY starts_at`).bind(range.ends_at,range.starts_at).all<any>()
    const free=(overlaps.results||[]).filter((r:any)=>String(r.status)==='free'&&!String(r.source||'').startsWith('google_calendar_'))
    if(free.length){
      const source=`${PREFIX_SLOT}${eventId}`;activeSources.add(source)
      for(const row of free)await env.DB.prepare(`UPDATE availability SET status='occupied',public_visibility='visible',source=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='free'`).bind(source,row.id).run()
      continue
    }
    const hasProtected=(overlaps.results||[]).some((r:any)=>['held','confirmed'].includes(String(r.status)))
    if(hasProtected)continue
    if((overlaps.results||[]).length)continue
    const source=`${PREFIX_EVENT}${eventId}`;activeSources.add(source)
    const blocks=standardPortalRanges(range)
    for(const block of blocks){await env.DB.prepare(`INSERT INTO availability(starts_at,ends_at,status,public_visibility,source) VALUES(?,?,'occupied','visible',?)`).bind(block.starts_at,block.ends_at,source).run()}
  }
  const imported=await env.DB.prepare(`SELECT id,source,status FROM availability WHERE (source LIKE 'google_calendar_slot:%' OR source LIKE 'google_calendar_event:%') AND starts_at<? AND ends_at>?`).bind(new Date(to).toISOString(),new Date(from).toISOString()).all<any>()
  for(const row of imported.results||[]){
    const source=String(row.source||'');if(activeSources.has(source))continue
    if(source.startsWith(PREFIX_EVENT))await env.DB.prepare(`DELETE FROM availability WHERE id=? AND source=?`).bind(row.id,source).run()
    else if(source.startsWith(PREFIX_SLOT)&&String(row.status)==='occupied')await env.DB.prepare(`UPDATE availability SET status='free',source='manual',updated_at=CURRENT_TIMESTAMP WHERE id=? AND source=?`).bind(row.id,source).run()
  }
  await markSync(env,syncKey)
  return{configured:true,synced:true,events:events.length}
}
