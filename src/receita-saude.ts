import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const nowIso=()=>new Date().toISOString()

async function admin(request:Request,env:Env){
  const token=readCookie(request,'ps_admin_session');if(!token)return null
  return env.DB.prepare(`SELECT a.* FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),nowIso()).first<any>()
}

async function syncPending(env:Env){
  const rows=await env.DB.prepare(`
    SELECT a.id AS appointment_id,a.patient_id,a.amount_cents,a.paid_at
    FROM appointments a
    WHERE a.status='confirmed' AND a.paid_at IS NOT NULL
  `).all<any>()
  for(const row of rows.results||[]){
    await env.DB.prepare(`
      INSERT OR IGNORE INTO receita_saude_receipts(appointment_id,patient_id,status,payment_date,amount_cents)
      VALUES(?,?,'pending',?,?)
    `).bind(row.appointment_id,row.patient_id,row.paid_at,row.amount_cents).run()
  }
}

export async function handleReceitaSaude(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/admin/receita-saude'&&!/^\/api\/admin\/receita-saude\/\d+\/(?:issued|cancelled|pending)$/.test(path))return null
  const current=await admin(request,env);if(!current)return json({ok:false,message:'Acesso administrativo necessário.'},401)

  if(path==='/api/admin/receita-saude'&&request.method==='GET'){
    await syncPending(env)
    const rows=await env.DB.prepare(`
      SELECT r.id,r.appointment_id,r.patient_id,r.status,r.receipt_number,r.payment_date,r.amount_cents,r.issued_at,r.cancelled_at,r.notes,
             p.full_name,p.cpf,p.email,
             av.starts_at,av.ends_at,
             a.payment_method,a.payment_provider
      FROM receita_saude_receipts r
      JOIN patients p ON p.id=r.patient_id
      JOIN appointments a ON a.id=r.appointment_id
      JOIN availability av ON av.id=a.availability_id
      ORDER BY datetime(r.payment_date) DESC,r.id DESC
    `).all<any>()
    return json({ok:true,receipts:rows.results||[],official_submission:false})
  }

  if(request.method==='POST'){
    const match=path.match(/^\/api\/admin\/receita-saude\/(\d+)\/(issued|cancelled|pending)$/);if(!match)return null
    const appointmentId=Number(match[1]),action=match[2]
    await syncPending(env)
    const existing=await env.DB.prepare(`SELECT * FROM receita_saude_receipts WHERE appointment_id=?`).bind(appointmentId).first<any>()
    if(!existing)return json({ok:false,message:'Pagamento confirmado não encontrado para esta consulta.'},404)
    const body=await request.json().catch(()=>({})) as any
    if(action==='issued'){
      const receiptNumber=String(body.receipt_number||'').trim()
      await env.DB.prepare(`UPDATE receita_saude_receipts SET status='issued',receipt_number=?,issued_at=CURRENT_TIMESTAMP,cancelled_at=NULL,notes=?,marked_by=?,updated_at=CURRENT_TIMESTAMP WHERE appointment_id=?`).bind(receiptNumber||null,String(body.notes||'').trim()||null,current.id,appointmentId).run()
    }else if(action==='cancelled'){
      await env.DB.prepare(`UPDATE receita_saude_receipts SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,notes=?,marked_by=?,updated_at=CURRENT_TIMESTAMP WHERE appointment_id=?`).bind(String(body.notes||'').trim()||null,current.id,appointmentId).run()
    }else{
      await env.DB.prepare(`UPDATE receita_saude_receipts SET status='pending',receipt_number=NULL,issued_at=NULL,cancelled_at=NULL,notes=?,marked_by=?,updated_at=CURRENT_TIMESTAMP WHERE appointment_id=?`).bind(String(body.notes||'').trim()||null,current.id,appointmentId).run()
    }
    await env.DB.prepare(`INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,metadata_json) VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),'admin',String(current.id),`receita_saude_${action}`,'appointment',String(appointmentId),JSON.stringify({receipt_number:String(body.receipt_number||'').trim()||null})).run()
    return json({ok:true,status:action})
  }
  return json({ok:false,message:'Método não permitido.'},405)
}
