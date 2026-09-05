import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()
const testEnabled=(env:Env)=>String(env.MERCADOPAGO_TEST_MODE||'').toLowerCase()==='true'

async function admin(request:Request,env:Env){
  const token=readCookie(request,'ps_admin_session')
  if(!token)return null
  return env.DB.prepare(`SELECT a.* FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),nowIso()).first<any>()
}

async function latestPendingCard(env:Env,appointmentId?:number){
  const extra=appointmentId?'AND a.id=?':''
  const sql=`SELECT p.id AS payment_id,p.status AS payment_status,p.checkout_url,p.external_id,p.amount_cents,a.id AS appointment_id,a.status AS appointment_status,a.paid_at,a.payment_method,a.availability_id,av.status AS availability_status,av.starts_at,pt.full_name AS patient_name FROM payments p JOIN appointments a ON a.id=p.appointment_id JOIN availability av ON av.id=a.availability_id JOIN patients pt ON pt.id=a.patient_id WHERE p.provider='infinitepay' AND p.method='credit_card' AND p.status='pending' AND a.status='pending_payment' ${extra} ORDER BY p.id DESC LIMIT 1`
  return appointmentId?env.DB.prepare(sql).bind(appointmentId).first<any>():env.DB.prepare(sql).first<any>()
}

async function testDatabaseTransition(env:Env,row:any){
  const original={payment_status:row.payment_status,appointment_status:row.appointment_status,paid_at:row.paid_at,payment_method:row.payment_method,availability_status:row.availability_status}
  try{
    await env.DB.batch([
      env.DB.prepare(`UPDATE payments SET status='approved',raw_status='test_simulation',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.payment_id),
      env.DB.prepare(`UPDATE appointments SET status='confirmed',paid_at=CURRENT_TIMESTAMP,payment_method='credit_card',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.appointment_id),
      env.DB.prepare(`UPDATE availability SET status='confirmed',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.availability_id),
    ])
    const check=await env.DB.prepare(`SELECT p.status AS payment_status,a.status AS appointment_status,a.paid_at,av.status AS availability_status FROM payments p JOIN appointments a ON a.id=p.appointment_id JOIN availability av ON av.id=a.availability_id WHERE p.id=?`).bind(row.payment_id).first<any>()
    const ok=check?.payment_status==='approved'&&check?.appointment_status==='confirmed'&&Boolean(check?.paid_at)&&check?.availability_status==='confirmed'
    return{ok,detail:ok?'Transição pendente → confirmado validada.':'A transição não atingiu o estado esperado.'}
  }finally{
    await env.DB.batch([
      env.DB.prepare(`UPDATE payments SET status=?,raw_status='test_simulation_rolled_back',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(original.payment_status,row.payment_id),
      env.DB.prepare(`UPDATE appointments SET status=?,paid_at=?,payment_method=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(original.appointment_status,original.paid_at||null,original.payment_method||null,row.appointment_id),
      env.DB.prepare(`UPDATE availability SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(original.availability_status,row.availability_id),
    ])
  }
}

async function testEmail(env:Env,to:string){
  if(!env.RESEND_API_KEY||!env.EMAIL_FROM)return{ok:false,skipped:true,detail:'Resend não configurado.'}
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({from:env.EMAIL_FROM,to:[to],subject:'Teste do fluxo de pagamento por cartão',html:'<p>Teste técnico concluído: o canal de e-mail do fluxo de confirmação de pagamento está funcionando.</p><p><strong>Nenhuma cobrança foi realizada.</strong></p>'})})
  if(!response.ok)return{ok:false,detail:`Resend respondeu ${response.status}.`}
  return{ok:true,detail:'E-mail técnico enviado ao administrador.'}
}

async function googleAccessToken(env:Env){
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_REFRESH_TOKEN)return null
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})})
  if(!response.ok)return null
  return((await response.json())as any).access_token||null
}

async function testCalendar(env:Env){
  const token=await googleAccessToken(env)
  if(!token)return{ok:false,skipped:true,detail:'Google Agenda ainda não autorizada/configurada.'}
  const calendar=encodeURIComponent(env.GOOGLE_CALENDAR_ID||'primary')
  const start=new Date(Date.now()+5*60000),end=new Date(start.getTime()+10*60000)
  const create=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({summary:'[TESTE] Fluxo de pagamento',description:'Evento temporário criado automaticamente para validar a integração. Será removido em seguida.',start:{dateTime:start.toISOString(),timeZone:'America/Sao_Paulo'},end:{dateTime:end.toISOString(),timeZone:'America/Sao_Paulo'}})})
  const data=await create.json().catch(()=>({}))as any
  if(!create.ok||!data?.id)return{ok:false,detail:`Google Agenda respondeu ${create.status}.`}
  const remove=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${encodeURIComponent(String(data.id))}`,{method:'DELETE',headers:{authorization:`Bearer ${token}`}})
  return{ok:remove.ok,detail:remove.ok?'Evento temporário criado e removido com sucesso.':`Evento criado, mas a remoção respondeu ${remove.status}.`}
}

export async function handlePaymentFlowTest(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/admin/payment-flow-test')return null
  const a=await admin(request,env)
  if(!a)return json({ok:false,message:'Acesso administrativo necessário.'},401)
  if(request.method==='GET'){
    const pending=await latestPendingCard(env)
    return json({ok:true,enabled:testEnabled(env),pending:pending?{appointment_id:Number(pending.appointment_id),payment_id:Number(pending.payment_id),patient_name:pending.patient_name,starts_at:pending.starts_at,amount_cents:Number(pending.amount_cents),checkout_ready:Boolean(pending.checkout_url)}:null})
  }
  if(request.method!=='POST')return json({ok:false,message:'Método não permitido.'},405)
  if(!testEnabled(env))return json({ok:false,message:'O modo de teste de pagamentos não está habilitado.'},403)
  if(String(a.role||'')==='assistant')return json({ok:false,message:'Somente o perfil da psicóloga pode executar este teste.'},403)
  const body=await request.json().catch(()=>({}))as any
  const row=await latestPendingCard(env,Number(body.appointment_id)||undefined)
  if(!row)return json({ok:false,message:'Não encontrei uma reserva pendente de cartão para testar.'},404)
  const database=await testDatabaseTransition(env,row)
  const email=await testEmail(env,String(a.email||''))
  const calendar=await testCalendar(env)
  const ok=database.ok&&email.ok&&calendar.ok&&Boolean(row.checkout_url)
  return json({ok,appointment_id:Number(row.appointment_id),payment_id:Number(row.payment_id),checks:{checkout:{ok:Boolean(row.checkout_url),detail:row.checkout_url?'Checkout InfinitePay já criado com sucesso.':'Checkout InfinitePay não encontrado.'},database,email,calendar},message:ok?'Fluxo técnico validado sem cobrança real e sem confirmar permanentemente a consulta.':'O teste terminou com uma ou mais integrações pendentes.'})
}
