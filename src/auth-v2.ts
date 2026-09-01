import { clearCookie, cookie, hashPassword, randomToken, readCookie, sha256, verifyPassword } from './auth'
import type { Env } from './types'

const ADMIN_COOKIE='ps_admin_session', PATIENT_COOKIE='ps_session', SESSION_SECONDS=60*60*24*14
const json=(data:unknown,status=200,headers:HeadersInit={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8',...headers}})
const now=()=>new Date().toISOString()
const expires=(minutes:number)=>new Date(Date.now()+minutes*60000).toISOString()

async function data(request:Request){try{return await request.json() as Record<string,any>}catch{return {}}}

async function ensureAuthSchema(env:Env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, admin_user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, patient_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS password_reset_tokens (id TEXT PRIMARY KEY, account_type TEXT NOT NULL, account_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()
}

async function sendResetEmail(env:Env,email:string,link:string){
  if(!env.RESEND_API_KEY || !env.EMAIL_FROM) return false
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({from:env.EMAIL_FROM,to:[email],subject:'Recuperação de senha — PsicoGestão',html:`<p>Recebemos uma solicitação para redefinir sua senha.</p><p><a href="${link}">Clique aqui para criar uma nova senha</a>.</p><p>Este link expira em 30 minutos. Se você não fez a solicitação, ignore este e-mail.</p>`})})
  return r.ok
}

export async function handleAuthV2(request:Request,env:Env,path:string):Promise<Response|null>{
  const handled=['/api/admin/login','/api/admin/logout','/api/admin/me','/api/password/forgot','/api/password/reset']
  if(!handled.includes(path)) return null
  await ensureAuthSchema(env)

  if(path==='/api/admin/login' && request.method==='POST'){
    const b=await data(request), email=String(b.email||'').trim().toLowerCase(), password=String(b.password||'')
    const admin=await env.DB.prepare('SELECT id,email,display_name,role,password_hash,password_salt,active FROM admin_users WHERE email=?').bind(email).first<any>()
    if(!admin || Number(admin.active)!==1 || !admin.password_hash || !admin.password_salt || !(await verifyPassword(password,admin.password_salt,admin.password_hash))) return json({ok:false,message:'E-mail ou senha inválidos.'},401)
    const token=randomToken(), tokenHash=await sha256(token)
    await env.DB.prepare('INSERT INTO admin_sessions (id,admin_user_id,token_hash,expires_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),admin.id,tokenHash,new Date(Date.now()+SESSION_SECONDS*1000).toISOString()).run()
    return json({ok:true,admin:{id:admin.id,email:admin.email,display_name:admin.display_name,role:admin.role}},200,{'set-cookie':cookie(ADMIN_COOKIE,token,SESSION_SECONDS)})
  }

  if(path==='/api/admin/me' && request.method==='GET'){
    const token=readCookie(request,ADMIN_COOKIE); if(!token)return json({ok:false,message:'Acesso profissional necessário.'},401)
    const admin=await env.DB.prepare(`SELECT a.id,a.email,a.display_name,a.role FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),now()).first<any>()
    return admin?json({ok:true,admin}):json({ok:false,message:'Sessão expirada.'},401)
  }

  if(path==='/api/admin/logout' && request.method==='POST'){
    const token=readCookie(request,ADMIN_COOKIE);if(token)await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await sha256(token)).run()
    return json({ok:true},200,{'set-cookie':clearCookie(ADMIN_COOKIE)})
  }

  if(path==='/api/password/forgot' && request.method==='POST'){
    const b=await data(request), email=String(b.email||'').trim().toLowerCase(), type=b.account_type==='admin'?'admin':'patient'
    const row=type==='admin'?await env.DB.prepare('SELECT id,email FROM admin_users WHERE email=? AND active=1').bind(email).first<any>():await env.DB.prepare('SELECT id,email FROM patients WHERE email=?').bind(email).first<any>()
    if(row){
      const token=randomToken(32), hash=await sha256(token)
      await env.DB.prepare('DELETE FROM password_reset_tokens WHERE account_type=? AND account_id=? AND used_at IS NULL').bind(type,String(row.id)).run()
      await env.DB.prepare('INSERT INTO password_reset_tokens (id,account_type,account_id,token_hash,expires_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),type,String(row.id),hash,expires(30)).run()
      const origin=env.APP_ORIGIN||new URL(request.url).origin
      const sent=await sendResetEmail(env,row.email,`${origin}/recuperar-senha?token=${encodeURIComponent(token)}&tipo=${type}`)
      if(!sent && (!env.RESEND_API_KEY || !env.EMAIL_FROM)) return json({ok:false,message:'A recuperação por e-mail ainda precisa ser ativada no servidor.'},503)
    }
    return json({ok:true,message:'Se o e-mail estiver cadastrado, enviaremos um link de recuperação.'})
  }

  if(path==='/api/password/reset' && request.method==='POST'){
    const b=await data(request), token=String(b.token||''), password=String(b.password||'')
    if(password.length<10)return json({ok:false,message:'A nova senha deve ter pelo menos 10 caracteres.'},400)
    const hash=await sha256(token)
    const reset=await env.DB.prepare('SELECT * FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?').bind(hash,now()).first<any>()
    if(!reset)return json({ok:false,message:'Link inválido ou expirado.'},400)
    const pwd=await hashPassword(password)
    if(reset.account_type==='admin'){
      await env.DB.prepare('UPDATE admin_users SET password_hash=?,password_salt=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(pwd.hash,pwd.salt,reset.account_id).run()
      await env.DB.prepare('DELETE FROM admin_sessions WHERE admin_user_id=?').bind(reset.account_id).run()
    }else{
      await env.DB.prepare('UPDATE patients SET password_hash=?,password_salt=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(pwd.hash,pwd.salt,Number(reset.account_id)).run()
      await env.DB.prepare('DELETE FROM sessions WHERE patient_id=?').bind(Number(reset.account_id)).run()
    }
    await env.DB.prepare('UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=?').bind(reset.id).run()
    return json({ok:true,message:'Senha alterada com sucesso.'})
  }
  return null
}
