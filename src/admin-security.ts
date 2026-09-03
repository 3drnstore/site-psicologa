import { clearCookie, hashPassword, readCookie, sha256, verifyPassword } from './auth'
import type { Env } from './types'

const ADMIN_COOKIE='ps_admin_session'
const json=(data:unknown,status=200,headers:HeadersInit={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8',...headers}})
const now=()=>new Date().toISOString()

async function body(request:Request){try{return await request.json() as Record<string,any>}catch{return {}}}

async function currentAdmin(request:Request,env:Env){
  const token=readCookie(request,ADMIN_COOKIE)
  if(!token)return null
  return env.DB.prepare(`SELECT a.id,a.email,a.display_name,a.role,a.active
    FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id
    WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`)
    .bind(await sha256(token),now()).first<any>()
}

async function credentials(env:Env,id:string){
  return env.DB.prepare('SELECT id,password_hash,password_salt FROM admin_users WHERE id=?').bind(id).first<any>()
}

async function requireAdmin(request:Request,env:Env){
  const admin=await currentAdmin(request,env)
  if(!admin)return {error:json({ok:false,message:'Acesso profissional necessário.'},401),admin:null}
  return {error:null,admin}
}

async function requirePsychologist(request:Request,env:Env){
  const state=await requireAdmin(request,env)
  if(state.error)return state
  if(state.admin.role!=='psychologist')return {error:json({ok:false,message:'Esta ação exige acesso de Psicóloga / Administrador.'},403),admin:state.admin}
  return state
}

export async function guardAdminRole(request:Request,env:Env,path:string):Promise<Response|null>{
  if(!path.startsWith('/api/admin/'))return null
  if(path.startsWith('/api/admin/security')||path.startsWith('/api/admin/users'))return null
  const protectedClinical=/^\/api\/admin\/patients\/\d+(?:\/notes)?$/.test(path)||path.startsWith('/api/admin/notes/')
  const protectedSettings=path==='/api/admin/settings'&&request.method!=='GET'
  if(!protectedClinical&&!protectedSettings)return null
  const state=await requireAdmin(request,env)
  if(state.error)return state.error
  if(state.admin.role!=='psychologist')return json({ok:false,message:'Seu nível de acesso não permite esta área.'},403)
  return null
}

export async function handleAdminSecurity(request:Request,env:Env,path:string):Promise<Response|null>{
  const isSecurity=path==='/api/admin/security/email'||path==='/api/admin/security/password'
  const isUsers=path==='/api/admin/users'||/^\/api\/admin\/users\/[^/]+$/.test(path)
  if(!isSecurity&&!isUsers)return null

  if(path==='/api/admin/security/email'&&request.method==='PATCH'){
    const state=await requireAdmin(request,env);if(state.error)return state.error
    const b=await body(request),email=String(b.email||'').trim().toLowerCase(),currentPassword=String(b.current_password||'')
    if(!email.includes('@'))return json({ok:false,message:'Informe um e-mail válido.'},400)
    const creds=await credentials(env,state.admin.id)
    if(!creds||!(await verifyPassword(currentPassword,creds.password_salt,creds.password_hash)))return json({ok:false,message:'Senha atual incorreta.'},401)
    const exists=await env.DB.prepare('SELECT id FROM admin_users WHERE email=? AND id<>?').bind(email,state.admin.id).first<any>()
    if(exists)return json({ok:false,message:'Este e-mail já está em uso por outro acesso.'},409)
    await env.DB.prepare('UPDATE admin_users SET email=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(email,state.admin.id).run()
    return json({ok:true,message:'E-mail de acesso atualizado.',email})
  }

  if(path==='/api/admin/security/password'&&request.method==='PATCH'){
    const state=await requireAdmin(request,env);if(state.error)return state.error
    const b=await body(request),currentPassword=String(b.current_password||''),newPassword=String(b.new_password||'')
    if(newPassword.length<10)return json({ok:false,message:'A nova senha deve ter pelo menos 10 caracteres.'},400)
    const creds=await credentials(env,state.admin.id)
    if(!creds||!(await verifyPassword(currentPassword,creds.password_salt,creds.password_hash)))return json({ok:false,message:'Senha atual incorreta.'},401)
    const pwd=await hashPassword(newPassword)
    await env.DB.prepare('UPDATE admin_users SET password_hash=?,password_salt=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(pwd.hash,pwd.salt,state.admin.id).run()
    await env.DB.prepare('DELETE FROM admin_sessions WHERE admin_user_id=?').bind(state.admin.id).run()
    return json({ok:true,message:'Senha alterada. Entre novamente com a nova senha.'},200,{'set-cookie':clearCookie(ADMIN_COOKIE)})
  }

  if(path==='/api/admin/users'&&request.method==='GET'){
    const state=await requirePsychologist(request,env);if(state.error)return state.error
    const result=await env.DB.prepare(`SELECT id,email,display_name,role,active,created_at,updated_at FROM admin_users ORDER BY active DESC,display_name COLLATE NOCASE`).all<any>()
    return json({ok:true,users:result.results||[],current_user_id:state.admin.id})
  }

  if(path==='/api/admin/users'&&request.method==='POST'){
    const state=await requirePsychologist(request,env);if(state.error)return state.error
    const b=await body(request)
    const email=String(b.email||'').trim().toLowerCase(),displayName=String(b.display_name||'').trim(),password=String(b.password||''),role=b.role==='assistant'?'assistant':'psychologist'
    if(!displayName||!email.includes('@')||password.length<10)return json({ok:false,message:'Informe nome, e-mail válido e senha inicial com pelo menos 10 caracteres.'},400)
    const exists=await env.DB.prepare('SELECT id FROM admin_users WHERE email=?').bind(email).first<any>()
    if(exists)return json({ok:false,message:'Já existe um acesso com este e-mail.'},409)
    const pwd=await hashPassword(password),id=crypto.randomUUID()
    await env.DB.prepare(`INSERT INTO admin_users (id,email,password_hash,password_salt,display_name,role,active) VALUES (?,?,?,?,?,?,1)`).bind(id,email,pwd.hash,pwd.salt,displayName,role).run()
    return json({ok:true,message:'Novo acesso cadastrado.',user:{id,email,display_name:displayName,role,active:1}},201)
  }

  const match=path.match(/^\/api\/admin\/users\/([^/]+)$/)
  if(match&&request.method==='PATCH'){
    const state=await requirePsychologist(request,env);if(state.error)return state.error
    const id=decodeURIComponent(match[1]),b=await body(request)
    const target=await env.DB.prepare('SELECT id,email,display_name,role,active FROM admin_users WHERE id=?').bind(id).first<any>()
    if(!target)return json({ok:false,message:'Usuário não encontrado.'},404)
    const nextRole=b.role===undefined?target.role:(b.role==='assistant'?'assistant':'psychologist')
    const nextActive=b.active===undefined?Number(target.active):(b.active?1:0)
    const nextName=b.display_name===undefined?target.display_name:String(b.display_name||'').trim()
    if(!nextName)return json({ok:false,message:'Informe o nome do usuário.'},400)
    if(id===state.admin.id&&(nextRole!=='psychologist'||nextActive!==1))return json({ok:false,message:'Você não pode remover seu próprio acesso administrativo.'},409)
    if(target.role==='psychologist'&&Number(target.active)===1&&(nextRole!=='psychologist'||nextActive!==1)){
      const count=await env.DB.prepare(`SELECT COUNT(*) AS count FROM admin_users WHERE role='psychologist' AND active=1`).first<any>()
      if(Number(count?.count||0)<=1)return json({ok:false,message:'É necessário manter pelo menos uma conta Psicóloga / Administrador ativa.'},409)
    }
    await env.DB.prepare('UPDATE admin_users SET display_name=?,role=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(nextName,nextRole,nextActive,id).run()
    if(nextActive!==1)await env.DB.prepare('DELETE FROM admin_sessions WHERE admin_user_id=?').bind(id).run()
    return json({ok:true,message:'Acesso atualizado.'})
  }

  return json({ok:false,message:'Método não permitido.'},405)
}
