import { cookie, randomToken, readCookie, sha256 } from './auth'
import type { Env } from './types'

const PATIENT_COOKIE = 'ps_session'
const SESSION_SECONDS = 60 * 60 * 24 * 14
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
const digits = (value: string) => value.replace(/\D/g, '')

async function createSession(patientId: number, env: Env) {
  const token = randomToken()
  await env.DB.prepare('INSERT INTO sessions (id, patient_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), patientId, await sha256(token), new Date(Date.now() + SESSION_SECONDS * 1000).toISOString()).run()
  return token
}

export async function handleGoogleAuth(request: Request, env: Env) {
  const url = new URL(request.url)
  const origin = env.APP_ORIGIN || url.origin

  if (url.pathname === '/api/auth/google/start' && request.method === 'GET') {
    if (!env.GOOGLE_CLIENT_ID) return json({ ok: false, message: 'Login Google ainda não configurado.' }, 503)
    const state = randomToken(20)
    const target = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    target.searchParams.set('client_id', env.GOOGLE_CLIENT_ID)
    target.searchParams.set('redirect_uri', `${origin}/api/auth/google/callback`)
    target.searchParams.set('response_type', 'code')
    target.searchParams.set('scope', 'openid email profile')
    target.searchParams.set('state', state)
    return new Response(null, { status: 302, headers: { location: target.toString(), 'set-cookie': cookie('ps_google_state', state, 600) } })
  }

  if (url.pathname === '/api/auth/google/callback' && request.method === 'GET') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ ok: false, message: 'Login Google ainda não configurado.' }, 503)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const expected = readCookie(request, 'ps_google_state')
    if (!code || !state || !expected || state !== expected) return json({ ok: false, message: 'Falha de validação no login Google.' }, 400)

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${origin}/api/auth/google/callback`, grant_type: 'authorization_code' }),
    })
    if (!tokenResponse.ok) return json({ ok: false, message: 'Não foi possível concluir o login Google.' }, 502)
    const tokens = await tokenResponse.json() as any
    const infoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } })
    if (!infoResponse.ok) return json({ ok: false, message: 'Não foi possível obter os dados da conta Google.' }, 502)
    const info = await infoResponse.json() as any
    const email = String(info.email || '').toLowerCase()
    const patient = await env.DB.prepare('SELECT id, google_sub FROM patients WHERE google_sub = ? OR email = ?').bind(info.sub, email).first<any>()

    if (patient) {
      if (!patient.google_sub) await env.DB.prepare('UPDATE patients SET google_sub = ?, email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(info.sub, patient.id).run()
      const session = await createSession(Number(patient.id), env)
      return new Response(null, { status: 302, headers: { location: `${origin}/?login=success`, 'set-cookie': cookie(PATIENT_COOKIE, session, SESSION_SECONDS) } })
    }

    const pendingToken = randomToken(24)
    await env.DB.prepare(`INSERT INTO oauth_pending (id, token_hash, google_sub, email, full_name, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), await sha256(pendingToken), String(info.sub || ''), email, String(info.name || ''), new Date(Date.now() + 15 * 60_000).toISOString()).run()
    return new Response(null, { status: 302, headers: { location: `${origin}/?google-profile-required=1&token=${encodeURIComponent(pendingToken)}` } })
  }

  if (url.pathname === '/api/auth/google/pending' && request.method === 'GET') {
    const token = url.searchParams.get('token') || ''
    const row = await env.DB.prepare('SELECT email, full_name FROM oauth_pending WHERE token_hash = ? AND expires_at > ?').bind(await sha256(token), new Date().toISOString()).first<any>()
    if (!row) return json({ ok: false, message: 'Cadastro Google expirado. Inicie novamente.' }, 400)
    return json({ ok: true, email: row.email, full_name: row.full_name })
  }

  if (url.pathname === '/api/auth/google/complete' && request.method === 'POST') {
    const data = await request.json().catch(() => ({})) as any
    const pendingToken = String(data.pending_token || '')
    const pending = await env.DB.prepare('SELECT * FROM oauth_pending WHERE token_hash = ? AND expires_at > ?').bind(await sha256(pendingToken), new Date().toISOString()).first<any>()
    if (!pending) return json({ ok: false, message: 'Cadastro Google expirado. Inicie novamente.' }, 400)
    const fullName = String(data.full_name || pending.full_name || '').trim()
    const birthDate = String(data.birth_date || '').trim()
    const cpf = digits(String(data.cpf || ''))
    const phone = digits(String(data.phone || ''))
    if (!fullName || !birthDate || cpf.length !== 11 || phone.length < 10) return json({ ok: false, message: 'Complete corretamente todos os dados obrigatórios.' }, 400)
    const existing = await env.DB.prepare('SELECT id FROM patients WHERE email = ? OR cpf = ? OR google_sub = ?').bind(pending.email, cpf, pending.google_sub).first()
    if (existing) return json({ ok: false, message: 'Já existe cadastro com estes dados.' }, 409)
    const result = await env.DB.prepare(`INSERT INTO patients (full_name, birth_date, cpf, phone, email, google_sub, email_verified) VALUES (?, ?, ?, ?, ?, ?, 1)`)
      .bind(fullName, birthDate, cpf, phone, pending.email, pending.google_sub).run()
    const patientId = Number(result.meta.last_row_id)
    await env.DB.prepare('DELETE FROM oauth_pending WHERE token_hash = ?').bind(await sha256(pendingToken)).run()
    const session = await createSession(patientId, env)
    return json({ ok: true, patient_id: patientId }, 201, { 'set-cookie': cookie(PATIENT_COOKIE, session, SESSION_SECONDS) } as any)
  }

  return null
}
