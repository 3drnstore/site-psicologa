import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()
const plusMinutes=(minutes:number)=>new Date(Date.now()+minutes*60000).toISOString()

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
  const p=await patient(request,env)
  if(!p)return json({ok:false,message:'Faça login para continuar.'},401)
  const data=await request.json().catch(()=>({})) as any
  const slotId=Number(data.slot_id)
  if(!slotId)return json({ok:false,message:'Horário inválido.'},400)

  const slot=await env.DB.prepare(`SELECT * FROM availability WHERE id=? AND status='free'`).bind(slotId).first<any>()
  if(!slot)return json({ok:false,message:'Esse horário não está mais disponível.'},409)
  if(new Date(slot.starts_at).getTime()<=Date.now())return json({ok:false,message:'Esse horário já passou e não pode mais ser reservado.'},409)

  const cardPrice=Number(await setting(env,'card_price_cents',await setting(env,'consultation_price_cents','0')))||0
  const holdMinutes=Math.max(5,Number(await setting(env,'hold_minutes','15'))||15)
  const holdUntil=plusMinutes(holdMinutes)

  const hold=await env.DB.prepare(`UPDATE availability SET status='held',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='free' AND starts_at>?`).bind(slotId,nowIso()).run()
  if(!hold.meta.changes)return json({ok:false,message:'Esse horário não está mais disponível.'},409)

  try{
    const result=await env.DB.prepare(`INSERT INTO appointments (patient_id,availability_id,status,amount_cents,reserved_until) VALUES (?,?,'pending_payment',?,?)`).bind(p.id,slotId,cardPrice,holdUntil).run()
    return json({ok:true,appointment_id:Number(result.meta.last_row_id),reserved_until:holdUntil,amount_cents:cardPrice},201)
  }catch(error){
    await env.DB.prepare(`UPDATE availability SET status='free',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='held'`).bind(slotId).run()
    throw error
  }
}
