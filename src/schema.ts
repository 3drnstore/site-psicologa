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

export async function ensureSchema(env: Env) {
  if (ready) return

  await env.DB.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      birth_date TEXT NOT NULL,
      cpf TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      password_salt TEXT,
      google_sub TEXT UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','held','confirmed','blocked')),
      public_visibility TEXT NOT NULL DEFAULT 'visible',
      source TEXT NOT NULL DEFAULT 'manual',
      recurring_block_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recurring_blocks (
      id TEXT PRIMARY KEY,
      weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'Bloqueio recorrente',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      availability_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','confirmed','cancelled','expired')),
      amount_cents INTEGER NOT NULL,
      payment_method TEXT CHECK (payment_method IN ('pix','credit_card')),
      payment_provider TEXT,
      payment_external_id TEXT,
      google_calendar_event_id TEXT,
      reserved_until TEXT,
      paid_at TEXT,
      cancellation_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT,
      FOREIGN KEY (availability_id) REFERENCES availability(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      external_id TEXT,
      method TEXT NOT NULL CHECK (method IN ('pix','credit_card')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','failed','refunded','cancelled')),
      amount_cents INTEGER NOT NULL,
      raw_reference TEXT,
      checkout_url TEXT,
      pix_qr_code TEXT,
      pix_copy_paste TEXT,
      raw_status TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clinical_notes (
      id TEXT PRIMARY KEY,
      patient_id INTEGER NOT NULL,
      appointment_id INTEGER,
      author_admin_id TEXT NOT NULL,
      session_date TEXT NOT NULL,
      note_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      patient_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'psychologist' CHECK (role IN ('psychologist','assistant')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS oauth_pending (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      google_sub TEXT NOT NULL,
      email TEXT NOT NULL,
      full_name TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actor_type TEXT NOT NULL CHECK (actor_type IN ('patient','admin','system')),
      actor_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_availability_starts_at ON availability(starts_at);
    CREATE INDEX IF NOT EXISTS idx_availability_recurring_block ON availability(recurring_block_id);
    CREATE INDEX IF NOT EXISTS idx_recurring_blocks_active ON recurring_blocks(active,weekday,start_time);
    CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments(patient_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
    CREATE INDEX IF NOT EXISTS idx_payments_appointment_id ON payments(appointment_id);
    CREATE INDEX IF NOT EXISTS idx_clinical_notes_patient_date ON clinical_notes(patient_id, session_date DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash ON admin_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_oauth_pending_token_hash ON oauth_pending(token_hash);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
  `)

  await addColumn(env, 'patients', 'password_salt', 'TEXT')
  await addColumn(env, 'patients', 'email_verified', 'INTEGER NOT NULL DEFAULT 0')
  await addColumn(env, 'appointments', 'cancellation_reason', 'TEXT')
  await addColumn(env, 'payments', 'checkout_url', 'TEXT')
  await addColumn(env, 'payments', 'pix_qr_code', 'TEXT')
  await addColumn(env, 'payments', 'pix_copy_paste', 'TEXT')
  await addColumn(env, 'payments', 'raw_status', 'TEXT')
  await addColumn(env, 'availability', 'public_visibility', "TEXT NOT NULL DEFAULT 'visible'")
  await addColumn(env, 'availability', 'source', "TEXT NOT NULL DEFAULT 'manual'")
  await addColumn(env, 'availability', 'recurring_block_id', 'TEXT')

  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('consultation_price_cents', '0')`),
    env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('pix_discount_percent', '0')`),
    env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('timezone', 'America/Sao_Paulo')`),
    env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('appointment_duration_minutes', '50')`),
    env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('hold_minutes', '15')`),
  ])

  ready = true
}
