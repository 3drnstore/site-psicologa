import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()
const TARGET_DATE='2026-09-02'

async function admin(request:Request,env:Env){
  const token=readCookie(request,'ps_admin_session')
  if(!token)return null
  return env.DB.prepare(`SELECT a.id FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`)
    .bind(await sha256(token),nowIso()).first<any>()
}

function dayKeySaoPaulo(value:string){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value))
  const map=Object.fromEntries(parts.map(p=>[p.type,p.value]))
  return `${map.year}-${map.month}-${map.day}`
}
async function tableExists(env:Env,name:string){
  return Boolean(await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(name).first<any>())
}

async function testAppointments(env:Env){
  const rows=await env.DB.prepare(`
    SELECT a.id,a.status,a.paid_at,a.availability_id,av.starts_at,p.id AS patient_id,p.full_name,p.email
    FROM appointments a
    JOIN availability av ON av.id=a.availability_id
    JOIN patients p ON p.id=a.patient_id
    WHERE p.email LIKE 'teste.%@example.invalid' OR p.full_name LIKE 'Paciente Teste%'
    ORDER BY av.starts_at ASC
  `).all<any>()
  return (rows.results||[]).filter((row:any)=>dayKeySaoPaulo(row.starts_at)===TARGET_DATE)
}

function validExisting(rows:any[]){
  if(rows.length!==3)return false
  const pending=rows.filter(r=>r.status==='pending_payment'&&!r.paid_at).length
  const confirmed=rows.filter(r=>r.status==='confirmed'&&Boolean(r.paid_at)).length
  return pending===1&&confirmed===2
}

async function cleanupPreviousTests(env:Env){
  const rows=await env.DB.prepare(`
    SELECT a.id AS appointment_id,a.availability_id,p.id AS patient_id
    FROM appointments a
    JOIN patients p ON p.id=a.patient_id
    WHERE p.email LIKE 'teste.%@example.invalid' OR p.full_name LIKE 'Paciente Teste%'
  `).all<any>()
  for(const row of rows.results||[]){
    if(await tableExists(env,'payments')) await env.DB.prepare('DELETE FROM payments WHERE appointment_id=?').bind(row.appointment_id).run()
    await env.DB.prepare('DELETE FROM appointments WHERE id=?').bind(row.appointment_id).run()
    await env.DB.prepare(`UPDATE availability SET status='free',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('held','confirmed')`).bind(row.availability_id).run()
  }
  await env.DB.prepare(`DELETE FROM patients WHERE email LIKE 'teste.%@example.invalid' OR full_name LIKE 'Paciente Teste%'`).run()
  await env.DB.prepare(`DELETE FROM settings WHERE key IN ('test_seed_appointments_v1','test_seed_appointments_v2')`).run()
}

export async function handleTestAppointments(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/admin/test-appointments'||request.method!=='POST')return null
  const a=await admin(request,env)
  if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)

  if(!(await tableExists(env,'patients'))||!(await tableExists(env,'appointments'))){
    return json({ok:false,message:'As tabelas de pacientes/consultas ainda não estão prontas para o teste.'},409)
  }

  const existing=await testAppointments(env)
  if(validExisting(existing)){
    return json({ok:true,already_done:true,date:TARGET_DATE,created:existing})
  }

  await cleanupPreviousTests(env)

  const rows=await env.DB.prepare(`
    SELECT id,starts_at,ends_at,status
    FROM availability
    WHERE status='free' AND COALESCE(public_visibility,'visible')='visible'
    ORDER BY starts_at ASC
  `).all<any>()

  const slots=(rows.results||[]).filter((r:any)=>dayKeySaoPaulo(r.starts_at)===TARGET_DATE).slice(0,3)
  if(slots.length<3){
    return json({ok:false,message:`${TARGET_DATE} não possui 3 horários livres cadastrados para criar os testes.`,free_slots:slots.length},409)
  }

  const priceRow=await env.DB.prepare(`SELECT value FROM settings WHERE key='consultation_price_cents'`).first<any>()
  const amount=Number(priceRow?.value||0)
  const stamp=Date.now()
  const patients=[
    {name:'Paciente Teste Reserva',email:`teste.reserva.${stamp}@example.invalid`,cpf:`T${stamp}01`,phone:'(00) 00000-0001'},
    {name:'Paciente Teste Confirmado 1',email:`teste.confirmado1.${stamp}@example.invalid`,cpf:`T${stamp}02`,phone:'(00) 00000-0002'},
    {name:'Paciente Teste Confirmado 2',email:`teste.confirmado2.${stamp}@example.invalid`,cpf:`T${stamp}03`,phone:'(00) 00000-0003'},
  ]

  const created:any[]=[]
  for(let i=0;i<3;i++){
    const p=patients[i]
    const pr=await env.DB.prepare(`INSERT INTO patients (full_name,birth_date,cpf,phone,email,email_verified) VALUES (?,?,?,?,?,1)`)
      .bind(p.name,'1990-01-01',p.cpf,p.phone,p.email).run()
    const patientId=Number(pr.meta.last_row_id)
    const confirmed=i>0
    const appointmentStatus=confirmed?'confirmed':'pending_payment'
    const slotStatus=confirmed?'confirmed':'held'
    const paidAt=confirmed?nowIso():null
    const reservedUntil=confirmed?null:new Date(Date.now()+7*24*60*60*1000).toISOString()
    const ar=await env.DB.prepare(`
      INSERT INTO appointments (patient_id,availability_id,status,amount_cents,paid_at,reserved_until)
      VALUES (?,?,?,?,?,?)
    `).bind(patientId,slots[i].id,appointmentStatus,amount,paidAt,reservedUntil).run()
    await env.DB.prepare(`UPDATE availability SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(slotStatus,slots[i].id).run()
    created.push({appointment_id:Number(ar.meta.last_row_id),patient_id:patientId,availability_id:slots[i].id,status:appointmentStatus,starts_at:slots[i].starts_at,full_name:p.name})
  }

  return json({ok:true,created,date:TARGET_DATE},201)
}
