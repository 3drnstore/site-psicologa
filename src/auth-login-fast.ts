import { cookie, randomToken, readCookie, sha256, verifyPassword } from './auth'
import { adminSecurityConfig, checkAdminLoginGuard, clearAdminAccountFailures, recordAdminLoginFailure, verifyTurnstile } from './admin-login-protection'
import type { Env } from './types'

const PATIENT_COOKIE='ps_session'
const ADMIN_COOKIE='ps_admin_session'
const SESSION_SECONDS=60*60*24*14
const NO_STORE={'cache-control':'no-store, no-cache, must-revalidate','pragma':'no-cache'}
const json=(data:unknown,status=200,headers:HeadersInit={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8',...NO_STORE,...headers}})
const now=()=>new Date().toISOString()
const expires=()=>new Date(Date.now()+SESSION_SECONDS*1000).toISOString()

async function body(request:Request){try{return await request.json() as Record<string,any>}catch{return {}}}

export async function handleAuthLoginFast(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path==='/api/admin/security-config'&&request.method==='GET')return json({ok:true,...adminSecurityConfig(env)})

  if(path==='/api/auth/login'&&request.method==='POST'){
    try{
      const b=await body(request)
      const email=String(b.email||'').trim().toLowerCase()
      const password=String(b.password||'')
      const patient=await env.DB.prepare('SELECT id,full_name,email,password_hash,password_salt FROM patients WHERE email=?').bind(email).first<any>()
      if(!patient?.password_hash||!patient?.password_salt||!(await verifyPassword(password,patient.password_salt,patient.password_hash)))return json({ok:false,message:'E-mail ou senha inválidos.'},401)
      const token=randomToken(),tokenHash=await sha256(token)
      await env.DB.prepare('INSERT INTO sessions (id,patient_id,token_hash,expires_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),Number(patient.id),tokenHash,expires()).run()
      return json({ok:true,patient:{id:patient.id,full_name:patient.full_name,email:patient.email}},200,{'set-cookie':cookie(PATIENT_COOKIE,token,SESSION_SECONDS)})
    }catch(error){
      const detail=error instanceof Error?error.message:String(error)
      console.error('Fast patient login error:',detail)
      return json({ok:false,message:'Não foi possível entrar agora. Tente novamente em alguns minutos.'},503)
    }
  }

  if(path==='/api/admin/login'&&request.method==='POST'){
    try{
      const b=await body(request)
      const email=String(b.email||'').trim().toLowerCase()
      const password=String(b.password||'')
      const guard=await checkAdminLoginGuard(request,env,email)
      if(!guard.allowed)return json({ok:false,message:'Muitas tentativas de acesso. Aguarde antes de tentar novamente.',retry_after:guard.retryAfter},429,{'retry-after':String(guard.retryAfter||60)})

      const turnstile=await verifyTurnstile(request,env,String(b.turnstile_token||''))
      if(!turnstile.ok)return json({ok:false,message:'Confirme a verificação de segurança para continuar.',turnstile_required:true},403)

      const admin=await env.DB.prepare('SELECT id,email,display_name,role,password_hash,password_salt,active FROM admin_users WHERE email=?').bind(email).first<any>()
      if(!admin||Number(admin.active)!==1||!admin.password_hash||!admin.password_salt||!(await verifyPassword(password,admin.password_salt,admin.password_hash))){
        await recordAdminLoginFailure(env,guard.ipKey!,guard.accountKey!)
        return json({ok:false,message:'E-mail ou senha inválidos.'},401)
      }
      await clearAdminAccountFailures(env,guard.accountKey!)
      const token=randomToken(),tokenHash=await sha256(token)
      await env.DB.prepare('INSERT INTO admin_sessions (id,admin_user_id,token_hash,expires_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),String(admin.id),tokenHash,expires()).run()
      return json({ok:true,admin:{id:admin.id,email:admin.email,display_name:admin.display_name,role:admin.role}},200,{'set-cookie':cookie(ADMIN_COOKIE,token,SESSION_SECONDS)})
    }catch(error){
      const detail=error instanceof Error?error.message:String(error)
      console.error('Fast admin login error:',detail)
      return json({ok:false,message:'O acesso profissional está temporariamente indisponível. Tente novamente em alguns minutos.'},503)
    }
  }

  if(path==='/api/me'&&request.method==='GET'){
    try{
      const token=readCookie(request,PATIENT_COOKIE)
      if(!token)return json({ok:false,message:'Faça login para continuar.'},401)
      const patient=await env.DB.prepare(`SELECT p.id,p.full_name,p.birth_date,p.cpf,p.phone,p.email,p.email_verified FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token),now()).first<any>()
      return patient?json({ok:true,patient}):json({ok:false,message:'Sessão expirada.'},401)
    }catch(error){
      const detail=error instanceof Error?error.message:String(error)
      console.error('Patient session restore error:',detail)
      return json({ok:false,message:'Não foi possível validar sua sessão agora.'},503)
    }
  }

  if(path==='/api/admin/me'&&request.method==='GET'){
    try{
      const token=readCookie(request,ADMIN_COOKIE)
      if(!token)return json({ok:false,message:'Acesso profissional necessário.'},401)
      const admin=await env.DB.prepare(`SELECT a.id,a.email,a.display_name,a.role FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),now()).first<any>()
      return admin?json({ok:true,admin}):json({ok:false,message:'Sessão expirada.'},401)
    }catch(error){
      const detail=error instanceof Error?error.message:String(error)
      console.error('Admin session restore error:',detail)
      return json({ok:false,message:'Não foi possível validar a sessão profissional agora.'},503)
    }
  }

  return null
}
