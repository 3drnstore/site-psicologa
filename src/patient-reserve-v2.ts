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

  try{
    const p=await patient(request,env)
    if(!p)return json({ok:false,message:'Faça login para continuar.'},401)

    const data=await request.json().catch(()=>({})) as any
    const slotId=Number(data.slot_id)
    if(!slotId)return json({ok:false,message:'Horário inválido.'},400)

    // If this patient already reserved this exact slot and the hold is still valid,
    // return the same appointment instead of failing or creating a duplicate.
    const existing=await env.DB.prepare(`
      SELECT a.id,a.amount_cents,a.reserved_until,a.status
      FROM appointments a
      WHERE a.patient_id=? AND a.availability_id=? AND a.status='pending_payment'
      ORDER BY a.id DESC LIMIT 1
    `).bind(p.id,slotId).first<any>()
    if(existing && (!existing.reserved_until || new Date(existing.reserved_until).getTime()>Date.now())){
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

    // Atomic compare-and-set: only one patient can acquire a free slot.
    const hold=await env.DB.prepare(`
      UPDATE availability
      SET status='held',updated_at=CURRENT_TIMESTAMP
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
      await env.DB.prepare(`UPDATE availability SET status='free',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='held'`).bind(slotId).run()
      throw error
    }
  }catch(error){
    const detail=error instanceof Error?error.message:String(error)
    console.error('Patient reserve error:',detail)
    return json({ok:false,message:'Não foi possível reservar este horário. Atualize a página e tente novamente.',detail},500)
  }
}
