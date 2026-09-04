import { readCookie, sha256 } from './auth'
import { ensureNextRecurringReservation } from './session-management'
import type { Env } from './types'

const now=()=>new Date().toISOString()
async function patientId(request:Request,env:Env){const token=readCookie(request,'ps_session');if(!token)return null;const row=await env.DB.prepare(`SELECT p.id FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token),now()).first<any>();return row?.id?Number(row.id):null}

async function reconcilePatient(env:Env,id:number){
  const rows=await env.DB.prepare(`SELECT a.id FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.patient_id=? AND a.status='confirmed' ORDER BY av.starts_at DESC LIMIT 6`).bind(id).all<any>()
  for(const row of rows.results||[])await ensureNextRecurringReservation(env,Number(row.id))
}

export async function touchRecurrence(request:Request,env:Env,path:string){
  if((path==='/api/appointments/mine'||/^\/api\/payments\/status\/\d+$/.test(path))&&request.method==='GET'){
    const id=await patientId(request,env);if(id)await reconcilePatient(env,id)
  }
  if(path==='/api/admin/session-management/appointments'&&request.method==='GET')await reconcileAllRecurrences(env)
}

export async function reconcileAllRecurrences(env:Env){
  const rules=await env.DB.prepare(`SELECT patient_id FROM patient_recurrence WHERE active=1`).all<any>()
  for(const rule of rules.results||[])await reconcilePatient(env,Number(rule.patient_id))
}
