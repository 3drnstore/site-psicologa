import type { Env } from './types'

const SYNC_TTL_MS=10*1000
const PREFIX_SLOT='google_calendar_slot:'
const PREFIX_EVENT='google_calendar_event:'
const AVAILABILITY_EVENT_KEY='google_availability_event:'
const GOOGLE_SUMMARY_KEY='google_calendar_summary:'

export type GoogleCalendarWriteResult={ok:boolean;stage:string;status?:number;error?:string;event_id?:string}

async function accessToken(env:Env){
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_REFRESH_TOKEN)return null
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})})
  if(!response.ok)return null
  return String(((await response.json())as any).access_token||'')||null
}
async function setAppointmentSyncError(env:Env,appointmentId:number,error:string){
  await setSetting(env,`google_calendar_sync_error:${appointmentId}`,error.slice(0,500)).catch(()=>null)
}
async function clearAppointmentSyncError(env:Env,appointmentId:number){
  await env.DB.prepare(`DELETE FROM settings WHERE key=?`).bind(`google_calendar_sync_error:${appointmentId}`).run().catch(()=>null)
}
const calendarId=(env:Env)=>encodeURIComponent(env.GOOGLE_CALENDAR_ID||'primary')
const eventUrl=(env:Env,eventId?:string)=>`https://www.googleapis.com/calendar/v3/calendars/${calendarId(env)}/events${eventId?`/${encodeURIComponent(eventId)}`:''}`

async function googleWriteError(response:Response,stage:string):Promise<GoogleCalendarWriteResult>{
  let message=`Google Calendar respondeu HTTP ${response.status}.`
  try{
    const body=await response.json() as any
    const apiError=body?.error
    const apiMessage=String(apiError?.message||body?.message||'').trim()
    const reason=Array.isArray(apiError?.errors)?String(apiError.errors[0]?.reason||'').trim():''
    const status=String(apiError?.status||'').trim()
    const parts=[apiMessage,status&&status!==apiMessage?status:'',reason&&reason!==apiMessage?reason:''].filter(Boolean)
    if(parts.length)message=parts.join(' | ')
  }catch{}
  return{ok:false,stage,status:response.status,error:message.slice(0,500)}
}

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
  const appointment=await env.DB.prepare(`SELECT a.id,a.status,a.payment_deadline_at,a.reserved_until,a.google_calendar_event_id,av.starts_at,av.ends_at,p.full_name,p.email,p.phone FROM appointments a JOIN availability av ON av.id=a.availability_id JOIN patients p ON p.id=a.patient_id WHERE a.id=?`).bind(appointmentId).first<any>()
  if(!appointment||!['pending_payment','confirmed'].includes(String(appointment.status)))return null
  const deadline=appointment.payment_deadline_at||appointment.reserved_until
  if(appointment.status==='pending_payment'&&deadline&&new Date(deadline).getTime()<=Date.now())return null
  const token=await accessToken(env);if(!token){await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='pending' WHERE id=?`).bind(appointmentId).run().catch(()=>null);await setAppointmentSyncError(env,appointmentId,'Não foi possível obter um access token do Google. Verifique Client ID, Client Secret e Refresh Token.');return null}
  const content=portalEventContent(appointment)
  if(appointment.google_calendar_event_id){
    const eventId=String(appointment.google_calendar_event_id),response=await fetch(eventUrl(env,eventId),{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(content)})
    if(response.ok){await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='synced',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(appointmentId).run().catch(()=>null);await clearAppointmentSyncError(env,appointmentId);return await finishAppointmentSync(env,appointmentId,eventId)}
    if(response.status!==404&&response.status!==410){const failure=await googleWriteError(response,'appointment_patch');await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='pending' WHERE id=?`).bind(appointmentId).run().catch(()=>null);await setAppointmentSyncError(env,appointmentId,`${failure.stage}: ${failure.error||'erro desconhecido'}`);return null}
    await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=NULL,calendar_sync_state='pending',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(appointmentId).run()
  }
  let response:Response
  try{response=await fetch(eventUrl(env),{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(content)})}
  catch(error:any){const message=String(error?.message||'Falha de rede ao criar evento no Google Calendar.');await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='pending' WHERE id=?`).bind(appointmentId).run().catch(()=>null);await setAppointmentSyncError(env,appointmentId,message);return null}
  if(!response.ok){const failure=await googleWriteError(response,'appointment_create');await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='pending' WHERE id=?`).bind(appointmentId).run().catch(()=>null);await setAppointmentSyncError(env,appointmentId,`${failure.stage}: ${failure.error||'erro desconhecido'}`);return null}
  const event=await response.json() as any
  if(event.id){await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=?,calendar_sync_state='synced',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(event.id,appointmentId).run();await clearAppointmentSyncError(env,appointmentId)}
  return event.id?await finishAppointmentSync(env,appointmentId,String(event.id)):null
}

// A cancellation can finish while Google's POST/PATCH is in flight.
async function finishAppointmentSync(env:Env,appointmentId:number,eventId:string){
  const current=await env.DB.prepare(`SELECT status,payment_deadline_at,reserved_until FROM appointments WHERE id=?`).bind(appointmentId).first<any>()
  const deadline=current?.payment_deadline_at||current?.reserved_until
  if(current&&(!['pending_payment','confirmed'].includes(current.status)||(current.status==='pending_payment'&&deadline&&new Date(deadline).getTime()<=Date.now()))){
    await removePortalAppointmentFromGoogle(env,appointmentId)
    return null
  }
  return eventId
}

export async function removePortalAppointmentFromGoogle(env:Env,appointmentId:number):Promise<boolean>{
  const row=await env.DB.prepare(`SELECT google_calendar_event_id FROM appointments WHERE id=?`).bind(appointmentId).first<any>()
  if(!row)return true
  if(!row.google_calendar_event_id){
    await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='removed',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(appointmentId).run()
    return true
  }
  // Keep the event ID until Google acknowledges deletion so failures can be retried.
  await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='removal_pending',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(appointmentId).run()
  try{
    const token=await accessToken(env)
    if(!token){await setAppointmentSyncError(env,appointmentId,'Não foi possível obter token para remover o evento.');return false}
    const response=await fetch(eventUrl(env,String(row.google_calendar_event_id)),{method:'DELETE',headers:{authorization:`Bearer ${token}`}})
    if(!response.ok&&response.status!==404&&response.status!==410){
      const failure=await googleWriteError(response,'appointment_remove')
      await setAppointmentSyncError(env,appointmentId,failure.error||'Falha ao remover evento.')
      return false
    }
    await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=NULL,calendar_sync_state='removed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND google_calendar_event_id=?`).bind(appointmentId,row.google_calendar_event_id).run()
    await clearAppointmentSyncError(env,appointmentId)
    return true
  }catch(error){await setAppointmentSyncError(env,appointmentId,error instanceof Error?error.message:String(error));return false}
}

const availabilityKey=(id:number)=>`${AVAILABILITY_EVENT_KEY}${id}`
async function availabilityEventId(env:Env,id:number){const row=await env.DB.prepare(`SELECT value FROM settings WHERE key=?`).bind(availabilityKey(id)).first<any>();return row?.value?String(row.value):''}

export async function removePortalAvailabilityFromGoogleDetailed(env:Env,id:number):Promise<GoogleCalendarWriteResult>{
  const eventId=await availabilityEventId(env,id);if(!eventId)return{ok:true,stage:'nothing_to_release'}
  const token=await accessToken(env);if(!token)return{ok:false,stage:'access_token',error:'Não foi possível obter um access token do Google.'}
  let response:Response
  try{
    response=await fetch(eventUrl(env,eventId),{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({summary:'Horário liberado no Portal',description:'Este horário não está mais bloqueado pelo portal.',transparency:'transparent',extendedProperties:{private:{portal_source:'site-psicologa',portal_kind:'availability_released',availability_id:String(id)}}})})
  }catch(error:any){return{ok:false,stage:'release_patch_network',error:String(error?.message||'Falha de rede ao atualizar o Google Calendar.').slice(0,500)}}
  if(response.ok||response.status===404||response.status===410)return{ok:true,stage:'release_patch',status:response.status,event_id:eventId}
  return googleWriteError(response,'release_patch')
}

export async function removePortalAvailabilityFromGoogle(env:Env,id:number){return (await removePortalAvailabilityFromGoogleDetailed(env,id)).ok}

export async function syncPortalAvailabilityToGoogleDetailed(env:Env,id:number):Promise<GoogleCalendarWriteResult>{
  const row=await env.DB.prepare(`SELECT id,starts_at,ends_at,status,source,public_visibility FROM availability WHERE id=?`).bind(id).first<any>()
  if(!row)return removePortalAvailabilityFromGoogleDetailed(env,id)
  if(String(row.source||'').startsWith('google_calendar_'))return{ok:true,stage:'google_import_skipped'}
  if(!['blocked','occupied'].includes(String(row.status))||String(row.public_visibility||'visible')==='hidden')return removePortalAvailabilityFromGoogleDetailed(env,id)
  const token=await accessToken(env);if(!token)return{ok:false,stage:'access_token',error:'Não foi possível obter um access token do Google.'}
  const content={summary:String(row.status)==='blocked'?'Agenda bloqueada (Portal)':'Horário ocupado (Portal)',description:'Bloqueio criado no painel profissional.',transparency:'opaque',start:{dateTime:row.starts_at,timeZone:'America/Sao_Paulo'},end:{dateTime:row.ends_at,timeZone:'America/Sao_Paulo'},extendedProperties:{private:{portal_source:'site-psicologa',portal_kind:'availability',availability_id:String(row.id)}}}
  let eventId=await availabilityEventId(env,id)
  if(eventId){
    let patch:Response
    try{patch=await fetch(eventUrl(env,eventId),{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(content)})}
    catch(error:any){return{ok:false,stage:'availability_patch_network',error:String(error?.message||'Falha de rede ao atualizar o Google Calendar.').slice(0,500)}}
    if(patch.ok)return{ok:true,stage:'availability_patch',status:patch.status,event_id:eventId}
    if(patch.status!==404&&patch.status!==410)return googleWriteError(patch,'availability_patch')
    eventId=''
  }
  let create:Response
  try{create=await fetch(eventUrl(env),{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(content)})}
  catch(error:any){return{ok:false,stage:'availability_create_network',error:String(error?.message||'Falha de rede ao criar evento no Google Calendar.').slice(0,500)}}
  if(!create.ok)return googleWriteError(create,'availability_create')
  const event=await create.json() as any
  if(!event.id)return{ok:false,stage:'availability_create_response',status:create.status,error:'Google confirmou a criação, mas não retornou o ID do evento.'}
  try{await setSetting(env,availabilityKey(id),String(event.id))}
  catch(error:any){return{ok:false,stage:'persist_mapping',status:create.status,event_id:String(event.id),error:`Evento criado no Google, mas o portal não conseguiu salvar o vínculo local: ${String(error?.message||'erro no banco').slice(0,350)}`}}
  return{ok:true,stage:'availability_create',status:create.status,event_id:String(event.id)}
}

export async function syncPortalAvailabilityToGoogle(env:Env,id:number){return (await syncPortalAvailabilityToGoogleDetailed(env,id)).ok}

async function markInactivePortalAppointments(env:Env){
  await env.DB.prepare(`UPDATE appointments SET calendar_sync_state='inactive' WHERE google_calendar_event_id IS NOT NULL AND google_calendar_event_id<>'' AND status NOT IN ('pending_payment','confirmed') AND COALESCE(calendar_sync_state,'')<>'removal_pending'`).run().catch(()=>null)
}

export async function retryPendingGoogleCalendarAppointments(env:Env){
  const removals=await env.DB.prepare(`SELECT id FROM appointments WHERE google_calendar_event_id IS NOT NULL AND google_calendar_event_id<>'' AND (status IN ('cancelled','expired') OR calendar_sync_state='removal_pending') ORDER BY updated_at ASC LIMIT 25`).all<any>()
  for(const row of removals.results||[])await removePortalAppointmentFromGoogle(env,Number(row.id))
  const rows=await env.DB.prepare(`SELECT id FROM appointments WHERE status IN ('pending_payment','confirmed') AND (calendar_sync_state IS NULL OR calendar_sync_state='pending') ORDER BY updated_at ASC LIMIT 25`).all<any>()
  let synced=0,failed=0
  for(const row of rows.results||[]){
    try{
      const eventId=await syncPortalAppointmentToGoogle(env,Number(row.id))
      if(eventId)synced++;else failed++
    }catch(error){
      failed++
      await setAppointmentSyncError(env,Number(row.id),error instanceof Error?error.message:String(error))
    }
  }
  return{attempted:(rows.results||[]).length,synced,failed}
}

export async function syncGoogleCalendarAvailability(env:Env,from:string,to:string,force=false){
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_REFRESH_TOKEN)return{configured:false,synced:false}
  const syncKey=rangeSyncKey(from,to);if(!force&&Date.now()-await lastSync(env,syncKey)<SYNC_TTL_MS)return{configured:true,synced:false,cached:true}
  const token=await accessToken(env);if(!token)return{configured:true,synced:false,error:'token'}
  await markInactivePortalAppointments(env)
  const min=new Date(from).toISOString(),max=new Date(to).toISOString()

  // Esta rota é usada para LEITURA da agenda. Escritas Portal -> Google acontecem
  // nos próprios fluxos de reserva/bloqueio/reagendamento. Não repetimos todas
  // as escritas a cada troca de semana, pois isso deixava a navegação travada.
  const url=new URL(eventUrl(env));url.searchParams.set('timeMin',min);url.searchParams.set('timeMax',max);url.searchParams.set('singleEvents','true');url.searchParams.set('orderBy','startTime');url.searchParams.set('maxResults','2500')
  const response=await fetch(url.toString(),{headers:{authorization:`Bearer ${token}`,accept:'application/json'}});if(!response.ok)return{configured:true,synced:false,error:`google_${response.status}`}
  const data=await response.json() as any,events=(data.items||[]).filter((e:any)=>e&&e.status!=='cancelled'&&e.transparency!=='transparent')
  const localEvents=await env.DB.prepare(`SELECT google_calendar_event_id FROM appointments WHERE google_calendar_event_id IS NOT NULL AND google_calendar_event_id<>''`).all<any>()
  const availabilityEvents=await env.DB.prepare(`SELECT value FROM settings WHERE key LIKE ?`).bind(`${AVAILABILITY_EVENT_KEY}%`).all<any>()
  const localIds=new Set([...(localEvents.results||[]).map((r:any)=>String(r.google_calendar_event_id)),...(availabilityEvents.results||[]).map((r:any)=>String(r.value))])

  const importedRows=await env.DB.prepare(`SELECT id,source,status FROM availability WHERE (source LIKE 'google_calendar_slot:%' OR source LIKE 'google_calendar_event:%') AND starts_at<? AND ends_at>?`).bind(max,min).all<any>()
  const importedSources=new Set((importedRows.results||[]).map((r:any)=>String(r.source||'')))
  const activeSources=new Set<string>()
  const labelWrites:any[]=[]
  let importedGoogleEvents=0

  for(const event of events){
    const eventId=String(event.id||'');if(!eventId||localIds.has(eventId))continue
    const range=eventRange(event);if(!range)continue
    const summary=String(event.summary||'Compromisso no Google').trim().slice(0,240)||'Compromisso no Google'
    labelWrites.push(env.DB.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(`${GOOGLE_SUMMARY_KEY}${eventId}`,summary))

    const slotSource=`${PREFIX_SLOT}${eventId}`,eventSource=`${PREFIX_EVENT}${eventId}`
    if(importedSources.has(slotSource)||importedSources.has(eventSource)){
      if(importedSources.has(slotSource))activeSources.add(slotSource)
      if(importedSources.has(eventSource))activeSources.add(eventSource)
      importedGoogleEvents++
      continue
    }

    const overlaps=await env.DB.prepare(`SELECT id,status,source FROM availability WHERE starts_at<? AND ends_at>? ORDER BY starts_at`).bind(range.ends_at,range.starts_at).all<any>()
    const free=(overlaps.results||[]).filter((r:any)=>String(r.status)==='free'&&!String(r.source||'').startsWith('google_calendar_'))
    if(free.length){activeSources.add(slotSource);const updates=free.map((row:any)=>env.DB.prepare(`UPDATE availability SET status='occupied',public_visibility='visible',source=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='free'`).bind(slotSource,row.id));if(updates.length)await env.DB.batch(updates);importedGoogleEvents++;continue}
    if((overlaps.results||[]).some((r:any)=>['held','confirmed'].includes(String(r.status)))||(overlaps.results||[]).length)continue
    activeSources.add(eventSource)
    const blocks=standardPortalRanges(range),inserts=blocks.map(block=>env.DB.prepare(`INSERT INTO availability(starts_at,ends_at,status,public_visibility,source) VALUES(?,?,'occupied','visible',?)`).bind(block.starts_at,block.ends_at,eventSource))
    if(inserts.length)await env.DB.batch(inserts)
    importedGoogleEvents++
  }

  if(labelWrites.length)await env.DB.batch(labelWrites).catch(()=>null)
  for(const row of importedRows.results||[]){const source=String(row.source||'');if(activeSources.has(source))continue;if(source.startsWith(PREFIX_EVENT))await env.DB.prepare(`DELETE FROM availability WHERE id=? AND source=?`).bind(row.id,source).run();else if(source.startsWith(PREFIX_SLOT)&&String(row.status)==='occupied')await env.DB.prepare(`UPDATE availability SET status='free',source='manual',updated_at=CURRENT_TIMESTAMP WHERE id=? AND source=?`).bind(row.id,source).run()}
  await markSync(env,syncKey)
  return{configured:true,synced:true,events:events.length,imported_google_events:importedGoogleEvents}
}
