import { adminAuthSchemaStatus } from './admin-auth-schema'
import type { Env } from './types'

export const APP_RELEASE = '2026.09.05-automation-reliability-v1'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
})

function sanitizeEmailError(value: unknown): string | null {
  if (!value) return null
  let text = String(value)
  text = text.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
  text = text.replace(/re_[A-Za-z0-9_-]+/g, '[api_key]')
  return text.slice(0, 500)
}

export async function handleHealthApi(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/api/health' || request.method !== 'GET') return null

  const url = new URL(request.url)
  const probeDatabase = url.searchParams.get('db') === '1'
  const probeEmail = url.searchParams.get('email') === '1'
  const probeAutomation = url.searchParams.get('automation') === '1'
  const base = {
    ok: true,
    service: 'site-psicologa',
    release: APP_RELEASE,
    worker: 'online',
    timestamp: new Date().toISOString(),
  }

  if (!probeDatabase && !probeEmail && !probeAutomation) return json({ ...base, database: 'not_checked' })

  try {
    const row = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>()
    const database = row?.ok === 1 ? 'online' : 'unexpected_response'
    const adminAuth = probeDatabase && database === 'online' ? await adminAuthSchemaStatus(env) : 'not_checked'

    let email: unknown = 'not_checked'
    if (probeEmail && database === 'online') {
      const stats = await env.DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status='sending' THEN 1 ELSE 0 END) AS sending,
          SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
        FROM patient_notifications
        WHERE channel='email' AND created_at>=datetime('now','-1 day')
      `).first<any>()
      const lastFailure = await env.DB.prepare(`
        SELECT error_message, created_at
        FROM patient_notifications
        WHERE channel='email' AND status='failed'
        ORDER BY created_at DESC
        LIMIT 1
      `).first<any>()
      email = {
        provider: 'resend',
        api_key_configured: Boolean(env.RESEND_API_KEY),
        from_configured: Boolean(env.EMAIL_FROM),
        configured: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM),
        attempts_last_24h: Number(stats?.total || 0),
        sent_last_24h: Number(stats?.sent || 0),
        failed_last_24h: Number(stats?.failed || 0),
        sending_last_24h: Number(stats?.sending || 0),
        pending_last_24h: Number(stats?.pending || 0),
        last_failed_at: lastFailure?.created_at || null,
        last_failed_error: sanitizeEmailError(lastFailure?.error_message),
      }
    }

    let automation: unknown = 'not_checked'
    if (probeAutomation && database === 'online') {
      const recurrence = await env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM patient_recurrence WHERE active=1) AS active_rules,
          (SELECT COUNT(*) FROM appointments WHERE reservation_kind='recurring' AND status='pending_payment') AS recurring_pending,
          (SELECT COUNT(*) FROM appointments WHERE reservation_kind='recurring' AND status='expired' AND updated_at>=datetime('now','-1 day')) AS recurring_expired_24h,
          (SELECT MIN(payment_deadline_at) FROM appointments WHERE reservation_kind='recurring' AND status='pending_payment' AND datetime(payment_deadline_at)>datetime('now')) AS next_payment_deadline
      `).first<any>()
      const notifications = await env.DB.prepare(`
        SELECT
          SUM(CASE WHEN kind='recurring_created' AND status='sent' THEN 1 ELSE 0 END) AS recurring_created,
          SUM(CASE WHEN kind='payment_reminder' AND status='sent' THEN 1 ELSE 0 END) AS payment_reminders,
          SUM(CASE WHEN kind='payment_final' AND status='sent' THEN 1 ELSE 0 END) AS payment_final,
          SUM(CASE WHEN kind='appointment_reminder' AND status='sent' THEN 1 ELSE 0 END) AS appointment_reminders,
          SUM(CASE WHEN kind='reservation_expired' AND status='sent' THEN 1 ELSE 0 END) AS reservation_expired
        FROM patient_notifications
        WHERE channel='email' AND created_at>=datetime('now','-1 day')
      `).first<any>()
      automation = {
        cron_expected_every_minutes: 15,
        active_recurrence_rules: Number(recurrence?.active_rules || 0),
        recurring_pending_payment: Number(recurrence?.recurring_pending || 0),
        recurring_expired_last_24h: Number(recurrence?.recurring_expired_24h || 0),
        next_recurring_payment_deadline_at: recurrence?.next_payment_deadline || null,
        recurring_created_emails_last_24h: Number(notifications?.recurring_created || 0),
        payment_reminder_emails_last_24h: Number(notifications?.payment_reminders || 0),
        payment_final_emails_last_24h: Number(notifications?.payment_final || 0),
        appointment_reminder_emails_last_24h: Number(notifications?.appointment_reminders || 0),
        reservation_expired_emails_last_24h: Number(notifications?.reservation_expired || 0),
      }
    }

    const healthy = database === 'online' && (!probeDatabase || adminAuth === 'online')
    return json({ ...base, ok: healthy, database, admin_auth: adminAuth, email, automation }, healthy ? 200 : 503)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('Health D1 probe error:', detail)
    const quotaExceeded = /exceeded|free tier|row read limit/i.test(detail)
    return json({
      ...base,
      ok: false,
      database: quotaExceeded ? 'quota_exceeded' : 'unavailable',
      admin_auth: 'not_checked',
      email: probeEmail ? 'unavailable' : 'not_checked',
      automation: probeAutomation ? 'unavailable' : 'not_checked',
      message: quotaExceeded
        ? 'A cota diária do banco de dados foi atingida.'
        : 'O banco de dados está temporariamente indisponível.',
    }, 503)
  }
}
