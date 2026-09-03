import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const ADMIN_COOKIE='ps_admin_session'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control':'no-store' },
})

async function adminFromRequest(request:Request,env:Env){
  const token=readCookie(request,ADMIN_COOKIE)
  if(!token)return null
  return env.DB.prepare(`SELECT a.id,a.role FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),new Date().toISOString()).first<any>()
}

export async function handleContactApi(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/api/contact') return null
  const url=new URL(request.url)
  const adminMode=url.searchParams.get('admin')==='1'

  if(adminMode){
    const admin=await adminFromRequest(request,env)
    if(!admin)return json({ok:false,message:'Acesso profissional necessário.'},401)
    if(request.method==='GET'){
      const result=await env.DB.prepare(`SELECT id,name,email,phone,message,status,created_at FROM contact_messages ORDER BY CASE WHEN status='new' THEN 0 ELSE 1 END,created_at DESC LIMIT 250`).all<any>()
      return json({ok:true,messages:result.results||[]})
    }
    if(request.method==='POST'){
      const payload=await request.json().catch(()=>({})) as any
      if(payload.admin_action!=='status')return json({ok:false,message:'Ação inválida.'},400)
      const id=Number(payload.id),status=String(payload.status||'read')
      if(!Number.isInteger(id)||!['new','read'].includes(status))return json({ok:false,message:'Dados inválidos.'},400)
      const result=await env.DB.prepare('UPDATE contact_messages SET status=? WHERE id=?').bind(status,id).run()
      if(!result.meta.changes)return json({ok:false,message:'Mensagem não encontrada.'},404)
      return json({ok:true,status})
    }
    return json({ok:false,message:'Método não permitido.'},405)
  }

  if (request.method !== 'POST') return json({ ok: false, message: 'Método não permitido.' }, 405)

  const body = await request.json().catch(() => null) as any
  const name = String(body?.name || '').trim()
  const email = String(body?.email || '').trim().toLowerCase()
  const phone = String(body?.phone || '').trim()
  const message = String(body?.message || '').trim()
  const honeypot = String(body?.website || '').trim()
  const startedAt = Number(body?.started_at || 0)

  if (honeypot) return json({ ok: true, message: 'Mensagem enviada com sucesso.' })
  if (startedAt > 0) {
    const elapsed = Date.now() - startedAt
    if (elapsed < 1800 || elapsed > 24 * 60 * 60 * 1000) return json({ ok: true, message: 'Mensagem enviada com sucesso.' })
  }

  if (!name || !email || !phone || !message) return json({ ok: false, message: 'Preencha todos os campos.' }, 400)
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ ok: false, message: 'Informe um e-mail válido.' }, 400)
  if (name.length > 120 || email.length > 160 || phone.length > 30 || message.length > 3000) return json({ ok: false, message: 'Um ou mais campos ultrapassaram o tamanho permitido.' }, 400)

  await env.DB.prepare(`INSERT INTO contact_messages (name, email, phone, message) VALUES (?, ?, ?, ?)`).bind(name, email, phone, message).run()
  return json({ ok: true, message: 'Mensagem enviada com sucesso.' })
}
