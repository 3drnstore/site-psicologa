import { installClinicalE2E } from './clinical-e2e-client'

type CacheEntry={expires:number,status:number,statusText:string,headers:[string,string][],body:string}
type PendingEntry=Promise<CacheEntry>

// E2E must wrap native fetch before the generic cache captures it.
installClinicalE2E()
const originalFetch=window.fetch.bind(window)
const cache=new Map<string,CacheEntry>()
const pending=new Map<string,PendingEntry>()

const TTL:Record<string,number>={
  '/api/availability':10*60*1000,
  '/api/appointments/mine':5*60*1000,
  '/api/admin/appointments':2*60*1000,
  '/api/admin/patients':5*60*1000,
  '/api/admin/settings':10*60*1000,
  '/api/admin/availability-v2':2*60*1000,
  '/api/admin/finance-statement':30*1000,
  '/api/admin/receita-saude':30*1000,
}
const PAYMENT_STATUS_TTL=15000
const AUTH_STATE_PATHS=new Set(['/api/me','/api/admin/me'])
let adminWarmScheduled=false

function sameOriginUrl(input:RequestInfo|URL){
  try{
    const raw=typeof input==='string'?input:input instanceof URL?input.toString():input.url
    return new URL(raw,window.location.origin)
  }catch{return null}
}

function ttlFor(path:string){
  if(TTL[path])return TTL[path]
  if(path.startsWith('/api/availability?'))return TTL['/api/availability']
  if(path.startsWith('/api/admin/availability-v2?'))return TTL['/api/admin/availability-v2']
  if(path.startsWith('/api/admin/finance-statement?'))return TTL['/api/admin/finance-statement']
  if(path.startsWith('/api/payments/status/'))return PAYMENT_STATUS_TTL
  return 0
}

function cacheKey(url:URL){return `${url.pathname}${url.search}`}
function responseFrom(entry:CacheEntry){return new Response(entry.body,{status:entry.status,statusText:entry.statusText,headers:new Headers(entry.headers)})}
function clearPortalCache(){cache.clear();pending.clear();adminWarmScheduled=false}

function warmAdminData(){
  if(adminWarmScheduled||!window.location.pathname.startsWith('/admin'))return
  adminWarmScheduled=true
  window.setTimeout(()=>{
    const paths=['/api/admin/appointments','/api/admin/patients','/api/admin/settings']
    paths.forEach(path=>void window.fetch(path,{credentials:'include'}).catch(()=>{}))
  },60)
}

export function installD1FetchCache(){
  if((window as any).__d1FetchCacheInstalled)return
  ;(window as any).__d1FetchCacheInstalled=true

  window.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=sameOriginUrl(input)
    if(!url||url.origin!==window.location.origin)return originalFetch(input as any,init)

    const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase()
    const path=url.pathname

    if(method!=='GET'){
      const response=await originalFetch(input as any,init)
      if(path.startsWith('/api/auth/')||path.startsWith('/api/admin/login')||path.startsWith('/api/admin/logout'))clearPortalCache()
      else if(response.ok&&path.startsWith('/api/'))clearPortalCache()
      return response
    }

    if(AUTH_STATE_PATHS.has(path)){
      const response=await originalFetch(input as any,{...init,cache:'no-store'})
      if(path==='/api/admin/me'&&response.ok)warmAdminData()
      return response
    }

    if(init?.cache==='no-store'||path==='/api/admin/clinical-vault'||/^\/api\/admin\/patients\/\d+$/.test(path)){
      return originalFetch(input as any,{...init,cache:'no-store'})
    }

    const ttl=ttlFor(`${path}${url.search}`)||ttlFor(path)
    if(!ttl)return originalFetch(input as any,init)

    const key=cacheKey(url)
    const hit=cache.get(key)
    if(hit&&hit.expires>Date.now())return responseFrom(hit)

    const active=pending.get(key)
    if(active)return responseFrom(await active)

    const task=(async()=>{
      const response=await originalFetch(input as any,{...init,cache:'no-store'})
      const body=await response.clone().text()
      const entry:CacheEntry={expires:Date.now()+ttl,status:response.status,statusText:response.statusText,headers:[...response.headers.entries()],body}
      if(response.ok)cache.set(key,entry)
      return entry
    })()
    pending.set(key,task)
    try{return responseFrom(await task)}finally{pending.delete(key)}
  }) as typeof window.fetch
}
