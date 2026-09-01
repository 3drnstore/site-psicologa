import { hashPassword } from './auth'
import type { Env } from './types'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

export async function handleAdminSetup(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)

  if (url.pathname === '/api/admin/setup-status' && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM admin_users').first<any>()
    return json({ ok: true, configured: Number(row?.count || 0) > 0 })
  }

  if (url.pathname === '/api/admin/setup' && request.method === 'POST') {
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM admin_users').first<any>()
    if (Number(count?.count || 0) > 0) return json({ ok: false, message: 'O administrador inicial já foi configurado.' }, 409)
    if (!env.ADMIN_SETUP_TOKEN) return json({ ok: false, message: 'A chave ADMIN_SETUP_TOKEN ainda não foi configurada na Cloudflare.' }, 503)
    const supplied = request.headers.get('x-setup-token') || ''
    if (supplied !== env.ADMIN_SETUP_TOKEN) return json({ ok: false, message: 'Chave de configuração inválida.' }, 403)

    const data = await request.json().catch(() => ({})) as any
    const displayName = String(data.display_name || '').trim()
    const email = String(data.email || '').trim().toLowerCase()
    const password = String(data.password || '')
    if (!displayName || !email.includes('@') || password.length < 10) return json({ ok: false, message: 'Informe nome, e-mail válido e senha com pelo menos 10 caracteres.' }, 400)

    const pwd = await hashPassword(password)
    const id = crypto.randomUUID()
    await env.DB.prepare(`INSERT INTO admin_users (id,email,password_hash,password_salt,display_name,role,active) VALUES (?,?,?,?,?,'psychologist',1)`)
      .bind(id, email, pwd.hash, pwd.salt, displayName).run()

    return json({ ok: true, admin_id: id }, 201)
  }

  return null
}
