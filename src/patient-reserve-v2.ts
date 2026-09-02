import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()
const plusMinutes=(minutes:number)=>new Date(Date.now()+minutes*60000).toISOString()

async function hasColumn(env:Env,table:string,column:string){
  const result=await env.DB.prepare(`PRAGMA table_info(${table})`).all<any>()
  return (result.results||[]).some((row:any)=>row.name===column)
}

async function addColumn(env:Env,table:string,column:string,definition:string){
  if(!(await hasColumn(env,table,column))){
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run()
  }
}

let reserveSchemaReady=false
async function ensureReserveSchema(env:Env){
  if(reserveSchemaReady)return

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    availability_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_payment',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT,
    payment_provider TEXT,
    payment_external_id TEXT,
    google_calendar_event_id TEXT,
    reserved_until TEXT,
    paid_at TEXT,
    cancellation_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()

  await addColumn(env,'appointments','amount_cents','INTEGER NOT NULL DEFAULT 0')
  await addColumn(env,'appointments','reserved_until','TEXT')
  await addColumn(env,'appointments','payment_method','TEXT')
  await addColumn(env,'appointments','payment_provider','TEXT')
  await addColumn(env,'appointments','payment_external_id','TEXT')
  await addColumn(env,'appointments','google_calendar_event_id','TEXT')
  await addColumn(env,'appointments','paid_at','TEXT')
  await addColumn(env,'appointments','cancellation_reason','TEXT')
  await addColumn(env,'appointments','created_at','TEXT')
  await addColumn(env,'appointments','updated_at','TEXT')

  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_appointments_patient_availability_status ON appointments(patient_id,availability_id,status)`).run()
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_appointments_status_reserved_until ON appointments(status,reserved_until)`).run()

  await env.DB.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('consultation_price_cents','0')`).run()
  await env.DB.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('card_price_cents','0')`).run()
  await env.DB.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('pix_price_cents','0')`).run()
  await env.DB.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES ('hold_minutes','15')`).run()

  reserveSchemaReady=true
}

async function patient(request:Request,env:Env){
  const token=readCookie(request,'ps_session')
  if(!token)return null
  return env.DB.prepare(`SELECT p.id FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token),nowIso()).first<any>()
}

async function setting(env:Env,key:string,fallback=''){
  const row=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first<any>()
  return row?.value??fallback
}

export async function handlePatientReserveV2(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/appointments/reserve'||request.method!=='POST')return null

  try{
    await ensureReserveSchema(env)

    const p=await patient(request,env)
    if(!p)return json({ok:false,message:'Faça login para continuar.'},401)

    const data=await request.json().catch(()=>({})) as any
    const slotId=Number(data.slot_id)
    if(!slotId)return json({ok:false,message:'Horário inválido.'},400)

    const existing=await env.DB.prepare(`
      SELECT a.id,a.amount_cents,a.reserved_until,a.status
      FROM appointments a
      WHERE a.patient_id=? AND a.availability_id=? AND a.status='pending_payment'
      ORDER BY a.id DESC LIMIT 1
    `).bind(p.id,slotId).first<any>()
    if(existing && (!existing.reserved_until || new Date(existing.reserved_until).getTime()>Date.now())){
      await env.DB.prepare(`UPDATE availability SET status='held' WHERE id=? AND status='free'`).bind(slotId).run()
      return json({
        ok:true,
        appointment_id:Number(existing.id),
        reserved_until:existing.reserved_until,
        amount_cents:Number(existing.amount_cents||0),
        reused:true,
      },200)
    }

    const slot=await env.DB.prepare(`SELECT id,starts_at,status FROM availability WHERE id=?`).bind(slotId).first<any>()
    if(!slot||slot.status!=='free')return json({ok:false,message:'Esse horário não está mais disponível.'},409)

    const startsAt=new Date(String(slot.starts_at))
    if(Number.isNaN(startsAt.getTime()))return json({ok:false,message:'Este horário possui uma data inválida. Atualize a agenda e tente novamente.'},409)
    if(startsAt.getTime()<=Date.now())return json({ok:false,message:'Esse horário já passou e não pode mais ser reservado.'},409)

    const legacyPrice=await setting(env,'consultation_price_cents','0')
    const cardPrice=Math.max(0,Number(await setting(env,'card_price_cents',legacyPrice))||0)
    const holdMinutes=Math.max(5,Number(await setting(env,'hold_minutes','15'))||15)
    const holdUntil=plusMinutes(holdMinutes)

    const hold=await env.DB.prepare(`
      UPDATE availability
      SET status='held'
      WHERE id=? AND status='free'
    `).bind(slotId).run()
    if(!Number(hold.meta.changes||0))return json({ok:false,message:'Esse horário acabou de ser reservado por outra pessoa.'},409)

    try{
      const result=await env.DB.prepare(`
        INSERT INTO appointments (patient_id,availability_id,status,amount_cents,reserved_until)
        VALUES (?,?,'pending_payment',?,?)
      `).bind(p.id,slotId,cardPrice,holdUntil).run()

      return json({
        ok:true,
        appointment_id:Number(result.meta.last_row_id),
        reserved_until:holdUntil,
        amount_cents:cardPrice,
      },201)
    }catch(error){
      await env.DB.prepare(`UPDATE availability SET status='free' WHERE id=? AND status='held'`).bind(slotId).run()
      throw error
    }
  }catch(error){
    const detail=error instanceof Error?error.message:String(error)
    console.error('Patient reserve error:',detail)
    return json({ok:false,message:`Não foi possível reservar este horário. Detalhe: ${detail}`},500)
  }
}
