import { readCookie, sha256 } from './auth'
import { pricingForOrigin } from './platform-pricing'
import { sendReservationCreatedEmail } from './email-notifications'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()
const plusMinutes=(minutes:number)=>new Date(Date.now()+minutes*60000).toISOString()

async function patient(request:Request,env:Env){
  const token=readCookie(request,'ps_session')
  if(!token)return null
  return env.DB.prepare(`SELECT p.id,p.pricing_origin FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token),nowIso()).first<any>()
}
async function setting(env:Env,key:string,fallback=''){const row=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first<any>();return row?.value??fallback}

export async function handlePatientReserveV2(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/appointments/reserve'||request.method!=='POST')return null
  try{
    const p=await patient(request,env);if(!p)return json({ok:false,message:'Faça login para continuar.'},401)
    const data=await request.json().catch(()=>({})) as any,slotId=Number(data.slot_id);if(!slotId)return json({ok:false,message:'Horário inválido.'},400)
    const existing=await env.DB.prepare(`SELECT a.id,a.amount_cents,a.reserved_until,a.status FROM appointments a WHERE a.patient_id=? AND a.availability_id=? AND a.status='pending_payment' ORDER BY a.id DESC LIMIT 1`).bind(p.id,slotId).first<any>()
    if(existing&&(!existing.reserved_until||new Date(existing.reserved_until).getTime()>Date.now())){
      await env.DB.prepare(`UPDATE availability SET status='held' WHERE id=? AND status='free'`).bind(slotId).run()
      await sendReservationCreatedEmail(env,Number(existing.id))
      return json({ok:true,appointment_id:Number(existing.id),reserved_until:existing.reserved_until,amount_cents:Number(existing.amount_cents||0),reused:true},200)
    }
    const slot=await env.DB.prepare(`SELECT id,starts_at,status FROM availability WHERE id=?`).bind(slotId).first<any>()
    if(!slot||slot.status!=='free')return json({ok:false,message:'Esse horário não está mais disponível.'},409)
    const startsAt=new Date(String(slot.starts_at));if(Number.isNaN(startsAt.getTime()))return json({ok:false,message:'Este horário possui uma data inválida. Atualize a agenda e tente novamente.'},409)
    if(startsAt.getTime()<=Date.now())return json({ok:false,message:'Esse horário já passou e não pode mais ser reservado.'},409)
    const pricing=await pricingForOrigin(env,p.pricing_origin,'card'),amount=Math.max(0,Number(pricing.consultation_price_cents)||0)
    if(amount<=0)return json({ok:false,message:'O valor da sessão ainda não foi configurado pela profissional.'},409)
    const holdMinutes=Math.max(5,Number(await setting(env,'hold_minutes','15'))||15),holdUntil=plusMinutes(holdMinutes)
    const hold=await env.DB.prepare(`UPDATE availability SET status='held' WHERE id=? AND status='free'`).bind(slotId).run()
    if(!Number(hold.meta.changes||0))return json({ok:false,message:'Esse horário acabou de ser reservado por outra pessoa.'},409)
    try{
      const result=await env.DB.prepare(`INSERT INTO appointments (patient_id,availability_id,status,amount_cents,reserved_until) VALUES (?,?,'pending_payment',?,?)`).bind(p.id,slotId,amount,holdUntil).run()
      const appointmentId=Number(result.meta.last_row_id)
      await sendReservationCreatedEmail(env,appointmentId)
      return json({ok:true,appointment_id:appointmentId,reserved_until:holdUntil,amount_cents:amount,pricing_origin:pricing.origin},201)
    }catch(error){await env.DB.prepare(`UPDATE availability SET status='free' WHERE id=? AND status='held'`).bind(slotId).run();throw error}
  }catch(error){console.error('Patient reserve error:',error instanceof Error?error.message:String(error));return json({ok:false,message:'Não foi possível reservar este horário agora.'},500)}
}
