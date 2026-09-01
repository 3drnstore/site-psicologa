PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clinical_notes (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  appointment_id TEXT,
  author_user_id TEXT NOT NULL,
  session_date TEXT NOT NULL,
  note_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_clinical_notes_patient_date
  ON clinical_notes(patient_id, session_date DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES patients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

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

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_subject),
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);

ALTER TABLE patients ADD COLUMN password_hash TEXT;
ALTER TABLE patients ADD COLUMN password_salt TEXT;
ALTER TABLE patients ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE patients ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE appointments ADD COLUMN hold_expires_at TEXT;
ALTER TABLE appointments ADD COLUMN google_event_id TEXT;
ALTER TABLE appointments ADD COLUMN cancellation_reason TEXT;

ALTER TABLE payments ADD COLUMN provider TEXT;
ALTER TABLE payments ADD COLUMN provider_payment_id TEXT;
ALTER TABLE payments ADD COLUMN checkout_url TEXT;
ALTER TABLE payments ADD COLUMN pix_qr_code TEXT;
ALTER TABLE payments ADD COLUMN pix_copy_paste TEXT;
ALTER TABLE payments ADD COLUMN raw_status TEXT;

INSERT OR IGNORE INTO settings (key, value) VALUES ('consultation_price_cents', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('pix_discount_percent', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('appointment_duration_minutes', '50');
INSERT OR IGNORE INTO settings (key, value) VALUES ('hold_minutes', '15');
