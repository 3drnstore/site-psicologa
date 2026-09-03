import { clearCookie, hashPassword, readCookie, sha256, verifyPassword } from './auth'
import { newTotpSecret, totpUri, verifyTotp } from './totp'
import type { Env } from './types'

const ADMIN_COOKIE='ps_admin_session'
const json=(data:unknown,status=200,headers:HeadersInit={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}})
const now=()=>new Date().toISOString()
async function body(request:Request){try{return await request.json() as Record<string,any>}catch{return {}}}
async function audit(env:Env,actorId:string,action:string,entityType:string,entityId?:string|null,metadata?:unknown){await env.DB.prepare(`INSERT INTO audit_log (id,actor_type,actor_id,action,entity_type,entity_id,metadata_json) VALUES (?,'admin',?,?,?,?,?)`).bind(crypto.randomUUID(),actorId,action,entityType,entityId||null,metadata?JSON.stringify(metadata):null).run()}
async function currentAdmin(request:Request,env:Env){const token=readCookie(request,ADMIN_COOKIE);if(!token)return null;return env.DB.prepare(`SELECT a.id,a.email,a.display_name,a.role,a.active,s.id AS session_id FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),now()).first<any>()}
async function credentials(env:Env,id:string){return env.DB.prepare('SELECT id,password_hash,password_salt FROM admin_users WHERE id=?').bind(id).first<any>()}
async function requireAdmin(request:Request,env:Env){const admin=await currentAdmin(request,env);if(!admin)return {error:json({ok:false,message:'Acesso profissional necessário.'},401),admin:null};return {error:null,admin}}
async function requirePsychologist(request:Request,env:Env){const state=await requireAdmin(request,env);if(state.error)return state;if(state.admin.role!=='psychologist')return {error:json({ok:false,message:'Esta ação exige acesso de Psicóloga / Administrador.'},403),admin:state.admin};return state}

export async function guardAdminRole(request:Request,env:Env,path:string):Promise<Response|null>{
  if(!path.startsWith('/api/admin/'))return null
  if(path.startsWith('/api/admin/security')||path.startsWith('/api/admin/users'))return null
  const protectedClinical=/^\/api\/admin\/patients\/\d+(?:\/notes)?$/.test(path)||path.startsWith('/api/admin/notes/')
  const protectedSettings=path==='/api/admin/settings'&&request.method!=='GET'
  if(!protectedClinical&&!protectedSettings)return null
  const state=await requireAdmin(request,env);if(state.error)return state.error
  if(state.admin.role!=='psychologist')return json({ok:false,message:'Seu nível de acesso não permite esta área.'},403)
  return null
}

export async function handleAdminSecurity(request:Request,env:Env,path:string):Promise<Response|null>{
  const isSecurity=path.startsWith('/api/admin/security/')
  const isUsers=path==='/api/admin/users'||/^\/api\/admin\/users\/[^/]+$/.test(path)
  if(!isSecurity&&!isUsers)return null

  if(path==='/api/admin/security/2fa'&&request.method==='GET'){
    const state=await requireAdmin(request,env);if(state.error)return state.error
    const row=await env.DB.prepare('SELECT totp_enabled FROM admin_users WHERE id=?').bind(state.admin.id).first<any>()
    return json({ok:true,enabled:Number(row?.totp_enabled)===1})
  }
  if(path==='/api/admin/security/2fa/setup'&&request.method==='POST'){
    const state=await requireAdmin(request,env);if(state.error)return state.error
    const secret=newTotpSecret()
    await env.DB.prepare('UPDATE admin_users SET totp_secret=?,totp_enabled=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(secret,state.admin.id).run()
    return json({ok:true,secret,uri:totpUri(secret,state.admin.email)})
  }
  if(path==='/api/admin/security/2fa/enable'&&request.method==='POST'){
    const state=await requireAdmin(request,env);if(state.error)return state.error
    const b=await body(request),row=await env.DB.prepare('SELECT totp_secret FROM admin_users WHERE id=?').bind(state.admin.id).first<any>()
    if(!row?.totp_secret||!(await verifyTotp(row.totp_secret,String(b.code||''))))return json({ok:false,message:'Código inválido. Confira o aplicativo autenticador.'},400)
    await env.DB.prepare('UPDATE admin_users SET totp_enabled=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(state.admin.id).run()
    await audit(env,state.admin.id,'admin_2fa_enabled','admin_user',state.admin.id)
    return json({ok:true,message:'Autenticação em dois fatores ativada.'})
  }
  if(path==='/api/admin/security/2fa/disable'&&request.method==='POST'){
    const state=await requireAdmin(request,env);if(state.error)return state.error
    const b=await body(request),creds=await credentials(env,state.admin.id)
    if(!creds||!(await verifyPassword(String(b.current_password||''),creds.password_salt,creds.password_hash)))return json({ok:false,message:'Senha atual incorreta.'},401)
    await env.DB.prepare('UPDATE admin_users SET totp_secret=NULL,totp_enabled=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(state.admin.id).run()
    await audit(env,state.admin.id,'admin_2fa_disabled','admin_user',state.admin.id)
    return json({ok:true,message:'Autenticação em dois fatores desativada.'})
  }
  if(path==='/api/admin/security/sessions'&&request.method==='GET'){
    const state=await requireAdmin(request,env);if(state.error)return state.error
    const result=await env.DB.prepare(`SELECT id,created_at,expires_at FROM admin_sessions WHERE admin_user_id=? AND expires_at>? ORDER BY created_at DESC`).bind(state.admin.id,now()).all<any>()
    return json({ok:true,sessions:(result.results||[]).map((row:any)=>({...row,current:row.id===state.admin.session_id})),current_session_id:state.admin.session_id})
  }
  if(path==='/api/admin/security/sessions/others'&&request.method==='DELETE'){
    const state=await requireAdmin(request,env);if(state.error)return state.error
    const result=await env.DB.prepare('DELETE FROM admin_sessions WHERE admin_user_id=? AND id<>?').bind(state.admin.id,state.admin.session_id).run()
    await audit(env,state.admin.id,'admin_other_sessions_revoked','admin_session',null,{count:Number(result.meta.changes||0)})
    return json({ok:true,message:'Outras sessões encerradas.',count:Number(result.meta.changes||0)})
  }
  const sessionMatch=path.match(/^\/api\/admin\/security\/sessions\/([^/]+)$/)
  if(sessionMatch&&request.method==='DELETE'){
    const state=await requireAdmin(request,env);if(state.error)return state.error
    const id=decodeURIComponent(sessionMatch[1]);if(id===state.admin.session_id)return json({ok:false,message:'A sessão atual deve ser encerrada pelo botão Sair.'},409)
    const existing=await env.DB.prepare('SELECT id FROM admin_sessions WHERE id=? AND admin_user_id=?').bind(id,state.admin.id).first<any>();if(!existing)return json({ok:false,message:'Sessão não encontrada ou já encerrada.'},404)
    await env.DB.prepare('DELETE FROM admin_sessions WHERE id=? AND admin_user_id=?').bind(id,state.admin.id).run();await audit(env,state.admin.id,'admin_session_revoked','admin_session',id)
    return json({ok:true,message:'Sessão encerrada.'})
  }
  if(path==='/api/admin/security/activity'&&request.method==='GET'){
    const state=await requireAdmin(request,env);if(state.error)return state.error
    const result=await env.DB.prepare(`SELECT id,action,entity_type,entity_id,metadata_json,created_at FROM audit_log WHERE actor_type='admin' AND actor_id=? ORDER BY created_at DESC LIMIT 50`).bind(state.admin.id).all<any>()
    return json({ok:true,events:result.results||[]})
  }
  if(path==='/api/admin/security/email'&&request.method==='PATCH'){
    const state=await requireAdmin(request,env);if(state.error)return state.error
    const b=await body(request),email=String(b.email||'').trim().toLowerCase(),currentPassword=String(b.current_password||'')
    if(!email.includes('@'))return json({ok:false,message:'Informe um e-mail válido.'},400)
    const creds=await credentials(env,state.admin.id);if(!creds||!(await verifyPassword(currentPassword,creds.password_salt,creds.password_hash)))return json({ok:false,message:'Senha atual incorreta.'},401)
    const exists=await env.DB.prepare('SELECT id FROM admin_users WHERE email=? AND id<>?').bind(email,state.admin.id).first<any>();if(exists)return json({ok:false,message:'Este e-mail já está em uso por outro acesso.'},409)
    const previous=state.admin.email;await env.DB.prepare('UPDATE admin_users SET email=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(email,state.admin.id).run();await audit(env,state.admin.id,'admin_email_changed','admin_user',state.admin.id,{from:previous,to:email})
    return json({ok:true,message:'E-mail de acesso atualizado.',email})
  }
  if(path==='/api/admin/security/password'&&request.method==='PATCH'){
    const state=await requireAdmin(request,env);if(state.error)return state.error
    const b=await body(request),currentPassword=String(b.current_password||''),newPassword=String(b.new_password||'');if(newPassword.length<10)return json({ok:false,message:'A nova senha deve ter pelo menos 10 caracteres.'},400)
    const creds=await credentials(env,state.admin.id);if(!creds||!(await verifyPassword(currentPassword,creds.password_salt,creds.password_hash)))return json({ok:false,message:'Senha atual incorreta.'},401)
    const pwd=await hashPassword(newPassword);await audit(env,state.admin.id,'admin_password_changed','admin_user',state.admin.id);await env.DB.prepare('UPDATE admin_users SET password_hash=?,password_salt=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(pwd.hash,pwd.salt,state.admin.id).run();await env.DB.prepare('DELETE FROM admin_sessions WHERE admin_user_id=?').bind(state.admin.id).run()
    return json({ok:true,message:'Senha alterada. Entre novamente com a nova senha.'},200,{'set-cookie':clearCookie(ADMIN_COOKIE)})
  }
  if(path==='/api/admin/users'&&request.method==='GET'){
    const state=await requirePsychologist(request,env);if(state.error)return state.error
    const result=await env.DB.prepare(`SELECT id,email,display_name,role,active,created_at,updated_at FROM admin_users ORDER BY active DESC,display_name COLLATE NOCASE`).all<any>()
    return json({ok:true,users:result.results||[],current_user_id:state.admin.id})
  }
  if(path==='/api/admin/users'&&request.method==='POST'){
    const state=await requirePsychologist(request,env);if(state.error)return state.error
    const b=await body(request),email=String(b.email||'').trim().toLowerCase(),displayName=String(b.display_name||'').trim(),password=String(b.password||''),role=b.role==='assistant'?'assistant':'psychologist'
    if(!displayName||!email.includes('@')||password.length<10)return json({ok:false,message:'Informe nome, e-mail válido e senha inicial com pelo menos 10 caracteres.'},400)
    const exists=await env.DB.prepare('SELECT id FROM admin_users WHERE email=?').bind(email).first<any>();if(exists)return json({ok:false,message:'Já existe um acesso com este e-mail.'},409)
    const pwd=await hashPassword(password),id=crypto.randomUUID();await env.DB.prepare(`INSERT INTO admin_users (id,email,password_hash,password_salt,display_name,role,active) VALUES (?,?,?,?,?,?,1)`).bind(id,email,pwd.hash,pwd.salt,displayName,role).run();await audit(env,state.admin.id,'admin_user_created','admin_user',id,{role,email})
    return json({ok:true,message:'Novo acesso cadastrado.',user:{id,email,display_name:displayName,role,active:1}},201)
  }
  const match=path.match(/^\/api\/admin\/users\/([^/]+)$/)
  if(match&&request.method==='PATCH'){
    const state=await requirePsychologist(request,env);if(state.error)return state.error
    const id=decodeURIComponent(match[1]),b=await body(request),target=await env.DB.prepare('SELECT id,email,display_name,role,active FROM admin_users WHERE id=?').bind(id).first<any>();if(!target)return json({ok:false,message:'Usuário não encontrado.'},404)
    const nextRole=b.role===undefined?target.role:(b.role==='assistant'?'assistant':'psychologist'),nextActive=b.active===undefined?Number(target.active):(b.active?1:0),nextName=b.display_name===undefined?target.display_name:String(b.display_name||'').trim();if(!nextName)return json({ok:false,message:'Informe o nome do usuário.'},400)
    if(id===state.admin.id&&(nextRole!=='psychologist'||nextActive!==1))return json({ok:false,message:'Você não pode remover seu próprio acesso administrativo.'},409)
    if(target.role==='psychologist'&&Number(target.active)===1&&(nextRole!=='psychologist'||nextActive!==1)){const count=await env.DB.prepare(`SELECT COUNT(*) AS count FROM admin_users WHERE role='psychologist' AND active=1`).first<any>();if(Number(count?.count||0)<=1)return json({ok:false,message:'É necessário manter pelo menos uma conta Psicóloga / Administrador ativa.'},409)}
    await env.DB.prepare('UPDATE admin_users SET display_name=?,role=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(nextName,nextRole,nextActive,id).run();if(nextActive!==1)await env.DB.prepare('DELETE FROM admin_sessions WHERE admin_user_id=?').bind(id).run();await audit(env,state.admin.id,'admin_user_updated','admin_user',id,{role:nextRole,active:nextActive,display_name:nextName})
    return json({ok:true,message:'Acesso atualizado.'})
  }
  return json({ok:false,message:'Método não permitido.'},405)
}
