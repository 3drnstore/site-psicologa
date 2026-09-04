import type { Env } from './types'

let ready=false

async function columns(env:Env){
  const r=await env.DB.prepare('PRAGMA table_info(clinical_notes)').all<any>()
  return new Set((r.results||[]).map((x:any)=>String(x.name)))
}

async function addMissingColumns(env:Env){
  const existing=await columns(env)
  const defs:[string,string][]=[
    ['note_ciphertext','TEXT'],
    ['note_iv','TEXT'],
    ['wrapped_dek','TEXT'],
    ['wrap_iv','TEXT'],
    ['encryption_version','TEXT'],
  ]
  for(const [column,definition] of defs){
    if(existing.has(column))continue
    try{await env.DB.prepare(`ALTER TABLE clinical_notes ADD COLUMN ${column} ${definition}`).run();existing.add(column)}
    catch(error){
      // Outra instância do Worker pode ter criado a coluna entre o PRAGMA e o ALTER.
      const refreshed=await columns(env)
      if(!refreshed.has(column))throw error
      existing.add(column)
    }
  }
}

export async function ensureClinicalEncryptionSchema(env:Env){
  if(ready)return

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS clinical_vaults(
    admin_user_id TEXT PRIMARY KEY,
    wrapped_vault_key TEXT NOT NULL,
    wrap_iv TEXT NOT NULL,
    kdf_salt TEXT NOT NULL,
    kdf_iterations INTEGER NOT NULL,
    version TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS clinical_crypto_meta(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()

  await addMissingColumns(env)

  const marker='clinical_e2e_v1_initialized'
  const initialized=await env.DB.prepare('SELECT value FROM clinical_crypto_meta WHERE key=?').bind(marker).first<any>()
  if(!initialized){
    // Dados clínicos anteriores eram apenas testes e foram autorizados para exclusão.
    await env.DB.prepare('DELETE FROM clinical_notes').run()
    await env.DB.prepare("INSERT OR REPLACE INTO clinical_crypto_meta(key,value,updated_at) VALUES(?, '1', CURRENT_TIMESTAMP)").bind(marker).run()
  }
  ready=true
}
