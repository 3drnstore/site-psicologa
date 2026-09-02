import type { Env } from './types'

let ready = false

async function hasColumn(env: Env, table: string, column: string) {
  const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all<any>()
  return (result.results || []).some((row: any) => row.name === column)
}

async function addColumn(env: Env, table: string, column: string, definition: string) {
  if (!(await hasColumn(env, table, column))) {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run()
  }
}

export async function ensurePaymentSchemaV2(env: Env) {
  if (ready) return

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    external_id TEXT,
    method TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    amount_cents INTEGER NOT NULL,
    raw_reference TEXT,
    checkout_url TEXT,
    pix_qr_code TEXT,
    pix_copy_paste TEXT,
    raw_status TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()

  await addColumn(env, 'payments', 'external_id', 'TEXT')
  await addColumn(env, 'payments', 'raw_reference', 'TEXT')
  await addColumn(env, 'payments', 'checkout_url', 'TEXT')
  await addColumn(env, 'payments', 'pix_qr_code', 'TEXT')
  await addColumn(env, 'payments', 'pix_copy_paste', 'TEXT')
  await addColumn(env, 'payments', 'raw_status', 'TEXT')
  await addColumn(env, 'payments', 'created_at', 'TEXT')
  await addColumn(env, 'payments', 'updated_at', 'TEXT')

  await addColumn(env, 'appointments', 'payment_method', 'TEXT')
  await addColumn(env, 'appointments', 'payment_provider', 'TEXT')
  await addColumn(env, 'appointments', 'payment_external_id', 'TEXT')
  await addColumn(env, 'appointments', 'google_calendar_event_id', 'TEXT')
  await addColumn(env, 'appointments', 'paid_at', 'TEXT')
  await addColumn(env, 'appointments', 'updated_at', 'TEXT')

  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_payments_appointment_id ON payments(appointment_id)`).run()

  await env.DB.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('consultation_price_cents','0')`).run()
  await env.DB.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('pix_price_cents','0')`).run()
  await env.DB.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('card_price_cents','0')`).run()
  await env.DB.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('hold_minutes','15')`).run()

  ready = true
}
