import { readCookie, sha256 } from './auth'
import { sendAppointmentConfirmationEmail } from './appointment-confirmation-email'
import type { Env } from './types'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
})
const nowIso = () => new Date().toISOString()
const plusMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()

async function patient(request: Request, env: Env) {
  const token = readCookie(request, 'ps_session')
  if (!token) return null
  return env.DB.prepare(`SELECT p.* FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(await sha256(token), nowIso())
    .first<any>()
}

async function setting(env: Env, key: string, fallback = '') {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first<any>()
  return row?.value ?? fallback
}

async function methodPrice(env: Env, method: 'pix' | 'credit_card', fallback: number) {
  const key = method === 'pix' ? 'pix_price_cents' : 'card_price_cents'
  const raw = await setting(env, key, '')
  if (raw !== '') return Math.max(0, Math.round(Number(raw) || 0))
  const legacy = Number(await setting(env, 'consultation_price_cents', String(fallback)))
  return Math.max(0, Math.round(legacy || fallback || 0))
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
  return ((await response.json()) as any).access_token || null
}

async function createCalendarEvent(env: Env, appointmentId: number) {
  const appointment = await env.DB.prepare(`SELECT a.google_calendar_event_id,av.starts_at,av.ends_at,p.full_name,p.email,p.phone FROM appointments a JOIN availability av ON av.id=a.availability_id JOIN patients p ON p.id=a.patient_id WHERE a.id=?`)
    .bind(appointmentId)
    .first<any>()
  if (!appointment || appointment.google_calendar_event_id) return appointment?.google_calendar_event_id || null

  const token = await googleAccessToken(env)
  if (!token) return null

  const calendar = encodeURIComponent(env.GOOGLE_CALENDAR_ID || 'primary')
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      summary: `Consulta – ${appointment.full_name}`,
      description: `Consulta confirmada pelo site. Contato: ${appointment.phone || appointment.email}.`,
      start: { dateTime: appointment.starts_at, timeZone: 'America/Sao_Paulo' },
      end: { dateTime: appointment.ends_at, timeZone: 'America/Sao_Paulo' },
    }),
  })
  if (!response.ok) return null

  const event = await response.json() as any
  if (event.id) {
    await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(event.id, appointmentId)
      .run()
  }
  return event.id || null
}

async function confirm(env: Env, payment: any, rawStatus: string, actualMethod?: string) {
  if (payment.status === 'approved') return
  const appointment = await env.DB.prepare('SELECT * FROM appointments WHERE id=?').bind(payment.appointment_id).first<any>()
  if (!appointment) return

  await env.DB.batch([
    env.DB.prepare(`UPDATE payments SET status='approved',raw_status=?,method=COALESCE(?,method),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(rawStatus, actualMethod || null, payment.id),
    env.DB.prepare(`UPDATE appointments SET status='confirmed',amount_cents=?,paid_at=CURRENT_TIMESTAMP,payment_method=COALESCE(?,payment_method),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(Number(payment.amount_cents), actualMethod || null, appointment.id),
    env.DB.prepare(`UPDATE availability SET status='confirmed',public_visibility='visible',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(appointment.availability_id),
  ])

  await createCalendarEvent(env, Number(appointment.id))
  await sendAppointmentConfirmationEmail(env, Number(appointment.id))
}

async function expirePayment(env: Env, payment: any, rawStatus: string) {
  const appointment = await env.DB.prepare('SELECT * FROM appointments WHERE id=?').bind(payment.appointment_id).first<any>()
  if (!appointment) return

  await env.DB.batch([
    env.DB.prepare(`UPDATE payments SET status='failed',raw_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='approved'`)
      .bind(rawStatus, payment.id),
    env.DB.prepare(`UPDATE appointments SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending_payment'`)
      .bind(appointment.id),
    env.DB.prepare(`UPDATE availability SET status='free',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='held'`)
      .bind(appointment.availability_id),
  ])
}

async function fetchMercadoPagoOrder(env: Env, orderId: string) {
  if (!env.MERCADOPAGO_ACCESS_TOKEN) return null
  const response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: { authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`, accept: 'application/json' },
  })
  if (!response.ok) return null
  return await response.json() as any
}

async function verifyMercadoPago(env: Env, orderId: string, payment: any) {
  const data = await fetchMercadoPagoOrder(env, orderId)
  if (!data) return false

  const transaction = data?.transactions?.payments?.[0]
  const amountCents = Math.round(Number(data.total_amount ?? transaction?.amount ?? 0) * 100)
  const method = String(transaction?.payment_method?.id || '').toLowerCase()
  const status = String(data.status || '').toLowerCase()
  const detail = String(data.status_detail || transaction?.status_detail || '').toLowerCase()
  const raw = `${status}:${detail}`

  if (status === 'processed' && detail === 'accredited' && method === 'pix' && amountCents === Number(payment.amount_cents)) {
    await confirm(env, payment, raw, 'pix')
    return true
  }

  if (['failed', 'canceled', 'expired'].includes(status)) await expirePayment(env, payment, raw)
  else await env.DB.prepare(`UPDATE payments SET raw_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(raw, payment.id).run()
  return false
}

async function verifyInfinitePay(env: Env, payload: any, payment: any) {
  if (!env.INFINITEPAY_HANDLE) return false
  const slug = payload.invoice_slug || payload.slug
  const transaction = payload.transaction_nsu
  if (!slug || !transaction) return false

  const response = await fetch('https://api.checkout.infinitepay.io/payment_check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      handle: env.INFINITEPAY_HANDLE,
      order_nsu: String(payment.id),
      transaction_nsu: transaction,
      slug,
    }),
  })
  if (!response.ok) return false

  const data = await response.json() as any
  const method = String(data.capture_method || payload.capture_method || 'credit_card')
  if (data.paid === true && Number(data.amount) === Number(payment.amount_cents) && method !== 'pix') {
    await confirm(env, payment, 'paid', 'credit_card')
    return true
  }

  await env.DB.prepare(`UPDATE payments SET raw_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(data.paid ? 'method_or_amount_mismatch' : 'not_paid', payment.id)
    .run()
  return false
}

async function createMercadoPagoPix(env: Env, p: any, appointmentId: number, paymentId: number, amount: number, holdMinutes: number) {
  if (!env.MERCADOPAGO_ACCESS_TOKEN) throw new Error('Mercado Pago ainda não configurado.')

  const expirationMinutes = Math.max(30, Math.min(43_200, holdMinutes || 30))
  const amountString = (amount / 100).toFixed(2)
  const payload = {
    type: 'online',
    total_amount: amountString,
    external_reference: `consulta-${appointmentId}-pagamento-${paymentId}`,
    processing_mode: 'automatic',
    transactions: {
      payments: [{
        amount: amountString,
        payment_method: { id: 'pix', type: 'bank_transfer' },
        expiration_time: `PT${expirationMinutes}M`,
      }],
    },
    payer: { email: p.email },
  }

  const response = await fetch('https://api.mercadopago.com/v1/orders', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'X-Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({})) as any
  if (!response.ok) throw new Error(String(data?.message || data?.error || 'Não foi possível gerar o Pix no Mercado Pago.'))

  const orderId = String(data.id || '')
  const transaction = data?.transactions?.payments?.[0]
  const paymentMethod = transaction?.payment_method || {}
  const qrBase64 = String(paymentMethod.qr_code_base64 || '')
  const qrDataUrl = qrBase64 ? `data:image/png;base64,${qrBase64}` : null
  const copyPaste = paymentMethod.qr_code ? String(paymentMethod.qr_code) : null
  const ticketUrl = paymentMethod.ticket_url ? String(paymentMethod.ticket_url) : null

  if (!orderId || (!qrDataUrl && !copyPaste && !ticketUrl)) {
    throw new Error('O Mercado Pago criou a cobrança, mas não retornou os dados do Pix.')
  }

  return {
    orderId,
    qrDataUrl,
    copyPaste,
    ticketUrl,
    rawStatus: `${String(data.status || 'created')}:${String(data.status_detail || '')}`,
  }
}

function parseMercadoPagoSignature(header: string) {
  let ts = ''
  let v1 = ''
  for (const part of header.split(',')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key === 'ts') ts = value
    if (key === 'v1') v1 = value.toLowerCase()
  }
  return { ts, v1 }
}

async function hmacSha256Hex(secret: string, message: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeHexEquals(left: string, right: string) {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return mismatch === 0
}

async function validMercadoPagoWebhook(request: Request, env: Env) {
  if (!env.MERCADOPAGO_WEBHOOK_SECRET) return true

  const xSignature = request.headers.get('x-signature') || ''
  const xRequestId = request.headers.get('x-request-id') || ''
  const { ts, v1 } = parseMercadoPagoSignature(xSignature)
  if (!ts || !v1) return false

  const url = new URL(request.url)
  const dataId = String(url.searchParams.get('data.id') || url.searchParams.get('data_id') || '').toLowerCase()
  let manifest = ''
  if (dataId) manifest += `id:${dataId};`
  if (xRequestId) manifest += `request-id:${xRequestId};`
  manifest += `ts:${ts};`

  const calculated = await hmacSha256Hex(env.MERCADOPAGO_WEBHOOK_SECRET, manifest)
  return constantTimeHexEquals(calculated, v1)
}

export async function handlePaymentsV2(request: Request, env: Env, path: string, ctx: ExecutionContext): Promise<Response | null> {
  if (path === '/api/payments/checkout' && request.method === 'POST') {
    const p = await patient(request, env)
    if (!p) return json({ ok: false, message: 'Faça login para continuar.' }, 401)

    const data = await request.json().catch(() => ({})) as any
    const appointmentId = Number(data.appointment_id)
    const requested = data.method === 'pix' ? 'pix' : data.method === 'card' ? 'credit_card' : ''
    if (!requested) return json({ ok: false, message: 'Forma de pagamento inválida.' }, 400)

    const appointment = await env.DB.prepare(`SELECT * FROM appointments WHERE id=? AND patient_id=?`)
      .bind(appointmentId, p.id)
      .first<any>()
    if (!appointment || appointment.status !== 'pending_payment') return json({ ok: false, message: 'Reserva não disponível para pagamento.' }, 409)
    if (appointment.reserved_until && new Date(appointment.reserved_until).getTime() <= Date.now()) {
      return json({ ok: false, message: 'O tempo desta reserva expirou. Escolha o horário novamente.' }, 409)
    }

    const amount = await methodPrice(env, requested as 'pix' | 'credit_card', Number(appointment.amount_cents || 0))
    if (amount <= 0) return json({ ok: false, message: 'O valor da sessão ainda não foi configurado pela profissional.' }, 409)
    const provider = requested === 'pix' ? 'mercadopago' : 'infinitepay'

    if (requested === 'pix') {
      const existing = await env.DB.prepare(`SELECT * FROM payments WHERE appointment_id=? AND provider='mercadopago' AND status='pending' ORDER BY id DESC LIMIT 1`)
        .bind(appointmentId)
        .first<any>()
      if (existing?.external_id) {
        await verifyMercadoPago(env, String(existing.external_id), existing)
        const fresh = await env.DB.prepare(`SELECT * FROM payments WHERE id=?`).bind(existing.id).first<any>()
        const currentAppointment = await env.DB.prepare(`SELECT status FROM appointments WHERE id=?`).bind(appointmentId).first<any>()
        if (currentAppointment?.status === 'confirmed') {
          return json({ ok: true, payment_id: fresh.id, provider: 'mercadopago', status: 'approved', amount_cents: Number(fresh.amount_cents) })
        }
        return json({
          ok: true,
          payment_id: fresh.id,
          provider: 'mercadopago',
          pix_qr_code: fresh.pix_qr_code,
          pix_copy_paste: fresh.pix_copy_paste,
          checkout_url: fresh.checkout_url,
          amount_cents: Number(fresh.amount_cents),
        })
      }
    }

    await env.DB.prepare(`UPDATE appointments SET amount_cents=?,payment_method=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(amount, requested, appointmentId)
      .run()
    const inserted = await env.DB.prepare(`INSERT INTO payments (appointment_id,provider,method,status,amount_cents) VALUES (?,?,?,'pending',?)`)
      .bind(appointmentId, provider, requested, amount)
      .run()
    const paymentId = Number(inserted.meta.last_row_id)
    const origin = env.APP_ORIGIN || new URL(request.url).origin

    if (requested === 'pix') {
      const holdMinutes = Math.max(30, Number(await setting(env, 'hold_minutes', '30')) || 30)
      await env.DB.prepare(`UPDATE appointments SET reserved_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending_payment'`)
        .bind(plusMinutes(holdMinutes), appointmentId)
        .run()
      try {
        const mp = await createMercadoPagoPix(env, p, appointmentId, paymentId, amount, holdMinutes)
        await env.DB.prepare(`UPDATE payments SET external_id=?,checkout_url=?,pix_qr_code=?,pix_copy_paste=?,raw_status=? WHERE id=?`)
          .bind(mp.orderId, mp.ticketUrl, mp.qrDataUrl, mp.copyPaste, mp.rawStatus, paymentId)
          .run()
        await env.DB.prepare(`UPDATE appointments SET payment_provider='mercadopago',payment_external_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(mp.orderId, appointmentId)
          .run()
        return json({
          ok: true,
          payment_id: paymentId,
          provider: 'mercadopago',
          pix_qr_code: mp.qrDataUrl,
          pix_copy_paste: mp.copyPaste,
          checkout_url: mp.ticketUrl,
          amount_cents: amount,
        })
      } catch (error) {
        await env.DB.prepare(`UPDATE payments SET status='failed',raw_status=? WHERE id=?`)
          .bind(error instanceof Error ? error.message : String(error), paymentId)
          .run()
        return json({
          ok: false,
          payment_id: paymentId,
          message: error instanceof Error ? error.message : 'Não foi possível gerar o Pix no Mercado Pago.',
        }, 503)
      }
    }

    if (!env.INFINITEPAY_HANDLE) return json({ ok: false, payment_id: paymentId, message: 'InfinitePay ainda não configurada.' }, 503)
    const response = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: env.INFINITEPAY_HANDLE,
        items: [{ quantity: 1, price: amount, description: 'Consulta psicológica' }],
        order_nsu: String(paymentId),
        redirect_url: `${origin}/?payment=return&provider=infinitepay`,
        webhook_url: `${origin}/api/payments/webhook/infinitepay`,
        customer: { name: p.full_name, email: p.email, phone_number: p.phone },
      }),
    })
    const responseData = await response.json().catch(() => ({})) as any
    if (!response.ok) {
      await env.DB.prepare(`UPDATE payments SET status='failed',raw_status=? WHERE id=?`)
        .bind(JSON.stringify(responseData).slice(0, 1000), paymentId)
        .run()
      return json({ ok: false, message: 'Não foi possível abrir o checkout da InfinitePay.' }, 502)
    }

    const checkoutUrl = responseData.url || responseData.checkout_url || responseData.link || null
    const external = String(responseData.slug || responseData.id || '')
    if (!checkoutUrl) {
      await env.DB.prepare(`UPDATE payments SET status='failed',raw_status='missing_checkout_url' WHERE id=?`).bind(paymentId).run()
      return json({ ok: false, message: 'A InfinitePay não retornou o link de pagamento.' }, 502)
    }

    await env.DB.prepare(`UPDATE payments SET external_id=?,checkout_url=?,raw_status='created' WHERE id=?`)
      .bind(external || null, checkoutUrl, paymentId)
      .run()
    await env.DB.prepare(`UPDATE appointments SET payment_provider='infinitepay',payment_external_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(external || null, appointmentId)
      .run()
    return json({ ok: true, payment_id: paymentId, provider: 'infinitepay', checkout_url: checkoutUrl, amount_cents: amount })
  }

  const statusMatch = path.match(/^\/api\/payments\/status\/(\d+)$/)
  if (statusMatch && request.method === 'GET') {
    const p = await patient(request, env)
    if (!p) return json({ ok: false, message: 'Faça login para continuar.' }, 401)
    const appointmentId = Number(statusMatch[1])
    const appointment = await env.DB.prepare(`SELECT * FROM appointments WHERE id=? AND patient_id=?`).bind(appointmentId, p.id).first<any>()
    if (!appointment) return json({ ok: false, message: 'Consulta não encontrada.' }, 404)
    const payment = await env.DB.prepare(`SELECT * FROM payments WHERE appointment_id=? ORDER BY id DESC LIMIT 1`).bind(appointmentId).first<any>()
    if (payment?.provider === 'mercadopago' && payment.external_id && payment.status !== 'approved') {
      await verifyMercadoPago(env, String(payment.external_id), payment)
    }
    const fresh = await env.DB.prepare(`SELECT status,paid_at,reserved_until FROM appointments WHERE id=?`).bind(appointmentId).first<any>()
    return json({ ok: true, appointment: fresh })
  }

  if (path === '/api/payments/webhook/mercadopago' && request.method === 'POST') {
    if (!(await validMercadoPagoWebhook(request, env))) {
      return json({ ok: false, message: 'Assinatura do webhook inválida.' }, 401)
    }

    const payload = await request.json().catch(() => ({})) as any
    const url = new URL(request.url)
    const orderId = String(payload?.data?.id || payload?.id || url.searchParams.get('data.id') || url.searchParams.get('data_id') || '')
    if (orderId) {
      const payment = await env.DB.prepare(`SELECT * FROM payments WHERE provider='mercadopago' AND external_id=? ORDER BY id DESC LIMIT 1`)
        .bind(orderId)
        .first<any>()
      if (payment) ctx.waitUntil(verifyMercadoPago(env, orderId, payment))
    }
    return json({ ok: true }, 200)
  }

  if (path === '/api/payments/webhook/infinitepay' && request.method === 'POST') {
    const payload = await request.json().catch(() => ({})) as any
    const id = Number(payload.order_nsu)
    const payment = id
      ? await env.DB.prepare(`SELECT * FROM payments WHERE id=? AND provider='infinitepay'`).bind(id).first<any>()
      : null
    if (payment) ctx.waitUntil(verifyInfinitePay(env, payload, payment))
    return new Response(null, { status: 200 })
  }

  return null
}
