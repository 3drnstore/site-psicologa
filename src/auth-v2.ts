import { clearCookie, cookie, hashPassword, randomToken, readCookie, sha256, verifyPassword } from './auth'
import type { Env } from './types'

const ADMIN_COOKIE='ps_admin_session', PATIENT_COOKIE='ps_session', SESSION_SECONDS=60*60*24*14
const json=(data:unknown,status=200,headers:HeadersInit={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8',...headers}})
const now=()=>new Date().toISOString()
const expires=(minutes:number)=>new Date(Date.now()+minutes*60000).toISOString()
const digits=(value:string)=>value.replace(/\D/g,'')

async function data(request:Request){try{return await request.json() as Record<string,any>}catch{return {}}}

async function ensurePatientSessionSchema(env:Env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    patient_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()
}

async function ensureAuthSchema(env:Env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    birth_date TEXT NOT NULL,
    cpf TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    password_salt TEXT,
    google_sub TEXT UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()
  await ensurePatientSessionSchema(env)
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, admin_user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS password_reset_tokens (id TEXT PRIMARY KEY, account_type TEXT NOT NULL, account_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()
}

async function createPatientSession(env:Env,patientId:number){
  await ensurePatientSessionSchema(env)
  const token=randomToken(), tokenHash=await sha256(token)
  await env.DB.prepare('INSERT INTO sessions (id,patient_id,token_hash,expires_at) VALUES (?,?,?,?)')
    .bind(crypto.randomUUID(),patientId,tokenHash,new Date(Date.now()+SESSION_SECONDS*1000).toISOString()).run()
  return token
}

async function patientFromRequest(request:Request,env:Env){
  await ensurePatientSessionSchema(env)
  const token=readCookie(request,PATIENT_COOKIE)
  if(!token)return null
  return env.DB.prepare(`SELECT p.id,p.full_name,p.birth_date,p.cpf,p.phone,p.email,p.email_verified
    FROM sessions s JOIN patients p ON p.id=s.patient_id
    WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(await sha256(token),now()).first<any>()
}

async function patientCredentials(env:Env,id:number){
  return env.DB.prepare('SELECT id,password_hash,password_salt FROM patients WHERE id=?').bind(id).first<any>()
}

async function sendResetEmail(env:Env,email:string,link:string){
  if(!env.RESEND_API_KEY || !env.EMAIL_FROM) return false
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({from:env.EMAIL_FROM,to:[email],subject:'Recuperação de senha — PsicoGestão',html:`<p>Recebemos uma solicitação para redefinir sua senha.</p><p><a href="${link}">Clique aqui para criar uma nova senha</a>.</p><p>Este link expira em 30 minutos. Se você não fez a solicitação, ignore este e-mail.</p>`})})
  return r.ok
}

export async function handleAuthV2(request:Request,env:Env,path:string):Promise<Response|null>{
  const handled=['/api/auth/register','/api/auth/login','/api/auth/logout','/api/me','/api/me/profile','/api/me/email','/api/me/password','/api/admin/login','/api/admin/logout','/api/admin/me','/api/password/forgot','/api/password/reset']
  if(!handled.includes(path)) return null

  if(path==='/api/auth/login' && request.method==='POST'){
    try{
      await ensurePatientSessionSchema(env)
      const b=await data(request), email=String(b.email||'').trim().toLowerCase(), password=String(b.password||'')
      const patient=await env.DB.prepare('SELECT id,full_name,email,password_hash,password_salt FROM patients WHERE email=?').bind(email).first<any>()
      if(!patient?.password_hash||!patient?.password_salt||!(await verifyPassword(password,patient.password_salt,patient.password_hash)))return json({ok:false,message:'E-mail ou senha inválidos.'},401)
      const token=await createPatientSession(env,Number(patient.id))
      return json({ok:true,patient:{id:patient.id,full_name:patient.full_name,email:patient.email}},200,{'set-cookie':cookie(PATIENT_COOKIE,token,SESSION_SECONDS)})
    }catch(error){
      const detail=error instanceof Error?error.message:String(error)
      console.error('Patient login error:',detail)
      return json({ok:false,message:`Não foi possível entrar. Detalhe: ${detail}`,detail},500)
    }
  }

  if(path==='/api/me' && request.method==='GET'){
    try{const patient=await patientFromRequest(request,env);return patient?json({ok:true,patient}):json({ok:false,message:'Faça login para continuar.'},401)}
    catch(error){const detail=error instanceof Error?error.message:String(error);console.error('Patient me error:',detail);return json({ok:false,message:`Não foi possível restaurar sua sessão. Detalhe: ${detail}`,detail},500)}
  }

  await ensureAuthSchema(env)

  if(path==='/api/auth/register' && request.method==='POST'){
    try{
      const b=await data(request)
      const fullName=String(b.full_name||'').trim(), birthDate=String(b.birth_date||'').trim(), cpf=digits(String(b.cpf||'')), phone=digits(String(b.phone||'')), email=String(b.email||'').trim().toLowerCase(), password=String(b.password||'')
      if(!fullName||!birthDate||cpf.length!==11||phone.length<10||!email.includes('@')||password.length<8)return json({ok:false,message:'Preencha corretamente todos os campos. A senha deve ter pelo menos 8 caracteres.'},400)
      const existing=await env.DB.prepare('SELECT id,email,cpf FROM patients WHERE email=? OR cpf=?').bind(email,cpf).first<any>()
      if(existing)return json({ok:false,message:'Já existe um cadastro com este e-mail ou CPF.'},409)
      const pwd=await hashPassword(password)
      const result=await env.DB.prepare(`INSERT INTO patients (full_name,birth_date,cpf,phone,email,password_hash,password_salt) VALUES (?,?,?,?,?,?,?)`).bind(fullName,birthDate,cpf,phone,email,pwd.hash,pwd.salt).run()
      const patientId=Number(result.meta.last_row_id), token=await createPatientSession(env,patientId)
      return json({ok:true,patient:{id:patientId,full_name:fullName,email}},201,{'set-cookie':cookie(PATIENT_COOKIE,token,SESSION_SECONDS)})
    }catch(error){const detail=error instanceof Error?error.message:String(error);console.error('Patient register error:',detail);return json({ok:false,message:'Não foi possível criar o cadastro do paciente.',detail},500)}
  }

  if(path==='/api/auth/logout' && request.method==='POST'){
    const token=readCookie(request,PATIENT_COOKIE);if(token)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run()
    return json({ok:true},200,{'set-cookie':clearCookie(PATIENT_COOKIE)})
  }

  if(path==='/api/me/profile' && request.method==='PATCH'){
    const patient=await patientFromRequest(request,env);if(!patient)return json({ok:false,message:'Faça login para continuar.'},401)
    const b=await data(request), fullName=String(b.full_name||'').trim(), birthDate=String(b.birth_date||'').trim(), phone=digits(String(b.phone||''))
    if(!fullName||!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)||phone.length<10)return json({ok:false,message:'Confira nome, data de nascimento e telefone.'},400)
    await env.DB.prepare('UPDATE patients SET full_name=?,birth_date=?,phone=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(fullName,birthDate,phone,patient.id).run()
    return json({ok:true,message:'Dados atualizados.'})
  }

  if(path==='/api/me/email' && request.method==='PATCH'){
    const patient=await patientFromRequest(request,env);if(!patient)return json({ok:false,message:'Faça login para continuar.'},401)
    const b=await data(request), email=String(b.email||'').trim().toLowerCase(), currentPassword=String(b.current_password||'')
    if(!email.includes('@'))return json({ok:false,message:'Informe um e-mail válido.'},400)
    const creds=await patientCredentials(env,patient.id)
    if(!creds?.password_hash||!creds?.password_salt)return json({ok:false,message:'Defina uma senha antes de alterar o e-mail.'},409)
    if(!(await verifyPassword(currentPassword,creds.password_salt,creds.password_hash)))return json({ok:false,message:'Senha atual incorreta.'},401)
    const exists=await env.DB.prepare('SELECT id FROM patients WHERE email=? AND id<>?').bind(email,patient.id).first<any>()
    if(exists)return json({ok:false,message:'Este e-mail já está em uso.'},409)
    await env.DB.prepare('UPDATE patients SET email=?,email_verified=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(email,patient.id).run()
    return json({ok:true,message:'E-mail atualizado.'})
  }

  if(path==='/api/me/password' && request.method==='PATCH'){
    const patient=await patientFromRequest(request,env);if(!patient)return json({ok:false,message:'Faça login para continuar.'},401)
    const b=await data(request), currentPassword=String(b.current_password||''), newPassword=String(b.new_password||'')
    if(newPassword.length<10)return json({ok:false,message:'A nova senha deve ter pelo menos 10 caracteres.'},400)
    const creds=await patientCredentials(env,patient.id)
    if(!creds?.password_hash||!creds?.password_salt)return json({ok:false,message:'Use a recuperação de senha para definir sua primeira senha.'},409)
    if(!(await verifyPassword(currentPassword,creds.password_salt,creds.password_hash)))return json({ok:false,message:'Senha atual incorreta.'},401)
    const pwd=await hashPassword(newPassword)
    await env.DB.prepare('UPDATE patients SET password_hash=?,password_salt=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(pwd.hash,pwd.salt,patient.id).run()
    return json({ok:true,message:'Senha alterada com sucesso.'})
  }

  if(path==='/api/admin/login' && request.method==='POST'){
    const b=await data(request), email=String(b.email||'').trim().toLowerCase(), password=String(b.password||'')
    const admin=await env.DB.prepare('SELECT id,email,display_name,role,password_hash,password_salt,active FROM admin_users WHERE email=?').bind(email).first<any>()
    if(!admin || Number(admin.active)!==1 || !admin.password_hash || !admin.password_salt || !(await verifyPassword(password,admin.password_salt,admin.password_hash))) return json({ok:false,message:'E-mail ou senha inválidos.'},401)
    const token=randomToken(), tokenHash=await sha256(token)
    await env.DB.prepare('INSERT INTO admin_sessions (id,admin_user_id,token_hash,expires_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),admin.id,tokenHash,new Date(Date.now()+SESSION_SECONDS*1000).toISOString()).run()
    return json({ok:true,admin:{id:admin.id,email:admin.email,display_name:admin.display_name,role:admin.role}},200,{'set-cookie':cookie(ADMIN_COOKIE,token,SESSION_SECONDS)})
  }

  if(path==='/api/admin/me' && request.method==='GET'){
    const token=readCookie(request,ADMIN_COOKIE);if(!token)return json({ok:false,message:'Acesso profissional necessário.'},401)
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
      await env.DB.prepare('UPDATE admin_users SET password_hash=?,password_salt=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(pwd.hash,pwd.salt,reset.account_id).run();await env.DB.prepare('DELETE FROM admin_sessions WHERE admin_user_id=?').bind(reset.account_id).run()
    }else{
      await env.DB.prepare('UPDATE patients SET password_hash=?,password_salt=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(pwd.hash,pwd.salt,Number(reset.account_id)).run();await env.DB.prepare('DELETE FROM sessions WHERE patient_id=?').bind(Number(reset.account_id)).run()
    }
    await env.DB.prepare('UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=?').bind(reset.id).run()
    return json({ok:true,message:'Senha alterada com sucesso.'})
  }
  return null
}
