import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const nowIso=()=>new Date().toISOString()

async function admin(request:Request,env:Env){
  const token=readCookie(request,'ps_admin_session');if(!token)return null
  return env.DB.prepare(`SELECT a.id,a.email,a.display_name FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),nowIso()).first<any>()
}

async function token(env:Env):Promise<{ok:true;accessToken:string}|{ok:false;error:string;detail:string}>{
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_REFRESH_TOKEN)return{ok:false,error:'missing_credentials',detail:''}
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})})
  const body=await r.json().catch(()=>({})) as any
  if(!r.ok||!body.access_token)return{ok:false,error:`token_${r.status}`,detail:String(body.error||body.error_description||'')}
  return{ok:true,accessToken:String(body.access_token)}
}

function safeEvent(e:any){return{id:String(e?.id||''),summary:String(e?.summary||'(sem título)'),status:String(e?.status||''),transparency:String(e?.transparency||'opaque'),start:e?.start?.dateTime||e?.start?.date||null,end:e?.end?.dateTime||e?.end?.date||null,portal_source:e?.extendedProperties?.private?.portal_source||null,portal_kind:e?.extendedProperties?.private?.portal_kind||null}}

export async function handleGoogleCalendarDiagnostic(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/admin/google-calendar/diagnostic'||request.method!=='GET')return null
  const a=await admin(request,env);if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
  const t=await token(env)
  if(!t.ok)return json({ok:false,configured:Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_REFRESH_TOKEN),calendar_target:env.GOOGLE_CALENDAR_ID||'primary',token_error:t.error,token_detail:t.detail||null},200)

  const url=new URL(request.url)
  const from=url.searchParams.get('from')||new Date(Date.now()-7*86400000).toISOString()
  const to=url.searchParams.get('to')||new Date(Date.now()+30*86400000).toISOString()
  const calendarTarget=env.GOOGLE_CALENDAR_ID||'primary'
  const eventsUrl=new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarTarget)}/events`)
  eventsUrl.searchParams.set('timeMin',new Date(from).toISOString())
  eventsUrl.searchParams.set('timeMax',new Date(to).toISOString())
  eventsUrl.searchParams.set('singleEvents','true')
  eventsUrl.searchParams.set('orderBy','startTime')
  eventsUrl.searchParams.set('maxResults','100')
  const r=await fetch(eventsUrl.toString(),{headers:{authorization:`Bearer ${t.accessToken}`,accept:'application/json'}})
  const body=await r.json().catch(()=>({})) as any

  const appointments=await env.DB.prepare(`SELECT a.id,a.status,a.calendar_sync_state,a.google_calendar_event_id,av.starts_at,av.ends_at,p.full_name FROM appointments a JOIN availability av ON av.id=a.availability_id JOIN patients p ON p.id=a.patient_id WHERE av.starts_at<? AND av.ends_at>? ORDER BY av.starts_at LIMIT 100`).bind(new Date(to).toISOString(),new Date(from).toISOString()).all<any>()
  const availability=await env.DB.prepare(`SELECT id,starts_at,ends_at,status,source FROM availability WHERE starts_at<? AND ends_at>? AND status IN ('blocked','occupied','held','confirmed') ORDER BY starts_at LIMIT 150`).bind(new Date(to).toISOString(),new Date(from).toISOString()).all<any>()
  const mappings=await env.DB.prepare(`SELECT key,value FROM settings WHERE key LIKE 'google_availability_event:%' ORDER BY key LIMIT 150`).all<any>()

  return json({
    ok:true,
    mode:'READ_ONLY_DIAGNOSTIC_NO_GOOGLE_DELETES',
    calendar_target:calendarTarget,
    token_ok:true,
    google_events_request_status:r.status,
    google_events_count:Array.isArray(body.items)?body.items.length:0,
    google_events:Array.isArray(body.items)?body.items.map(safeEvent):[],
    appointments:(appointments.results||[]).map((x:any)=>({id:x.id,status:x.status,calendar_sync_state:x.calendar_sync_state,has_google_event_id:Boolean(x.google_calendar_event_id),starts_at:x.starts_at,ends_at:x.ends_at,patient:x.full_name})),
    local_busy_slots:(availability.results||[]),
    portal_google_mappings:(mappings.results||[]).map((x:any)=>({key:x.key,has_event_id:Boolean(x.value)})),
    note:'Este diagnóstico não cria, altera nem apaga eventos no Google Calendar.'
  })
}
