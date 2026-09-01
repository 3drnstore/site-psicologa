import { clearCookie, cookie, hashPassword, randomToken, readCookie, sha256, verifyPassword } from './auth'
import type { Env } from './types'

const PATIENT_COOKIE = 'ps_session'
const ADMIN_COOKIE = 'ps_admin_session'
const SESSION_SECONDS = 60 * 60 * 24 * 14

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })

const nowIso = () => new Date().toISOString()
const plusMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
const plusDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()
const digits = (value: string) => value.replace(/\D/g, '')

async function body(request: Request) {
  try { return await request.json() as Record<string, any> } catch { return {} }
}

async function setting(env: Env, key: string, fallback = '') {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  return row?.value ?? fallback
}

async function patientFromRequest(request: Request, env: Env) {
  const token = readCookie(request, PATIENT_COOKIE)
  if (!token) return null
  const tokenHash = await sha256(token)
  return env.DB.prepare(`
    SELECT p.id, p.full_name, p.birth_date, p.cpf, p.phone, p.email, p.email_verified
    FROM sessions s
    JOIN patients p ON p.id = s.patient_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(tokenHash, nowIso()).first<any>()
}

async function adminFromRequest(request: Request, env: Env) {
  const token = readCookie(request, ADMIN_COOKIE)
  if (!token) return null
  const tokenHash = await sha256(token)
  return env.DB.prepare(`
    SELECT a.id, a.email, a.display_name, a.role
    FROM admin_sessions s
    JOIN admin_users a ON a.id = s.admin_user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND a.active = 1
  `).bind(tokenHash, nowIso()).first<any>()
}

async function createPatientSession(patientId: number, env: Env) {
  const token = randomToken()
  const hash = await sha256(token)
  await env.DB.prepare('INSERT INTO sessions (id, patient_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), patientId, hash, plusDays(14)).run()
  return token
}

async function createAdminSession(adminId: string, env: Env) {
  const token = randomToken()
  const hash = await sha256(token)
  await env.DB.prepare('INSERT INTO admin_sessions (id, admin_user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), adminId, hash, plusDays(14)).run()
  return token
}

async function audit(env: Env, actorType: 'patient' | 'admin' | 'system', actorId: string | number | null, action: string, entityType: string, entityId?: string | number | null, metadata?: unknown) {
  await env.DB.prepare(`INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), actorType, actorId == null ? null : String(actorId), action, entityType, entityId == null ? null : String(entityId), metadata ? JSON.stringify(metadata) : null).run()
}

async function releaseExpiredHolds(env: Env) {
  const expired = await env.DB.prepare(`SELECT id, availability_id FROM appointments WHERE status = 'pending_payment' AND reserved_until IS NOT NULL AND reserved_until < ?`).bind(nowIso()).all<any>()
  for (const row of expired.results || []) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE appointments SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending_payment'`).bind(row.id),
      env.DB.prepare(`UPDATE availability SET status = 'free', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'held'`).bind(row.availability_id),
    ])
  }
}

async function googleAccessToken(env: Env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) return null
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })
  if (!response.ok) return null
  const data = await response.json() as any
  return data.access_token as string | undefined
}

async function createCalendarEvent(env: Env, appointmentId: number) {
  const appointment = await env.DB.prepare(`
    SELECT a.id, a.google_calendar_event_id, av.starts_at, av.ends_at, p.full_name, p.email, p.phone
    FROM appointments a
    JOIN availability av ON av.id = a.availability_id
    JOIN patients p ON p.id = a.patient_id
    WHERE a.id = ?
  `).bind(appointmentId).first<any>()
  if (!appointment || appointment.google_calendar_event_id) return appointment?.google_calendar_event_id || null
  const token = await googleAccessToken(env)
  if (!token) return null
  const calendarId = encodeURIComponent(env.GOOGLE_CALENDAR_ID || 'primary')
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      summary: `Consulta – ${appointment.full_name}`,
      description: `Consulta agendada pelo site. Contato: ${appointment.phone || appointment.email}.`,
      start: { dateTime: appointment.starts_at, timeZone: 'America/Sao_Paulo' },
      end: { dateTime: appointment.ends_at, timeZone: 'America/Sao_Paulo' },
    }),
  })
  if (!response.ok) return null
  const event = await response.json() as any
  if (event.id) {
    await env.DB.prepare('UPDATE appointments SET google_calendar_event_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(event.id, appointmentId).run()
  }
  return event.id || null
}

async function confirmPayment(env: Env, paymentId: number, externalStatus = 'approved') {
  const payment = await env.DB.prepare(`SELECT * FROM payments WHERE id = ?`).bind(paymentId).first<any>()
  if (!payment) return false
  const appointment = await env.DB.prepare(`SELECT * FROM appointments WHERE id = ?`).bind(payment.appointment_id).first<any>()
  if (!appointment) return false
  await env.DB.batch([
    env.DB.prepare(`UPDATE payments SET status = 'approved', raw_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(externalStatus, paymentId),
    env.DB.prepare(`UPDATE appointments SET status = 'confirmed', paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(appointment.id),
    env.DB.prepare(`UPDATE availability SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(appointment.availability_id),
  ])
  await createCalendarEvent(env, appointment.id)
  await audit(env, 'system', null, 'payment_confirmed', 'appointment', appointment.id, { payment_id: paymentId })
  return true
}

async function handlePatientAuth(request: Request, env: Env, path: string) {
  if (path === '/api/auth/register' && request.method === 'POST') {
    const data = await body(request)
    const fullName = String(data.full_name || '').trim()
    const birthDate = String(data.birth_date || '').trim()
    const cpf = digits(String(data.cpf || ''))
    const phone = digits(String(data.phone || ''))
    const email = String(data.email || '').trim().toLowerCase()
    const password = String(data.password || '')
    if (!fullName || !birthDate || cpf.length !== 11 || phone.length < 10 || !email.includes('@') || password.length < 8) {
      return json({ ok: false, message: 'Preencha corretamente todos os campos. A senha deve ter pelo menos 8 caracteres.' }, 400)
    }
    const existing = await env.DB.prepare('SELECT id FROM patients WHERE email = ? OR cpf = ?').bind(email, cpf).first()
    if (existing) return json({ ok: false, message: 'Já existe um cadastro com este e-mail ou CPF.' }, 409)
    const pwd = await hashPassword(password)
    const result = await env.DB.prepare(`INSERT INTO patients (full_name, birth_date, cpf, phone, email, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(fullName, birthDate, cpf, phone, email, pwd.hash, pwd.salt).run()
    const patientId = Number(result.meta.last_row_id)
    const token = await createPatientSession(patientId, env)
    await audit(env, 'patient', patientId, 'registered', 'patient', patientId)
    return json({ ok: true, patient: { id: patientId, full_name: fullName, email } }, 201, { 'set-cookie': cookie(PATIENT_COOKIE, token, SESSION_SECONDS) })
  }

  if (path === '/api/auth/login' && request.method === 'POST') {
    const data = await body(request)
    const email = String(data.email || '').trim().toLowerCase()
    const password = String(data.password || '')
    const patient = await env.DB.prepare(`SELECT id, full_name, email, password_hash, password_salt FROM patients WHERE email = ?`).bind(email).first<any>()
    if (!patient?.password_hash || !patient?.password_salt || !(await verifyPassword(password, patient.password_salt, patient.password_hash))) {
      return json({ ok: false, message: 'E-mail ou senha inválidos.' }, 401)
    }
    const token = await createPatientSession(Number(patient.id), env)
    await audit(env, 'patient', patient.id, 'login', 'session')
    return json({ ok: true, patient: { id: patient.id, full_name: patient.full_name, email: patient.email } }, 200, { 'set-cookie': cookie(PATIENT_COOKIE, token, SESSION_SECONDS) })
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    const token = readCookie(request, PATIENT_COOKIE)
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
    return json({ ok: true }, 200, { 'set-cookie': clearCookie(PATIENT_COOKIE) })
  }

  if (path === '/api/auth/google/start' && request.method === 'GET') {
    if (!env.GOOGLE_CLIENT_ID) return json({ ok: false, message: 'Login Google ainda não configurado.' }, 503)
    const state = randomToken(20)
    const origin = env.APP_ORIGIN || new URL(request.url).origin
    const redirectUri = `${origin}/api/auth/google/callback`
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('state', state)
    return new Response(null, { status: 302, headers: { location: url.toString(), 'set-cookie': cookie('ps_google_state', state, 600) } })
  }

  if (path === '/api/auth/google/callback' && request.method === 'GET') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ ok: false, message: 'Login Google ainda não configurado.' }, 503)
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const expectedState = readCookie(request, 'ps_google_state')
    if (!code || !state || !expectedState || state !== expectedState) return json({ ok: false, message: 'Falha de validação no login Google.' }, 400)
    const origin = env.APP_ORIGIN || url.origin
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${origin}/api/auth/google/callback`, grant_type: 'authorization_code' }),
    })
    if (!tokenResponse.ok) return json({ ok: false, message: 'Não foi possível concluir o login Google.' }, 502)
    const tokens = await tokenResponse.json() as any
    const infoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } })
    const info = await infoResponse.json() as any
    let patient = await env.DB.prepare('SELECT id, full_name, email FROM patients WHERE google_sub = ? OR email = ?').bind(info.sub, String(info.email || '').toLowerCase()).first<any>()
    if (!patient) {
      return new Response(null, { status: 302, headers: { location: `${origin}/?google-profile-required=1&email=${encodeURIComponent(info.email || '')}&name=${encodeURIComponent(info.name || '')}&sub=${encodeURIComponent(info.sub || '')}` } })
    }
    if (!patient.google_sub) await env.DB.prepare('UPDATE patients SET google_sub = ?, email_verified = 1 WHERE id = ?').bind(info.sub, patient.id).run()
    const token = await createPatientSession(Number(patient.id), env)
    return new Response(null, { status: 302, headers: { location: `${origin}/?login=success`, 'set-cookie': cookie(PATIENT_COOKIE, token, SESSION_SECONDS) } })
  }

  if (path === '/api/auth/google/complete' && request.method === 'POST') {
    const data = await body(request)
    const fullName = String(data.full_name || '').trim()
    const birthDate = String(data.birth_date || '').trim()
    const cpf = digits(String(data.cpf || ''))
    const phone = digits(String(data.phone || ''))
    const email = String(data.email || '').trim().toLowerCase()
    const googleSub = String(data.google_sub || '').trim()
    if (!fullName || !birthDate || cpf.length !== 11 || phone.length < 10 || !email || !googleSub) return json({ ok: false, message: 'Complete todos os dados obrigatórios.' }, 400)
    const existing = await env.DB.prepare('SELECT id FROM patients WHERE email = ? OR cpf = ? OR google_sub = ?').bind(email, cpf, googleSub).first()
    if (existing) return json({ ok: false, message: 'Já existe cadastro com estes dados.' }, 409)
    const result = await env.DB.prepare(`INSERT INTO patients (full_name, birth_date, cpf, phone, email, google_sub, email_verified) VALUES (?, ?, ?, ?, ?, ?, 1)`)
      .bind(fullName, birthDate, cpf, phone, email, googleSub).run()
    const patientId = Number(result.meta.last_row_id)
    const token = await createPatientSession(patientId, env)
    return json({ ok: true }, 201, { 'set-cookie': cookie(PATIENT_COOKIE, token, SESSION_SECONDS) })
  }

  return null
}

async function handlePatientApi(request: Request, env: Env, path: string) {
  const patient = await patientFromRequest(request, env)
  if (!patient) return json({ ok: false, message: 'Faça login para continuar.' }, 401)

  if (path === '/api/me' && request.method === 'GET') return json({ ok: true, patient })

  if (path === '/api/availability' && request.method === 'GET') {
    await releaseExpiredHolds(env)
    const url = new URL(request.url)
    const from = url.searchParams.get('from') || nowIso()
    const to = url.searchParams.get('to') || plusDays(60)
    const result = await env.DB.prepare(`SELECT id, starts_at, ends_at FROM availability WHERE status = 'free' AND starts_at >= ? AND starts_at <= ? ORDER BY starts_at ASC`).bind(from, to).all()
    const price = Number(await setting(env, 'consultation_price_cents', '0'))
    const pixDiscount = Number(await setting(env, 'pix_discount_percent', '0'))
    return json({ ok: true, slots: result.results || [], consultation_price_cents: price, pix_discount_percent: pixDiscount })
  }

  if (path === '/api/appointments/reserve' && request.method === 'POST') {
    await releaseExpiredHolds(env)
    const data = await body(request)
    const slotId = Number(data.slot_id)
    if (!slotId) return json({ ok: false, message: 'Horário inválido.' }, 400)
    const slot = await env.DB.prepare(`SELECT * FROM availability WHERE id = ? AND status = 'free'`).bind(slotId).first<any>()
    if (!slot) return json({ ok: false, message: 'Esse horário não está mais disponível.' }, 409)
    const price = Number(await setting(env, 'consultation_price_cents', '0'))
    const holdMinutes = Number(await setting(env, 'hold_minutes', '15')) || 15
    const holdUntil = plusMinutes(holdMinutes)
    const hold = await env.DB.prepare(`UPDATE availability SET status = 'held', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'free'`).bind(slotId).run()
    if (!hold.meta.changes) return json({ ok: false, message: 'Esse horário acabou de ser reservado por outra pessoa.' }, 409)
    const result = await env.DB.prepare(`INSERT INTO appointments (patient_id, availability_id, status, amount_cents, reserved_until) VALUES (?, ?, 'pending_payment', ?, ?)`)
      .bind(patient.id, slotId, price, holdUntil).run()
    const appointmentId = Number(result.meta.last_row_id)
    await audit(env, 'patient', patient.id, 'appointment_reserved', 'appointment', appointmentId, { slot_id: slotId })
    return json({ ok: true, appointment_id: appointmentId, reserved_until: holdUntil, amount_cents: price }, 201)
  }

  if (path === '/api/appointments/mine' && request.method === 'GET') {
    await releaseExpiredHolds(env)
    const result = await env.DB.prepare(`
      SELECT a.id, a.status, a.amount_cents, a.payment_method, a.reserved_until, a.paid_at, av.starts_at, av.ends_at
      FROM appointments a JOIN availability av ON av.id = a.availability_id
      WHERE a.patient_id = ? ORDER BY av.starts_at DESC
    `).bind(patient.id).all()
    return json({ ok: true, appointments: result.results || [] })
  }

  if (/^\/api\/appointments\/\d+\/cancel$/.test(path) && request.method === 'POST') {
    const id = Number(path.split('/')[3])
    const appt = await env.DB.prepare(`SELECT * FROM appointments WHERE id = ? AND patient_id = ?`).bind(id, patient.id).first<any>()
    if (!appt) return json({ ok: false, message: 'Consulta não encontrada.' }, 404)
    if (appt.status === 'confirmed') return json({ ok: false, message: 'Cancelamento de consulta confirmada deve ser solicitado à profissional.' }, 409)
    await env.DB.batch([
      env.DB.prepare(`UPDATE appointments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id),
      env.DB.prepare(`UPDATE availability SET status = 'free', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'held'`).bind(appt.availability_id),
    ])
    return json({ ok: true })
  }

  if (path === '/api/payments/checkout' && request.method === 'POST') {
    const data = await body(request)
    const appointmentId = Number(data.appointment_id)
    const method = data.method === 'pix' ? 'pix' : data.method === 'card' ? 'credit_card' : ''
    const appt = await env.DB.prepare(`SELECT * FROM appointments WHERE id = ? AND patient_id = ?`).bind(appointmentId, patient.id).first<any>()
    if (!appt || appt.status !== 'pending_payment') return json({ ok: false, message: 'Reserva não disponível para pagamento.' }, 409)
    if (!method) return json({ ok: false, message: 'Forma de pagamento inválida.' }, 400)
    const pixDiscount = method === 'pix' ? Number(await setting(env, 'pix_discount_percent', '0')) : 0
    const amount = Math.max(0, Math.round(Number(appt.amount_cents) * (1 - pixDiscount / 100)))
    const provider = env.PAYMENT_PROVIDER || 'not-configured'
    const paymentResult = await env.DB.prepare(`INSERT INTO payments (appointment_id, provider, method, status, amount_cents) VALUES (?, ?, ?, 'pending', ?)`)
      .bind(appointmentId, provider, method, amount).run()
    const paymentId = Number(paymentResult.meta.last_row_id)

    if (!env.PAYMENT_API_URL || !env.PAYMENT_API_KEY) {
      return json({ ok: false, payment_id: paymentId, message: 'Gateway de pagamento ainda não configurado. A reserva continua aguardando pagamento.' }, 503)
    }

    const origin = env.APP_ORIGIN || new URL(request.url).origin
    const providerResponse = await fetch(env.PAYMENT_API_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.PAYMENT_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        amount_cents: amount,
        method,
        reference: String(paymentId),
        customer: { name: patient.full_name, email: patient.email, phone: patient.phone, cpf: patient.cpf },
        success_url: `${origin}/?payment=success`,
        cancel_url: `${origin}/?payment=cancelled`,
        webhook_url: `${origin}/api/payments/webhook`,
      }),
    })
    const providerData = await providerResponse.json().catch(() => ({})) as any
    if (!providerResponse.ok) {
      await env.DB.prepare(`UPDATE payments SET status = 'failed', raw_status = ? WHERE id = ?`).bind(JSON.stringify(providerData).slice(0, 1000), paymentId).run()
      return json({ ok: false, message: 'Não foi possível iniciar o pagamento.' }, 502)
    }
    const externalId = providerData.id || providerData.payment_id || providerData.reference
    const checkoutUrl = providerData.checkout_url || providerData.url || null
    const qrCode = providerData.pix_qr_code || providerData.qr_code || null
    const copyPaste = providerData.pix_copy_paste || providerData.copy_paste || null
    await env.DB.prepare(`UPDATE payments SET external_id = ?, checkout_url = ?, pix_qr_code = ?, pix_copy_paste = ?, raw_status = ? WHERE id = ?`)
      .bind(externalId || null, checkoutUrl, qrCode, copyPaste, providerData.status || 'pending', paymentId).run()
    await env.DB.prepare(`UPDATE appointments SET payment_method = ?, payment_provider = ?, payment_external_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(method, provider, externalId || null, appointmentId).run()
    return json({ ok: true, payment_id: paymentId, checkout_url: checkoutUrl, pix_qr_code: qrCode, pix_copy_paste: copyPaste, amount_cents: amount })
  }

  return json({ ok: false, message: 'Rota não encontrada.' }, 404)
}

async function handleAdmin(request: Request, env: Env, path: string) {
  if (path === '/api/admin/setup' && request.method === 'POST') {
    if (!env.ADMIN_SETUP_TOKEN || request.headers.get('x-setup-token') !== env.ADMIN_SETUP_TOKEN) return json({ ok: false, message: 'Setup não autorizado.' }, 403)
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM admin_users').first<any>()
    if (Number(count?.count || 0) > 0) return json({ ok: false, message: 'Administrador já configurado.' }, 409)
    const data = await body(request)
    const email = String(data.email || '').trim().toLowerCase()
    const password = String(data.password || '')
    const displayName = String(data.display_name || 'Psicóloga').trim()
    if (!email.includes('@') || password.length < 10) return json({ ok: false, message: 'Informe e-mail válido e senha com pelo menos 10 caracteres.' }, 400)
    const pwd = await hashPassword(password)
    const id = crypto.randomUUID()
    await env.DB.prepare(`INSERT INTO admin_users (id, email, password_hash, password_salt, display_name, role) VALUES (?, ?, ?, ?, ?, 'psychologist')`)
      .bind(id, email, pwd.hash, pwd.salt, displayName).run()
    return json({ ok: true, admin_id: id }, 201)
  }

  if (path === '/api/admin/login' && request.method === 'POST') {
    const data = await body(request)
    const email = String(data.email || '').trim().toLowerCase()
    const password = String(data.password || '')
    const admin = await env.DB.prepare(`SELECT * FROM admin_users WHERE email = ? AND active = 1`).bind(email).first<any>()
    if (!admin || !(await verifyPassword(password, admin.password_salt, admin.password_hash))) return json({ ok: false, message: 'E-mail ou senha inválidos.' }, 401)
    const token = await createAdminSession(admin.id, env)
    await audit(env, 'admin', admin.id, 'login', 'session')
    return json({ ok: true, admin: { id: admin.id, email: admin.email, display_name: admin.display_name, role: admin.role } }, 200, { 'set-cookie': cookie(ADMIN_COOKIE, token, SESSION_SECONDS) })
  }

  if (path === '/api/admin/logout' && request.method === 'POST') {
    const token = readCookie(request, ADMIN_COOKIE)
    if (token) await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256(token)).run()
    return json({ ok: true }, 200, { 'set-cookie': clearCookie(ADMIN_COOKIE) })
  }

  const admin = await adminFromRequest(request, env)
  if (!admin) return json({ ok: false, message: 'Acesso profissional necessário.' }, 401)

  if (path === '/api/admin/me' && request.method === 'GET') return json({ ok: true, admin })

  if (path === '/api/admin/patients' && request.method === 'GET') {
    const result = await env.DB.prepare(`
      SELECT p.id, p.full_name, p.birth_date, p.cpf, p.phone, p.email, p.created_at,
        COUNT(a.id) AS appointment_count,
        MAX(av.starts_at) AS last_appointment_at
      FROM patients p
      LEFT JOIN appointments a ON a.patient_id = p.id
      LEFT JOIN availability av ON av.id = a.availability_id
      GROUP BY p.id ORDER BY p.full_name
    `).all()
    return json({ ok: true, patients: result.results || [] })
  }

  const patientMatch = path.match(/^\/api\/admin\/patients\/(\d+)$/)
  if (patientMatch && request.method === 'GET') {
    const patientId = Number(patientMatch[1])
    const patient = await env.DB.prepare(`SELECT id, full_name, birth_date, cpf, phone, email, created_at FROM patients WHERE id = ?`).bind(patientId).first<any>()
    if (!patient) return json({ ok: false, message: 'Paciente não encontrado.' }, 404)
    const appointments = await env.DB.prepare(`SELECT a.id, a.status, a.amount_cents, a.paid_at, av.starts_at, av.ends_at FROM appointments a JOIN availability av ON av.id = a.availability_id WHERE a.patient_id = ? ORDER BY av.starts_at DESC`).bind(patientId).all()
    const notes = await env.DB.prepare(`SELECT id, appointment_id, session_date, note_text, created_at, updated_at FROM clinical_notes WHERE patient_id = ? ORDER BY session_date DESC, created_at DESC`).bind(patientId).all()
    return json({ ok: true, patient, appointments: appointments.results || [], clinical_notes: notes.results || [] })
  }

  const notesMatch = path.match(/^\/api\/admin\/patients\/(\d+)\/notes$/)
  if (notesMatch && request.method === 'POST') {
    const patientId = Number(notesMatch[1])
    const data = await body(request)
    const noteText = String(data.note_text || '').trim()
    const sessionDate = String(data.session_date || '').trim()
    const appointmentId = data.appointment_id ? Number(data.appointment_id) : null
    if (!noteText || !sessionDate) return json({ ok: false, message: 'Informe data da sessão e anotação.' }, 400)
    const id = crypto.randomUUID()
    await env.DB.prepare(`INSERT INTO clinical_notes (id, patient_id, appointment_id, author_admin_id, session_date, note_text) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, patientId, appointmentId, admin.id, sessionDate, noteText).run()
    await audit(env, 'admin', admin.id, 'clinical_note_created', 'clinical_note', id, { patient_id: patientId, appointment_id: appointmentId })
    return json({ ok: true, id }, 201)
  }

  const noteDeleteMatch = path.match(/^\/api\/admin\/notes\/([^/]+)$/)
  if (noteDeleteMatch && request.method === 'DELETE') {
    const id = decodeURIComponent(noteDeleteMatch[1])
    const existing = await env.DB.prepare('SELECT patient_id FROM clinical_notes WHERE id = ?').bind(id).first<any>()
    if (!existing) return json({ ok: false, message: 'Anotação não encontrada.' }, 404)
    await env.DB.prepare('DELETE FROM clinical_notes WHERE id = ?').bind(id).run()
    await audit(env, 'admin', admin.id, 'clinical_note_deleted', 'clinical_note', id, { patient_id: existing.patient_id })
    return json({ ok: true })
  }

  if (path === '/api/admin/appointments' && request.method === 'GET') {
    await releaseExpiredHolds(env)
    const result = await env.DB.prepare(`
      SELECT a.id, a.status, a.amount_cents, a.payment_method, a.paid_at, a.reserved_until,
        av.id AS availability_id, av.starts_at, av.ends_at,
        p.id AS patient_id, p.full_name, p.email, p.phone
      FROM appointments a
      JOIN availability av ON av.id = a.availability_id
      JOIN patients p ON p.id = a.patient_id
      ORDER BY av.starts_at DESC
    `).all()
    return json({ ok: true, appointments: result.results || [] })
  }

  if (path === '/api/admin/availability' && request.method === 'POST') {
    const data = await body(request)
    const startsAt = String(data.starts_at || '')
    const endsAt = String(data.ends_at || '')
    if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) return json({ ok: false, message: 'Intervalo de horário inválido.' }, 400)
    const conflict = await env.DB.prepare(`SELECT id FROM availability WHERE starts_at < ? AND ends_at > ? AND status != 'blocked' LIMIT 1`).bind(endsAt, startsAt).first()
    if (conflict) return json({ ok: false, message: 'Já existe um horário que conflita com esse intervalo.' }, 409)
    const result = await env.DB.prepare(`INSERT INTO availability (starts_at, ends_at, status) VALUES (?, ?, 'free')`).bind(startsAt, endsAt).run()
    return json({ ok: true, id: result.meta.last_row_id }, 201)
  }

  const availabilityMatch = path.match(/^\/api\/admin\/availability\/(\d+)$/)
  if (availabilityMatch && request.method === 'PATCH') {
    const slotId = Number(availabilityMatch[1])
    const data = await body(request)
    const slot = await env.DB.prepare('SELECT status FROM availability WHERE id = ?').bind(slotId).first<any>()
    if (!slot) return json({ ok: false, message: 'Horário não encontrado.' }, 404)
    if (slot.status === 'confirmed' || slot.status === 'held') return json({ ok: false, message: 'Não é possível bloquear um horário reservado ou confirmado.' }, 409)
    const next = data.blocked ? 'blocked' : 'free'
    await env.DB.prepare('UPDATE availability SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(next, slotId).run()
    return json({ ok: true, status: next })
  }

  if (path === '/api/admin/settings' && request.method === 'GET') {
    const result = await env.DB.prepare(`SELECT key, value FROM settings ORDER BY key`).all<any>()
    return json({ ok: true, settings: Object.fromEntries((result.results || []).map((r: any) => [r.key, r.value])) })
  }

  if (path === '/api/admin/settings' && request.method === 'PUT') {
    const data = await body(request)
    const allowed = ['consultation_price_cents', 'pix_discount_percent', 'timezone', 'appointment_duration_minutes', 'hold_minutes']
    for (const key of allowed) {
      if (data[key] !== undefined) {
        await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).bind(key, String(data[key])).run()
      }
    }
    await audit(env, 'admin', admin.id, 'settings_updated', 'settings', null, data)
    return json({ ok: true })
  }

  const appointmentStatusMatch = path.match(/^\/api\/admin\/appointments\/(\d+)\/status$/)
  if (appointmentStatusMatch && request.method === 'PATCH') {
    const appointmentId = Number(appointmentStatusMatch[1])
    const data = await body(request)
    const status = String(data.status || '')
    if (!['confirmed', 'cancelled'].includes(status)) return json({ ok: false, message: 'Status inválido.' }, 400)
    const appt = await env.DB.prepare('SELECT * FROM appointments WHERE id = ?').bind(appointmentId).first<any>()
    if (!appt) return json({ ok: false, message: 'Consulta não encontrada.' }, 404)
    await env.DB.batch([
      env.DB.prepare('UPDATE appointments SET status = ?, cancellation_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(status, data.reason || null, appointmentId),
      env.DB.prepare('UPDATE availability SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(status === 'confirmed' ? 'confirmed' : 'free', appt.availability_id),
    ])
    if (status === 'confirmed') await createCalendarEvent(env, appointmentId)
    await audit(env, 'admin', admin.id, 'appointment_status_changed', 'appointment', appointmentId, { status })
    return json({ ok: true })
  }

  return json({ ok: false, message: 'Rota administrativa não encontrada.' }, 404)
}

async function handlePaymentWebhook(request: Request, env: Env) {
  const raw = await request.text()
  if (env.PAYMENT_WEBHOOK_SECRET) {
    const signature = request.headers.get('x-signature') || request.headers.get('x-webhook-signature') || ''
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.PAYMENT_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const expectedBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
    const expected = Array.from(new Uint8Array(expectedBytes), (b) => b.toString(16).padStart(2, '0')).join('')
    if (!signature || signature !== expected) return json({ ok: false, message: 'Assinatura inválida.' }, 401)
  }
  let data: any = {}
  try { data = JSON.parse(raw) } catch { return json({ ok: false, message: 'Payload inválido.' }, 400) }
  const externalId = data.id || data.payment_id || data.reference
  const status = String(data.status || '').toLowerCase()
  const payment = externalId ? await env.DB.prepare('SELECT * FROM payments WHERE external_id = ? OR id = ?').bind(String(externalId), Number(externalId) || -1).first<any>() : null
  if (!payment) return json({ ok: false, message: 'Pagamento não encontrado.' }, 404)
  if (['approved', 'paid', 'confirmed', 'succeeded'].includes(status)) await confirmPayment(env, Number(payment.id), status)
  else await env.DB.prepare('UPDATE payments SET raw_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(status || 'unknown', payment.id).run()
  return json({ ok: true })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/api/health') {
      try {
        const result = await env.DB.prepare('SELECT 1 AS ok').first<any>()
        return json({ ok: true, database: result?.ok === 1 ? 'connected' : 'unexpected-response', worker: 'site-psicologa', timestamp: nowIso() })
      } catch (error) {
        return json({ ok: false, database: 'error', message: error instanceof Error ? error.message : 'Unknown database error' }, 500)
      }
    }

    if (path === '/api/payments/webhook' && request.method === 'POST') return handlePaymentWebhook(request, env)

    if (path.startsWith('/api/auth/')) {
      const response = await handlePatientAuth(request, env, path)
      if (response) return response
    }

    if (path.startsWith('/api/admin/')) return handleAdmin(request, env, path)
    if (path.startsWith('/api/')) return handlePatientApi(request, env, path)

    return env.ASSETS.fetch(request)
  },
}
