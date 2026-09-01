import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
})

const nowIso = () => new Date().toISOString()

async function adminFromRequest(request: Request, env: Env) {
  const token = readCookie(request, 'ps_admin_session')
  if (!token) return null
  const tokenHash = await sha256(token)
  return env.DB.prepare(`
    SELECT a.id
    FROM admin_sessions s
    JOIN admin_users a ON a.id = s.admin_user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND a.active = 1
  `).bind(tokenHash, nowIso()).first<any>()
}

export async function handleAgendaCreate(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/api/admin/availability' || request.method !== 'POST') return null

  const admin = await adminFromRequest(request, env)
  if (!admin) return json({ ok: false, message: 'Acesso profissional necessário.' }, 401)

  const data = await request.json().catch(() => ({})) as any
  const startsAt = String(data.starts_at || '')
  const endsAt = String(data.ends_at || '')

  const start = new Date(startsAt)
  const end = new Date(endsAt)
  if (!startsAt || !endsAt || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return json({ ok: false, message: 'Informe um início e um fim válidos para o horário.' }, 400)
  }

  const conflict = await env.DB.prepare(`
    SELECT id FROM availability
    WHERE starts_at < ? AND ends_at > ?
    LIMIT 1
  `).bind(endsAt, startsAt).first<any>()

  if (conflict) return json({ ok: false, message: 'Já existe um horário que conflita com esse intervalo.' }, 409)

  const result = await env.DB.prepare(`
    INSERT INTO availability (starts_at, ends_at, status, public_visibility, source)
    VALUES (?, ?, 'free', 'visible', 'manual')
  `).bind(startsAt, endsAt).run()

  return json({ ok: true, id: result.meta.last_row_id }, 201)
}
