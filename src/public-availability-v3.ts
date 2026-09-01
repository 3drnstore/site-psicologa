import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()

async function patient(request:Request,env:Env){
  const token=readCookie(request,'ps_session')
  if(!token)return null
  return env.DB.prepare(`SELECT p.id FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token),nowIso()).first<any>()
}

async function tableExists(env:Env,name:string){
  return Boolean(await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(name).first<any>())
}

async function releaseExpired(env:Env){
  if(!(await tableExists(env,'appointments')))return
  const rows=await env.DB.prepare(`SELECT id,availability_id FROM appointments WHERE status='pending_payment' AND reserved_until IS NOT NULL AND reserved_until < ?`).bind(nowIso()).all<any>()
  for(const row of rows.results||[]){
    await env.DB.batch([
      env.DB.prepare(`UPDATE appointments SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending_payment'`).bind(row.id),
      env.DB.prepare(`UPDATE availability SET status='free',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='held'`).bind(row.availability_id),
    ])
  }
}

export async function handlePublicAvailabilityV3(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/availability'||request.method!=='GET')return null
  const p=await patient(request,env)
  if(!p)return json({ok:false,message:'Faça login para continuar.'},401)
  await releaseExpired(env)
  const url=new URL(request.url)
  const from=url.searchParams.get('from')||nowIso()
  const to=url.searchParams.get('to')||new Date(Date.now()+60*86400000).toISOString()
  const result=await env.DB.prepare(`
    SELECT id,starts_at,ends_at,status,
      CASE
        WHEN status='free' THEN 'free'
        WHEN status='blocked' THEN 'blocked'
        ELSE 'occupied'
      END AS public_status
    FROM availability
    WHERE COALESCE(public_visibility,'visible')='visible' AND starts_at>=? AND starts_at<=?
    ORDER BY starts_at ASC
  `).bind(from,to).all<any>()
  const settings=await env.DB.prepare(`SELECT key,value FROM settings WHERE key IN ('consultation_price_cents','pix_discount_percent')`).all<any>()
  const map=Object.fromEntries((settings.results||[]).map((r:any)=>[r.key,r.value]))
  return json({ok:true,slots:result.results||[],consultation_price_cents:Number(map.consultation_price_cents||0),pix_discount_percent:Number(map.pix_discount_percent||0)})
}
