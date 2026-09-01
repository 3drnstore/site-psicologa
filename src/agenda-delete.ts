import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const now=()=>new Date().toISOString()

async function admin(request:Request,env:Env){
  const token=readCookie(request,'ps_admin_session');if(!token)return null
  return env.DB.prepare(`SELECT a.id FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`)
    .bind(await sha256(token),now()).first<any>()
}
async function tableExists(env:Env,name:string){
  return Boolean(await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(name).first<any>())
}

export async function handleAgendaDelete(request:Request,env:Env,path:string):Promise<Response|null>{
  const m=path.match(/^\/api\/admin\/availability\/(\d+)$/)
  if(!m || request.method!=='DELETE')return null
  const a=await admin(request,env);if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
  const id=Number(m[1]);const slot=await env.DB.prepare('SELECT id,status FROM availability WHERE id=?').bind(id).first<any>()
  if(!slot)return json({ok:false,message:'Horário não encontrado.'},404)
  if(['held','confirmed'].includes(String(slot.status)))return json({ok:false,message:'Horários reservados ou confirmados não podem ser excluídos. Cancele ou altere a consulta antes.'},409)
  if(await tableExists(env,'appointments')){
    const linked=await env.DB.prepare(`SELECT id FROM appointments WHERE availability_id=? AND status IN ('pending_payment','confirmed') LIMIT 1`).bind(id).first<any>()
    if(linked)return json({ok:false,message:'Este horário possui uma consulta vinculada e não pode ser excluído.'},409)
  }
  await env.DB.prepare('DELETE FROM availability WHERE id=?').bind(id).run()
  return json({ok:true,message:'Horário excluído.'})
}
