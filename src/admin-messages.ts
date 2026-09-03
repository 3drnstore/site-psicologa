import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const ADMIN_COOKIE='ps_admin_session'
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const now=()=>new Date().toISOString()

async function adminFromRequest(request:Request,env:Env){
  const token=readCookie(request,ADMIN_COOKIE)
  if(!token)return null
  return env.DB.prepare(`SELECT a.id,a.role FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),now()).first<any>()
}

export async function handleAdminMessages(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/admin/messages'&&!/^\/api\/admin\/messages\/\d+$/.test(path))return null
  const admin=await adminFromRequest(request,env)
  if(!admin)return json({ok:false,message:'Acesso profissional necessário.'},401)

  if(path==='/api/admin/messages'&&request.method==='GET'){
    const result=await env.DB.prepare(`SELECT id,name,email,phone,message,status,created_at FROM contact_messages ORDER BY CASE WHEN status='new' THEN 0 ELSE 1 END,created_at DESC LIMIT 250`).all<any>()
    return json({ok:true,messages:result.results||[]})
  }

  const match=path.match(/^\/api\/admin\/messages\/(\d+)$/)
  if(match&&request.method==='PATCH'){
    const id=Number(match[1])
    const body=await request.json().catch(()=>({})) as any
    const status=String(body.status||'read')
    if(!['new','read'].includes(status))return json({ok:false,message:'Status inválido.'},400)
    const result=await env.DB.prepare('UPDATE contact_messages SET status=? WHERE id=?').bind(status,id).run()
    if(!result.meta.changes)return json({ok:false,message:'Mensagem não encontrada.'},404)
    return json({ok:true,status})
  }

  return json({ok:false,message:'Método não permitido.'},405)
}
