import type { Env } from './types'

async function tableExists(env: Env, name: string) {
  return Boolean(await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(name).first<any>())
}

function isStandardSession(startsAt: string, endsAt: string) {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false
  const duration = (end.getTime() - start.getTime()) / 60000
  const weekday = start.getUTCDay()
  return weekday >= 1 && weekday <= 6 && start.getUTCMinutes() === 0 && duration === 50
}

export async function cleanupLegacyAgenda(env: Env) {
  const candidates = await env.DB.prepare(`
    SELECT id,starts_at,ends_at,status,COALESCE(source,'manual') AS source
    FROM availability
    WHERE COALESCE(source,'manual')='manual'
      AND status IN ('free','occupied','blocked')
  `).all<any>()

  const legacy = (candidates.results || []).filter((row: any) => !isStandardSession(row.starts_at, row.ends_at))
  if (!legacy.length) return 0

  const hasAppointments = await tableExists(env, 'appointments')
  const deletable: number[] = []

  for (const row of legacy) {
    if (hasAppointments) {
      const linked = await env.DB.prepare(`
        SELECT id FROM appointments
        WHERE availability_id=? AND status IN ('pending_payment','confirmed')
        LIMIT 1
      `).bind(row.id).first<any>()
      if (linked) continue
    }
    deletable.push(Number(row.id))
  }

  if (deletable.length) {
    await env.DB.batch(deletable.map(id => env.DB.prepare('DELETE FROM availability WHERE id=?').bind(id)))
  }

  return deletable.length
}
