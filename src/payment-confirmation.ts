import { sendAppointmentConfirmationEmail } from './appointment-confirmation-email'
import { syncPortalAppointmentToGoogle } from './google-calendar-sync'
import { expireUnpaidReservations } from './session-management'
import type { Env } from './types'

export async function confirmVerifiedPayment(env: Env, payment: any, rawStatus: string, actualMethod?: string) {
  if (payment.status === 'approved') return false
  const appointment = await env.DB.prepare('SELECT * FROM appointments WHERE id=?').bind(payment.appointment_id).first<any>()
  if (!appointment) return false

  // A verified payment is a financial fact, but it cannot reclaim an expired slot.
  // Check current reservation/slot ownership inside the same transaction as the write.
  const [confirmed] = await env.DB.batch([
    env.DB.prepare(`UPDATE appointments SET status='confirmed',amount_cents=?,paid_at=CURRENT_TIMESTAMP,payment_method=COALESCE(?,payment_method),updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND availability_id=? AND status='pending_payment'
        AND julianday(COALESCE(payment_deadline_at,reserved_until))>julianday('now')
        AND EXISTS (SELECT 1 FROM availability WHERE id=appointments.availability_id AND status='held')
        AND NOT EXISTS (SELECT 1 FROM appointments other WHERE other.availability_id=appointments.availability_id AND other.id<>appointments.id AND other.status IN ('pending_payment','confirmed'))
        AND EXISTS (SELECT 1 FROM payments WHERE id=? AND appointment_id=appointments.id AND status<>'approved')`)
      .bind(Number(payment.amount_cents), actualMethod || null, appointment.id, appointment.availability_id, payment.id),
    env.DB.prepare(`UPDATE availability SET status='confirmed',public_visibility='visible',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='held' AND changes()=1`)
      .bind(appointment.availability_id),
    // changes() refers to the slot update: zero means no reservation was confirmed.
    // Record the exception durably with the payment, without sending a confirmation.
    env.DB.prepare(`INSERT OR IGNORE INTO audit_log(id,actor_type,action,entity_type,entity_id,metadata_json)
      SELECT ?,'system','payment_approved_requires_review','payment',?,?
      WHERE changes()=0 AND EXISTS (SELECT 1 FROM payments WHERE id=? AND status<>'approved')`)
      .bind(`payment-approved-review:${payment.id}`,String(payment.id),JSON.stringify({appointment_id:appointment.id,amount_cents:Number(payment.amount_cents),reason:'reservation_not_active_or_slot_unavailable',raw_status:rawStatus}),payment.id),
    env.DB.prepare(`UPDATE payments SET status='approved',raw_status=?,method=COALESCE(?,method),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'approved'`)
      .bind(rawStatus, actualMethod || null, payment.id),
  ])

  if (!Number(confirmed.meta.changes || 0)) {
    // The cron may not have processed an overdue pending reservation yet.
    // This cleanup keeps the approved payment and expires overdue pending reservations.
    await expireUnpaidReservations(env)
    return false
  }

  // A reserva já pode ter criado o evento no Google como "Pendente de pagamento".
  // Ao confirmar o pagamento, sincronizamos o MESMO evento para "Confirmada".
  // syncPortalAppointmentToGoogle faz PATCH quando google_calendar_event_id já existe
  // e só cria um novo evento se o vínculo anterior não existir mais.
  await syncPortalAppointmentToGoogle(env, Number(appointment.id))
  await sendAppointmentConfirmationEmail(env, Number(appointment.id))
  return true
}
