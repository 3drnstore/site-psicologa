import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()
async function patient(request:Request,env:Env){const token=readCookie(request,'ps_session');if(!token)return null;return env.DB.prepare(`SELECT p.* FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token),nowIso()).first<any>()}

export async function handlePlatformCheckout(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/payments/checkout'||request.method!=='POST')return null
  const p=await patient(request,env);if(!p)return null
  if(!['platform_1','platform_2'].includes(String(p.pricing_origin||'')))return null
  const body=await request.json().catch(()=>({})) as any,appointmentId=Number(body.appointment_id),requested=body.method==='pix'?'pix':body.method==='card'?'credit_card':''
  if(!appointmentId||!requested)return json({ok:false,message:'Forma de pagamento ou reserva inválida.'},400)
  const ap=await env.DB.prepare('SELECT * FROM appointments WHERE id=? AND patient_id=?').bind(appointmentId,p.id).first<any>()
  if(!ap||ap.status!=='pending_payment')return json({ok:false,message:'Reserva não disponível para pagamento.'},409)
  const deadline=ap.payment_deadline_at||ap.reserved_until
  if(!deadline||new Date(deadline).getTime()<=Date.now())return json({ok:false,message:'O prazo de pagamento desta reserva terminou e o horário será liberado.'},409)
  const amount=Math.max(0,Number(ap.amount_cents||0));if(amount<=0)return json({ok:false,message:'O valor desta tabela ainda não foi configurado pela profissional.'},409)
  const provider=requested==='pix'?'mercadopago':'infinitepay'

  const existing=await env.DB.prepare(`SELECT * FROM payments WHERE appointment_id=? AND provider=? AND status='pending' ORDER BY id DESC LIMIT 1`).bind(appointmentId,provider).first<any>()
  if(existing&&((requested==='pix'&&(existing.pix_qr_code||existing.pix_copy_paste||existing.checkout_url))||(requested==='credit_card'&&existing.checkout_url))){
    return json({ok:true,payment_id:Number(existing.id),provider,checkout_url:existing.checkout_url,pix_qr_code:existing.pix_qr_code,pix_copy_paste:existing.pix_copy_paste,amount_cents:Number(existing.amount_cents),payment_deadline_at:deadline})
  }

  await env.DB.prepare(`UPDATE appointments SET payment_method=?,payment_provider=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(requested,provider,appointmentId).run()
  const inserted=await env.DB.prepare(`INSERT INTO payments (appointment_id,provider,method,status,amount_cents,raw_status) VALUES (?,?,?,'pending',?,'creating')`).bind(appointmentId,provider,requested,amount).run()
  const paymentId=Number(inserted.meta.last_row_id),origin=env.APP_ORIGIN||new URL(request.url).origin

  if(requested==='pix'){
    if(!env.MERCADOPAGO_ACCESS_TOKEN)return json({ok:false,payment_id:paymentId,message:'Mercado Pago ainda não configurado.'},503)
    const testMode=String(env.MERCADOPAGO_TEST_MODE||'').toLowerCase()==='true',chargedAmount=testMode?5000:amount,amountString=(chargedAmount/100).toFixed(2)
    const remainingMinutes=Math.floor((new Date(deadline).getTime()-Date.now())/60000);if(remainingMinutes<1)return json({ok:false,message:'O prazo desta reserva terminou.'},409)
    const expirationMinutes=Math.max(30,Math.min(43200,remainingMinutes))
    const payload={type:'online',total_amount:amountString,external_reference:`consulta-${appointmentId}-pagamento-${paymentId}`,processing_mode:'automatic',transactions:{payments:[{amount:amountString,payment_method:{id:'pix',type:'bank_transfer'},expiration_time:`PT${expirationMinutes}M`}]},payer:testMode?{email:'test_user_br@testuser.com',first_name:'APRO'}:{email:p.email,first_name:String(p.full_name||'Paciente').split(' ')[0]}}
    const response=await fetch('https://api.mercadopago.com/v1/orders',{method:'POST',headers:{authorization:`Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,'content-type':'application/json',accept:'application/json','X-Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(payload)})
    const data=await response.json().catch(()=>({})) as any
    if(!response.ok){await env.DB.prepare(`UPDATE payments SET status='failed',raw_status=? WHERE id=?`).bind(JSON.stringify(data).slice(0,1000),paymentId).run();return json({ok:false,message:'Não foi possível gerar o Pix no Mercado Pago.'},502)}
    const tx=data?.transactions?.payments?.[0]||{},pm=tx.payment_method||{},orderId=String(data.id||''),qr=pm.qr_code_base64?`data:image/png;base64,${String(pm.qr_code_base64)}`:null,copy=pm.qr_code?String(pm.qr_code):null,ticket=pm.ticket_url?String(pm.ticket_url):null
    if(!orderId||(!qr&&!copy&&!ticket))return json({ok:false,message:'O Mercado Pago não retornou os dados do Pix.'},502)
    await env.DB.prepare(`UPDATE payments SET external_id=?,checkout_url=?,pix_qr_code=?,pix_copy_paste=?,amount_cents=?,raw_status='created',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(orderId,ticket,qr,copy,chargedAmount,paymentId).run()
    await env.DB.prepare(`UPDATE appointments SET amount_cents=?,payment_external_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(chargedAmount,orderId,appointmentId).run()
    return json({ok:true,payment_id:paymentId,provider:'mercadopago',pix_qr_code:qr,pix_copy_paste:copy,checkout_url:ticket,amount_cents:chargedAmount,payment_deadline_at:deadline,test_mode:testMode})
  }

  if(!env.INFINITEPAY_HANDLE)return json({ok:false,payment_id:paymentId,message:'InfinitePay ainda não configurada.'},503)
  const response=await fetch('https://api.checkout.infinitepay.io/links',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:env.INFINITEPAY_HANDLE,items:[{quantity:1,price:amount,description:'Consulta psicológica'}],order_nsu:String(paymentId),redirect_url:`${origin}/?payment=return&provider=infinitepay`,webhook_url:`${origin}/api/payments/webhook/infinitepay`,customer:{name:p.full_name,email:p.email,phone_number:p.phone}})})
  const data=await response.json().catch(()=>({})) as any
  if(!response.ok){await env.DB.prepare(`UPDATE payments SET status='failed',raw_status=? WHERE id=?`).bind(JSON.stringify(data).slice(0,1000),paymentId).run();return json({ok:false,message:'Não foi possível abrir o checkout da InfinitePay.'},502)}
  const checkoutUrl=data.url||data.checkout_url||data.link||null,external=String(data.slug||data.id||'')
  if(!checkoutUrl)return json({ok:false,message:'A InfinitePay não retornou o link de pagamento.'},502)
  await env.DB.prepare(`UPDATE payments SET external_id=?,checkout_url=?,raw_status='created',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(external||null,checkoutUrl,paymentId).run()
  await env.DB.prepare(`UPDATE appointments SET payment_external_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(external||null,appointmentId).run()
  return json({ok:true,payment_id:paymentId,provider:'infinitepay',checkout_url:checkoutUrl,amount_cents:amount,payment_deadline_at:deadline})
}
