type CacheEntry={expires:number,status:number,statusText:string,headers:[string,string][],body:string}
type PendingEntry=Promise<CacheEntry>

const originalFetch=window.fetch.bind(window)
const cache=new Map<string,CacheEntry>()
const pending=new Map<string,PendingEntry>()

const TTL:Record<string,number>={
  '/api/me':60000,
  '/api/admin/me':60000,
  '/api/availability':60000,
  '/api/appointments/mine':60000,
  '/api/admin/appointments':30000,
  '/api/admin/patients':60000,
  '/api/admin/settings':60000,
  '/api/admin/availability-v2':30000,
}
const ERROR_TTL=5000

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
  return 0
}

function cacheKey(url:URL){return `${url.pathname}${url.search}`}
function responseFrom(entry:CacheEntry){return new Response(entry.body,{status:entry.status,statusText:entry.statusText,headers:new Headers(entry.headers)})}
function clearPortalCache(){cache.clear();pending.clear()}

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
      if(response.ok&&path.startsWith('/api/'))clearPortalCache()
      return response
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
      const entry:CacheEntry={expires:Date.now()+(response.ok?ttl:ERROR_TTL),status:response.status,statusText:response.statusText,headers:[...response.headers.entries()],body}
      cache.set(key,entry)
      return entry
    })()
    pending.set(key,task)
    try{return responseFrom(await task)}finally{pending.delete(key)}
  }) as typeof window.fetch
}
