import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
const nowIso = () => new Date().toISOString()

async function patient(request: Request, env: Env) {
  const token = readCookie(request, 'ps_session')
  if (!token) return null
  return env.DB.prepare(`SELECT p.id FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(await sha256(token), nowIso()).first<any>()
}

async function admin(request: Request, env: Env) {
  const token = readCookie(request, 'ps_admin_session')
  if (!token) return null
  return env.DB.prepare(`SELECT a.id,a.role FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`)
    .bind(await sha256(token), nowIso()).first<any>()
}

async function tableExists(env: Env, name: string) {
  return Boolean(await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(name).first<any>())
}

async function releaseExpired(env: Env) {
  if (!(await tableExists(env, 'appointments'))) return
  const rows = await env.DB.prepare(`SELECT id,availability_id FROM appointments WHERE status='pending_payment' AND reserved_until IS NOT NULL AND reserved_until < ?`).bind(nowIso()).all<any>()
  for (const row of rows.results || []) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE appointments SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending_payment'`).bind(row.id),
      env.DB.prepare(`UPDATE availability SET status='free',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='held'`).bind(row.availability_id),
    ])
  }
}

function dateParts(value: string) {
  const [y,m,d] = value.split('-').map(Number)
  return { y,m,d }
}

function weekdayForDate(value: string) {
  const { y,m,d } = dateParts(value)
  return new Date(Date.UTC(y,m-1,d,12,0,0)).getUTCDay()
}

function addDate(value: string, days: number) {
  const { y,m,d } = dateParts(value)
  const dt = new Date(Date.UTC(y,m-1,d+days,12,0,0))
  return dt.toISOString().slice(0,10)
}

async function materializeRule(env: Env, rule: any) {
  let date = rule.date_from
  while (date <= rule.date_to) {
    if (weekdayForDate(date) === Number(rule.weekday)) {
      const startsAt = `${date}T${rule.start_time}:00-03:00`
      const endsAt = `${date}T${rule.end_time}:00-03:00`
      const existing = await env.DB.prepare(`SELECT id,status,recurring_block_id FROM availability WHERE starts_at < ? AND ends_at > ? LIMIT 1`).bind(endsAt, startsAt).first<any>()
      if (!existing) {
        await env.DB.prepare(`INSERT INTO availability (starts_at,ends_at,status,public_visibility,source,recurring_block_id) VALUES (?,?,'blocked','visible','recurring_block',?)`).bind(startsAt,endsAt,rule.id).run()
      } else if (existing.status === 'free') {
        await env.DB.prepare(`UPDATE availability SET status='blocked',public_visibility='visible',source='recurring_block',recurring_block_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(rule.id,existing.id).run()
      }
    }
    date = addDate(date,1)
  }
}

export async function handleScheduleV2(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path === '/api/availability' && request.method === 'GET') {
    const p = await patient(request, env)
    if (!p) return json({ ok:false,message:'Faça login para continuar.' },401)
    await releaseExpired(env)
    const url = new URL(request.url)
    const from = url.searchParams.get('from') || nowIso()
    const to = url.searchParams.get('to') || new Date(Date.now()+60*86400000).toISOString()
    const result = await env.DB.prepare(`
      SELECT id,starts_at,ends_at,status,
        CASE WHEN status='free' THEN 'free' WHEN status='blocked' THEN 'blocked' ELSE 'occupied' END AS public_status
      FROM availability
      WHERE COALESCE(public_visibility,'visible')='visible' AND starts_at>=? AND starts_at<=?
      ORDER BY starts_at ASC
    `).bind(from,to).all<any>()
    const settings = await env.DB.prepare(`SELECT key,value FROM settings WHERE key IN ('consultation_price_cents','pix_discount_percent')`).all<any>()
    const map = Object.fromEntries((settings.results || []).map((r:any)=>[r.key,r.value]))
    return json({ ok:true, slots:result.results||[], consultation_price_cents:Number(map.consultation_price_cents||0), pix_discount_percent:Number(map.pix_discount_percent||0) })
  }

  if (!path.startsWith('/api/admin/')) return null
  const a = await admin(request, env)
  if (!a) return null

  if (path === '/api/admin/availability-v2' && request.method === 'GET') {
    const url = new URL(request.url)
    const from = url.searchParams.get('from') || nowIso()
    const to = url.searchParams.get('to') || new Date(Date.now()+730*86400000).toISOString()
    let slots:any
    if (await tableExists(env,'appointments') && await tableExists(env,'patients')) {
      slots = await env.DB.prepare(`
        SELECT av.id,av.starts_at,av.ends_at,av.status,
          COALESCE(av.public_visibility,'visible') AS public_visibility,
          COALESCE(av.source,'manual') AS source,av.recurring_block_id,
          a.id AS appointment_id,a.status AS appointment_status,a.amount_cents,a.paid_at,a.reserved_until,
          p.id AS patient_id,p.full_name,p.email,p.phone
        FROM availability av
        LEFT JOIN appointments a ON a.availability_id=av.id AND a.status IN ('pending_payment','confirmed')
        LEFT JOIN patients p ON p.id=a.patient_id
        WHERE av.starts_at>=? AND av.starts_at<=?
        ORDER BY av.starts_at
      `).bind(from,to).all<any>()
    } else {
      slots = await env.DB.prepare(`SELECT id,starts_at,ends_at,status,COALESCE(public_visibility,'visible') AS public_visibility,COALESCE(source,'manual') AS source,recurring_block_id FROM availability WHERE starts_at>=? AND starts_at<=? ORDER BY starts_at`).bind(from,to).all<any>()
    }
    const rules = await env.DB.prepare(`SELECT * FROM recurring_blocks ORDER BY active DESC,weekday,start_time`).all<any>()
    return json({ ok:true, slots:slots.results||[], recurring_blocks:rules.results||[] })
  }

  const deleteMatch = path.match(/^\/api\/admin\/availability\/(\d+)$/)
  if (deleteMatch && request.method === 'DELETE') {
    const id = Number(deleteMatch[1])
    const slot = await env.DB.prepare(`SELECT id,status FROM availability WHERE id=?`).bind(id).first<any>()
    if (!slot) return json({ ok:false,message:'Horário não encontrado.' },404)
    if (['held','confirmed'].includes(String(slot.status))) return json({ ok:false,message:'Horário reservado ou confirmado não pode ser excluído.' },409)
    if (await tableExists(env, 'appointments')) {
      const linked = await env.DB.prepare(`SELECT id FROM appointments WHERE availability_id=? LIMIT 1`).bind(id).first<any>()
      if (linked) return json({ ok:false,message:'Este horário possui histórico de consulta e não pode ser excluído. Use ocultar ou bloquear.' },409)
    }
    await env.DB.prepare(`DELETE FROM availability WHERE id=?`).bind(id).run()
    return json({ ok:true })
  }

  const modeMatch = path.match(/^\/api\/admin\/availability\/(\d+)\/mode$/)
  if (modeMatch && request.method === 'PATCH') {
    const id = Number(modeMatch[1])
    const data = await request.json().catch(()=>({})) as any
    const slot = await env.DB.prepare(`SELECT * FROM availability WHERE id=?`).bind(id).first<any>()
    if (!slot) return json({ ok:false,message:'Horário não encontrado.' },404)
    if (['held','confirmed'].includes(slot.status) && ['blocked','occupied','hidden'].includes(data.mode)) return json({ ok:false,message:'Horário reservado ou confirmado não pode ser alterado dessa forma.' },409)
    if (data.mode === 'blocked') await env.DB.prepare(`UPDATE availability SET status='blocked',public_visibility='visible',source='manual',recurring_block_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run()
    else if (data.mode === 'occupied') await env.DB.prepare(`UPDATE availability SET status='occupied',public_visibility='visible',source='manual',recurring_block_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run()
    else if (data.mode === 'free') await env.DB.prepare(`UPDATE availability SET status='free',public_visibility='visible',source='manual',recurring_block_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run()
    else if (data.mode === 'hidden') await env.DB.prepare(`UPDATE availability SET public_visibility='hidden',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run()
    else if (data.mode === 'visible') await env.DB.prepare(`UPDATE availability SET public_visibility='visible',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run()
    else return json({ ok:false,message:'Modo inválido.' },400)
    return json({ ok:true })
  }

  if (path === '/api/admin/recurring-blocks' && request.method === 'POST') {
    const data = await request.json().catch(()=>({})) as any
    const weekdays = Array.isArray(data.weekdays) ? data.weekdays.map(Number).filter((n:number)=>n>=0&&n<=6) : []
    const startTime = String(data.start_time||'')
    const endTime = String(data.end_time||'')
    const dateFrom = String(data.date_from||new Date().toISOString().slice(0,10))
    const dateTo = String(data.date_to||new Date(Date.now()+90*86400000).toISOString().slice(0,10))
    if (!weekdays.length || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || endTime<=startTime) return json({ ok:false,message:'Regra recorrente inválida.' },400)
    const ids:string[]=[]
    for (const weekday of weekdays) {
      const id=crypto.randomUUID()
      await env.DB.prepare(`INSERT INTO recurring_blocks (id,weekday,start_time,end_time,date_from,date_to,label,active) VALUES (?,?,?,?,?,?,?,1)`).bind(id,weekday,startTime,endTime,dateFrom,dateTo,String(data.label||'Bloqueio recorrente')).run()
      const rule=await env.DB.prepare(`SELECT * FROM recurring_blocks WHERE id=?`).bind(id).first<any>()
      await materializeRule(env,rule)
      ids.push(id)
    }
    return json({ ok:true,ids },201)
  }

  const ruleMatch = path.match(/^\/api\/admin\/recurring-blocks\/([^/]+)$/)
  if (ruleMatch && request.method === 'PATCH') {
    const id=decodeURIComponent(ruleMatch[1])
    const data=await request.json().catch(()=>({})) as any
    const active=Boolean(data.active)
    await env.DB.prepare(`UPDATE recurring_blocks SET active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(active?1:0,id).run()
    if (!active) await env.DB.prepare(`UPDATE availability SET status='free',source='manual',recurring_block_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE recurring_block_id=? AND status='blocked' AND starts_at>?`).bind(id,nowIso()).run()
    else { const rule=await env.DB.prepare(`SELECT * FROM recurring_blocks WHERE id=?`).bind(id).first<any>(); if (rule) await materializeRule(env,rule) }
    return json({ ok:true,active })
  }

  return null
}
