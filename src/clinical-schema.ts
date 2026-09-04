import type { Env } from './types'

let ready=false

async function hasColumn(env:Env,column:string){const r=await env.DB.prepare('PRAGMA table_info(clinical_notes)').all<any>();return(r.results||[]).some((x:any)=>x.name===column)}
async function addColumn(env:Env,column:string,definition:string){if(!(await hasColumn(env,column)))await env.DB.prepare(`ALTER TABLE clinical_notes ADD COLUMN ${column} ${definition}`).run()}

export async function ensureClinicalEncryptionSchema(env:Env){
  if(ready)return
  await addColumn(env,'note_ciphertext','TEXT')
  await addColumn(env,'note_iv','TEXT')
  await addColumn(env,'wrapped_dek','TEXT')
  await addColumn(env,'wrap_iv','TEXT')
  await addColumn(env,'encryption_version','TEXT')

  const marker='clinical_envelope_encryption_v1_initialized'
  const initialized=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(marker).first<any>()
  if(!initialized){
    // O prontuário legado atual é apenas dado de teste e foi autorizado para exclusão.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM clinical_notes'),
      env.DB.prepare("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?, '1', CURRENT_TIMESTAMP)").bind(marker),
    ])
  }
  ready=true
}
