import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const now=()=>new Date().toISOString()

async function admin(request:Request,env:Env){
  const token=readCookie(request,'ps_admin_session');if(!token)return null
  return env.DB.prepare(`SELECT a.id FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),now()).first<any>()
}

function range(date:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null
  const start=new Date(`${date}T00:00:00-03:00`)
  if(Number.isNaN(start.getTime()))return null
  const end=new Date(start.getTime()+24*60*60*1000)
  return{start:start.toISOString(),end:end.toISOString()}
}

export async function handleCancelledDayReconcile(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/admin/agenda/reconcile-cancelled-day'||request.method!=='POST')return null
  const a=await admin(request,env);if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
  const body=await request.json().catch(()=>({})) as any
  const date=String(body.date||'').trim(),r=range(date);if(!r)return json({ok:false,message:'Data inválida.'},400)
  const current=now()
  const slots=await env.DB.prepare(`SELECT id FROM availability WHERE starts_at>=? AND starts_at<? AND starts_at>=?`).bind(r.start,r.end,current).all<any>()
  const ids=(slots.results||[]).map((row:any)=>Number(row.id)).filter(Boolean)
  if(ids.length){
    const placeholders=ids.map(()=>'?').join(',')
    await env.DB.prepare(`UPDATE appointments SET status='cancelled',workflow_state='professional_cancelled',updated_at=CURRENT_TIMESTAMP WHERE availability_id IN (${placeholders}) AND status='pending_payment'`).bind(...ids).run()
    await env.DB.prepare(`UPDATE availability SET status='blocked',public_visibility='visible',source='professional_cancelled',recurring_block_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).bind(...ids).run()
  }
  return json({ok:true,date,blocked_slots:ids.length})
}
