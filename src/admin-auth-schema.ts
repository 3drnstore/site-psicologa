import type { Env } from './types'

let ready = false

async function tableColumns(env: Env, table: string) {
  const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all<any>()
  return new Set((result.results || []).map((row: any) => String(row.name)))
}

async function addMissingColumn(env: Env, table: string, columns: Set<string>, name: string, definition: string) {
  if (columns.has(name)) return
  await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run()
  columns.add(name)
}

export async function ensureAdminAuthSchema(env: Env) {
  if (ready) return

  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS admin_users(
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'psychologist',
      active INTEGER NOT NULL DEFAULT 1,
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS admin_sessions(
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      admin_email TEXT,
      admin_display_name TEXT,
      admin_role TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  const userColumns = await tableColumns(env, 'admin_users')
  await addMissingColumn(env, 'admin_users', userColumns, 'password_hash', 'TEXT')
  await addMissingColumn(env, 'admin_users', userColumns, 'password_salt', 'TEXT')
  await addMissingColumn(env, 'admin_users', userColumns, 'display_name', "TEXT NOT NULL DEFAULT 'Administrador'")
  await addMissingColumn(env, 'admin_users', userColumns, 'role', "TEXT NOT NULL DEFAULT 'psychologist'")
  await addMissingColumn(env, 'admin_users', userColumns, 'active', 'INTEGER NOT NULL DEFAULT 1')
  await addMissingColumn(env, 'admin_users', userColumns, 'totp_secret', 'TEXT')
  await addMissingColumn(env, 'admin_users', userColumns, 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0')
  await addMissingColumn(env, 'admin_users', userColumns, 'created_at', 'TEXT')
  await addMissingColumn(env, 'admin_users', userColumns, 'updated_at', 'TEXT')

  const sessionColumns = await tableColumns(env, 'admin_sessions')
  await addMissingColumn(env, 'admin_sessions', sessionColumns, 'admin_user_id', 'TEXT')
  await addMissingColumn(env, 'admin_sessions', sessionColumns, 'token_hash', 'TEXT')
  await addMissingColumn(env, 'admin_sessions', sessionColumns, 'expires_at', 'TEXT')
  await addMissingColumn(env, 'admin_sessions', sessionColumns, 'admin_email', 'TEXT')
  await addMissingColumn(env, 'admin_sessions', sessionColumns, 'admin_display_name', 'TEXT')
  await addMissingColumn(env, 'admin_sessions', sessionColumns, 'admin_role', 'TEXT')
  await addMissingColumn(env, 'admin_sessions', sessionColumns, 'created_at', 'TEXT')

  ready = true
}

export async function adminAuthSchemaStatus(env: Env) {
  try {
    await ensureAdminAuthSchema(env)
    const users = await tableColumns(env, 'admin_users')
    const sessions = await tableColumns(env, 'admin_sessions')
    const requiredUsers = ['id','email','password_hash','password_salt','display_name','role','active','totp_secret','totp_enabled']
    const requiredSessions = ['id','admin_user_id','token_hash','expires_at','admin_email','admin_display_name','admin_role']
    const valid = requiredUsers.every((c) => users.has(c)) && requiredSessions.every((c) => sessions.has(c))
    return valid ? 'online' : 'invalid_schema'
  } catch (error) {
    console.error('Admin auth schema diagnostic:', error instanceof Error ? error.message : String(error))
    return 'unavailable'
  }
}
