import { ensureSchema } from './schema'
import type { Env } from './types'

const SCHEMA_VERSION_KEY='__schema_version'
const SCHEMA_VERSION='2026-09-05-perf-v1'
let pending: Promise<void> | null = null
let ready=false

async function schemaAlreadyCurrent(env:Env){
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`)
  const row=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(SCHEMA_VERSION_KEY).first<{value:string}>()
  return row?.value===SCHEMA_VERSION
}

async function markSchemaCurrent(env:Env){
  await env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(SCHEMA_VERSION_KEY,SCHEMA_VERSION).run()
}

export async function ensureSchemaReady(env: Env) {
  if(ready)return
  if (!pending) {
    pending = (async()=>{
      if(!(await schemaAlreadyCurrent(env))){
        await ensureSchema(env)
        await markSchemaCurrent(env)
      }
      ready=true
    })().catch(error => {
      pending = null
      ready=false
      throw error
    })
  }
  await pending
}
