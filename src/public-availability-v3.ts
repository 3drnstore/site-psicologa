import { readCookie, sha256 } from './auth'
import { pricingForOrigin } from './platform-pricing'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()
const defaultFrom=()=>new Date(Date.now()-7*86400000).toISOString()
let lastExpiredCleanupAt=0
let cleanupRunning:Promise<void>|null=null
const EXPIRED_CLEANUP_INTERVAL=15*60_000

async function patient(request:Request,env:Env){const token=readCookie(request,'ps_session');if(!token)return null;return env.DB.prepare(`SELECT p.id,p.pricing_origin FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token),nowIso()).first<any>()}
async function releaseExpired(env:Env){const now=Date.now();if(now-lastExpiredCleanupAt<EXPIRED_CLEANUP_INTERVAL)return;if(cleanupRunning)return cleanupRunning;cleanupRunning=(async()=>{try{const cutoff=nowIso();await env.DB.batch([env.DB.prepare(`UPDATE availability SET status='free',updated_at=CURRENT_TIMESTAMP WHERE status='held' AND id IN (SELECT availability_id FROM appointments WHERE status='pending_payment' AND reserved_until IS NOT NULL AND reserved_until < ?)` ).bind(cutoff),env.DB.prepare(`UPDATE appointments SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE status='pending_payment' AND reserved_until IS NOT NULL AND reserved_until < ?`).bind(cutoff)]);lastExpiredCleanupAt=Date.now()}catch(error){console.warn('Expired reservation cleanup skipped:',error instanceof Error?error.message:String(error));lastExpiredCleanupAt=Date.now()}finally{cleanupRunning=null}})();return cleanupRunning}

export async function handlePublicAvailabilityV3(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/availability'||request.method!=='GET')return null
  const p=await patient(request,env);if(!p)return json({ok:false,message:'Faça login para continuar.'},401)
  await releaseExpired(env)
  const url=new URL(request.url),from=url.searchParams.get('from')||defaultFrom(),to=url.searchParams.get('to')||new Date(Date.now()+60*86400000).toISOString()
  const result=await env.DB.prepare(`SELECT id,starts_at,ends_at,status,CASE WHEN status='free' THEN 'free' WHEN status='blocked' THEN 'blocked' ELSE 'occupied' END AS public_status FROM availability WHERE public_visibility='visible' AND starts_at>=? AND starts_at<=? ORDER BY starts_at ASC`).bind(from,to).all<any>()
  const pricing=await pricingForOrigin(env,p.pricing_origin,'card')
  return json({ok:true,slots:result.results||[],...pricing})
}
