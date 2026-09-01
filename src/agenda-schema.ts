import type { Env } from './types'

async function hasColumn(env: Env, table: string, column: string) {
  const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all<any>()
  return (result.results || []).some((row: any) => row.name === column)
}

async function addColumn(env: Env, table: string, column: string, definition: string) {
  if (!(await hasColumn(env, table, column))) {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run()
  }
}

let ready = false

export async function ensureAgendaSchema(env: Env) {
  if (ready) return

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'free',
    public_visibility TEXT NOT NULL DEFAULT 'visible',
    source TEXT NOT NULL DEFAULT 'manual',
    recurring_block_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS recurring_blocks (
    id TEXT PRIMARY KEY,
    weekday INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    date_from TEXT NOT NULL,
    date_to TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'Bloqueio recorrente',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()

  await addColumn(env, 'availability', 'public_visibility', "TEXT NOT NULL DEFAULT 'visible'")
  await addColumn(env, 'availability', 'source', "TEXT NOT NULL DEFAULT 'manual'")
  await addColumn(env, 'availability', 'recurring_block_id', 'TEXT')
  await addColumn(env, 'availability', 'created_at', 'TEXT')
  await addColumn(env, 'availability', 'updated_at', 'TEXT')

  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_availability_starts_at ON availability(starts_at)`).run()
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_availability_recurring_block ON availability(recurring_block_id)`).run()
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_recurring_blocks_active ON recurring_blocks(active,weekday,start_time)`).run()

  await env.DB.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('consultation_price_cents','0')`).run()
  await env.DB.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('pix_discount_percent','0')`).run()
  await env.DB.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('appointment_duration_minutes','50')`).run()
  await env.DB.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('hold_minutes','15')`).run()

  const cleanupKey = 'migration_cleanup_2027_test_interval_v1'
  const cleanupDone = await env.DB.prepare(`SELECT value FROM settings WHERE key=?`).bind(cleanupKey).first<any>()
  if (!cleanupDone) {
    await env.DB.prepare(`
      DELETE FROM availability
      WHERE substr(starts_at,1,10)='2027-01-01'
        AND substr(ends_at,1,10) IN ('2027-12-31','2028-01-01')
        AND (julianday(ends_at)-julianday(starts_at)) > 300
        AND status NOT IN ('held','confirmed')
    `).run()
    await env.DB.prepare(`INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?, 'done', CURRENT_TIMESTAMP)`).bind(cleanupKey).run()
  }

  ready = true
}
