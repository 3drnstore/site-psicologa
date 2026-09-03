import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const ADMIN_COOKIE='ps_admin_session'
const now=()=>new Date().toISOString()

export type AdminSessionIdentity={id:string;email:string;display_name:string;role:string;session_id:string}

export async function readAdminSession(request:Request,env:Env):Promise<AdminSessionIdentity|null>{
  const token=readCookie(request,ADMIN_COOKIE)
  if(!token)return null
  const tokenHash=await sha256(token)

  // Caminho novo: somente leitura. Nunca executa DDL/migração durante validação de sessão.
  try{
    const session=await env.DB.prepare(`SELECT id,admin_user_id,admin_email,admin_display_name,admin_role FROM admin_sessions WHERE token_hash=? AND expires_at>?`).bind(tokenHash,now()).first<any>()
    if(session?.admin_user_id&&session?.admin_email&&session?.admin_display_name&&session?.admin_role){
      return {id:String(session.admin_user_id),email:String(session.admin_email),display_name:String(session.admin_display_name),role:String(session.admin_role),session_id:String(session.id)}
    }
  }catch(error){
    // Banco ainda sem as colunas snapshot: usa a estrutura anterior abaixo.
    console.warn('Admin session snapshot unavailable; using legacy reader:',error instanceof Error?error.message:String(error))
  }

  // Compatibilidade imediata com sessões/bancos anteriores ao snapshot.
  const legacy=await env.DB.prepare(`SELECT a.id,a.email,a.display_name,a.role,s.id AS session_id FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(tokenHash,now()).first<any>()
  return legacy?{id:String(legacy.id),email:String(legacy.email),display_name:String(legacy.display_name),role:String(legacy.role),session_id:String(legacy.session_id)}:null
}
