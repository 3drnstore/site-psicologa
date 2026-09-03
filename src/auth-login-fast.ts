import { cookie, randomToken, readCookie, sha256, verifyPassword } from './auth'
import { verifyTotp } from './totp'
import { adminSecurityConfig, checkAdminLoginGuard, clearAdminAccountFailures, recordAdminLoginFailure, verifyTurnstile } from './admin-login-protection'
import { ensureAdminAuthSchema } from './admin-auth-schema'
import type { Env } from './types'

const PATIENT_COOKIE='ps_session',ADMIN_COOKIE='ps_admin_session',SESSION_SECONDS=60*60*24*14,NO_STORE={'cache-control':'no-store, no-cache, must-revalidate','pragma':'no-cache'}
const json=(data:unknown,status=200,headers:HeadersInit={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8',...NO_STORE,...headers}})
const now=()=>new Date().toISOString(),expires=()=>new Date(Date.now()+SESSION_SECONDS*1000).toISOString()
async function body(request:Request){try{return await request.json() as Record<string,any>}catch{return {}}}
async function auditAdminLogin(env:Env,id:string){try{await env.DB.prepare(`INSERT INTO audit_log (id,actor_type,actor_id,action,entity_type) VALUES (?,'admin',?,'admin_login','admin_session')`).bind(crypto.randomUUID(),id).run()}catch{}}

async function safeGuard(request:Request,env:Env,email:string){
  try{return await checkAdminLoginGuard(request,env,email)}
  catch(error){
    console.error('Admin login guard unavailable:',error instanceof Error?error.message:String(error))
    return {allowed:true,ipKey:null,accountKey:null}
  }
}

async function adminFromSession(request:Request,env:Env){
  await ensureAdminAuthSchema(env)
  const token=readCookie(request,ADMIN_COOKIE)
  if(!token)return null
  const tokenHash=await sha256(token)
  const session=await env.DB.prepare(`SELECT id,admin_user_id,admin_email,admin_display_name,admin_role,expires_at FROM admin_sessions WHERE token_hash=? AND expires_at>?`).bind(tokenHash,now()).first<any>()
  if(!session)return null

  if(session.admin_email&&session.admin_display_name&&session.admin_role){
    return {id:String(session.admin_user_id),email:String(session.admin_email),display_name:String(session.admin_display_name),role:String(session.admin_role),session_id:String(session.id)}
  }

  const user=await env.DB.prepare('SELECT id,email,display_name,role,active FROM admin_users WHERE id=?').bind(String(session.admin_user_id)).first<any>()
  if(!user||Number(user.active)!==1){
    await env.DB.prepare('DELETE FROM admin_sessions WHERE id=?').bind(String(session.id)).run().catch(()=>{})
    return null
  }
  await env.DB.prepare('UPDATE admin_sessions SET admin_email=?,admin_display_name=?,admin_role=? WHERE id=?').bind(String(user.email),String(user.display_name),String(user.role),String(session.id)).run().catch(()=>{})
  return {id:String(user.id),email:String(user.email),display_name:String(user.display_name),role:String(user.role),session_id:String(session.id)}
}

export async function handleAuthLoginFast(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path==='/api/admin/security-config'&&request.method==='GET')return json({ok:true,...adminSecurityConfig(env)})

  if(path==='/api/auth/login'&&request.method==='POST'){
    try{
      const b=await body(request),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'')
      const p=await env.DB.prepare('SELECT id,full_name,email,password_hash,password_salt FROM patients WHERE email=?').bind(email).first<any>()
      if(!p?.password_hash||!p?.password_salt||!(await verifyPassword(password,p.password_salt,p.password_hash)))return json({ok:false,message:'E-mail ou senha inválidos.'},401)
      const token=randomToken()
      await env.DB.prepare('INSERT INTO sessions (id,patient_id,token_hash,expires_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),Number(p.id),await sha256(token),expires()).run()
      return json({ok:true,patient:{id:p.id,full_name:p.full_name,email:p.email}},200,{'set-cookie':cookie(PATIENT_COOKIE,token,SESSION_SECONDS)})
    }catch{return json({ok:false,message:'Não foi possível entrar agora.'},503)}
  }

  if(path==='/api/admin/login'&&request.method==='POST'){
    try{
      await ensureAdminAuthSchema(env)
      const b=await body(request),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'')
      const guard=await safeGuard(request,env,email)
      if(!guard.allowed)return json({ok:false,message:'Muitas tentativas de acesso. Aguarde antes de tentar novamente.'},429)
      const turnstile=await verifyTurnstile(request,env,String(b.turnstile_token||''))
      if(!turnstile.ok)return json({ok:false,message:'Confirme a verificação de segurança para continuar.',turnstile_required:true},403)

      const a=await env.DB.prepare('SELECT id,email,display_name,role,password_hash,password_salt,active,totp_secret,totp_enabled FROM admin_users WHERE email=?').bind(email).first<any>()
      const credentialsComplete=Boolean(a?.password_hash&&a?.password_salt)
      const passwordOk=credentialsComplete?await verifyPassword(password,String(a.password_salt),String(a.password_hash)):false
      if(!a||Number(a.active)!==1||!passwordOk){
        if(guard.ipKey&&guard.accountKey)try{await recordAdminLoginFailure(env,guard.ipKey,guard.accountKey)}catch(error){console.error('Admin failure guard:',error instanceof Error?error.message:String(error))}
        return json({ok:false,message:'E-mail ou senha inválidos.'},401)
      }

      if(Number(a.totp_enabled)===1){
        const code=String(b.totp_code||'')
        if(!code)return json({ok:false,message:'Digite o código do aplicativo autenticador.',two_factor_required:true},401)
        if(!a.totp_secret||!(await verifyTotp(String(a.totp_secret),code))){
          if(guard.ipKey&&guard.accountKey)try{await recordAdminLoginFailure(env,guard.ipKey,guard.accountKey)}catch(error){console.error('Admin 2FA guard:',error instanceof Error?error.message:String(error))}
          return json({ok:false,message:'Código de autenticação inválido.',two_factor_required:true},401)
        }
      }

      if(guard.accountKey)try{await clearAdminAccountFailures(env,guard.accountKey)}catch(error){console.error('Admin guard clear:',error instanceof Error?error.message:String(error))}
      const token=randomToken()
      await env.DB.prepare(`INSERT INTO admin_sessions (id,admin_user_id,token_hash,expires_at,admin_email,admin_display_name,admin_role) VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),String(a.id),await sha256(token),expires(),String(a.email),String(a.display_name),String(a.role)).run()
      await auditAdminLogin(env,String(a.id))
      return json({ok:true,admin:{id:a.id,email:a.email,display_name:a.display_name,role:a.role}},200,{'set-cookie':cookie(ADMIN_COOKIE,token,SESSION_SECONDS)})
    }catch(error){
      console.error('Admin login fatal:',error instanceof Error?error.message:String(error))
      return json({ok:false,message:'O acesso profissional está temporariamente indisponível.',diagnostic_code:'ADMIN_AUTH_RUNTIME'},503)
    }
  }

  if(path==='/api/me'&&request.method==='GET'){
    const token=readCookie(request,PATIENT_COOKIE)
    if(!token)return json({ok:false,message:'Faça login para continuar.'},401)
    const p=await env.DB.prepare('SELECT p.id,p.full_name,p.birth_date,p.cpf,p.phone,p.email,p.email_verified FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>?').bind(await sha256(token),now()).first<any>()
    return p?json({ok:true,patient:p}):json({ok:false,message:'Sessão expirada.'},401)
  }

  if(path==='/api/admin/me'&&request.method==='GET'){
    try{
      const a=await adminFromSession(request,env)
      return a?json({ok:true,admin:{id:a.id,email:a.email,display_name:a.display_name,role:a.role}}):json({ok:false,message:'Sessão expirada.'},401)
    }catch(error){
      console.error('Admin session validation fatal:',error instanceof Error?error.message:String(error))
      return json({ok:false,message:'O acesso profissional está temporariamente indisponível.',diagnostic_code:'ADMIN_SESSION_RUNTIME'},503)
    }
  }
  return null
}
