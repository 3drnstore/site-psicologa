import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const now=()=>new Date().toISOString()
async function patient(request:Request,env:Env){const token=readCookie(request,'ps_session');if(!token)return null;return env.DB.prepare(`SELECT p.* FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token),now()).first<any>()}

export async function handleRecurringCheckout(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/payments/checkout'||request.method!=='POST')return null
  const probe=await request.clone().json().catch(()=>({})) as any
  const appointmentId=Number(probe.appointment_id);if(!appointmentId)return null
  const appointment=await env.DB.prepare(`SELECT * FROM appointments WHERE id=?`).bind(appointmentId).first<any>()
  if(!appointment||appointment.reservation_kind!=='recurring')return null
  const p=await patient(request,env);if(!p)return json({ok:false,message:'Faça login para continuar.'},401)
  if(Number(appointment.patient_id)!==Number(p.id)||appointment.status!=='pending_payment')return json({ok:false,message:'Reserva recorrente não disponível para pagamento.'},409)
  const deadline=appointment.payment_deadline_at||appointment.reserved_until
  if(!deadline||new Date(deadline).getTime()<=Date.now())return json({ok:false,message:'O prazo para confirmar esta reserva terminou e o horário foi liberado.'},409)
  const method=probe.method==='pix'?'pix':probe.method==='card'?'credit_card':'';if(!method)return json({ok:false,message:'Forma de pagamento inválida.'},400)
  const amount=Math.max(0,Number(appointment.amount_cents||0));if(!amount)return json({ok:false,message:'O valor desta sessão ainda não está configurado.'},409)
  const existing=await env.DB.prepare(`SELECT * FROM payments WHERE appointment_id=? AND provider=? AND status='pending' ORDER BY id DESC LIMIT 1`).bind(appointmentId,method==='pix'?'mercadopago':'infinitepay').first<any>()
  if(existing&&(existing.pix_qr_code||existing.checkout_url))return json({ok:true,payment_id:existing.id,provider:existing.provider,pix_qr_code:existing.pix_qr_code,pix_copy_paste:existing.pix_copy_paste,checkout_url:existing.checkout_url,amount_cents:Number(existing.amount_cents)})
  const provider=method==='pix'?'mercadopago':'infinitepay'
  const inserted=await env.DB.prepare(`INSERT INTO payments(appointment_id,provider,method,status,amount_cents) VALUES(?,?,?,'pending',?)`).bind(appointmentId,provider,method,amount).run();const paymentId=Number(inserted.meta.last_row_id)
  const origin=env.APP_ORIGIN||new URL(request.url).origin
  if(method==='pix'){
    if(!env.MERCADOPAGO_ACCESS_TOKEN)return json({ok:false,payment_id:paymentId,message:'Mercado Pago ainda não configurado.'},503)
    const remainingMinutes=Math.floor((new Date(deadline).getTime()-Date.now())/60000);if(remainingMinutes<1)return json({ok:false,message:'O prazo desta reserva terminou.'},409)
    const expirationMinutes=Math.max(30,Math.min(43200,remainingMinutes))
    const value=(amount/100).toFixed(2)
    const payload={type:'online',total_amount:value,external_reference:`recorrente-${appointmentId}-pagamento-${paymentId}`,processing_mode:'automatic',transactions:{payments:[{amount:value,payment_method:{id:'pix',type:'bank_transfer'},expiration_time:`PT${expirationMinutes}M`}]},payer:{email:p.email}}
    const r=await fetch('https://api.mercadopago.com/v1/orders',{method:'POST',headers:{authorization:`Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,'content-type':'application/json',accept:'application/json','X-Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(payload)})
    const data=await r.json().catch(()=>({})) as any
    if(!r.ok){await env.DB.prepare(`UPDATE payments SET status='failed',raw_status=? WHERE id=?`).bind(JSON.stringify(data).slice(0,500),paymentId).run();return json({ok:false,message:'Não foi possível gerar o Pix agora.'},503)}
    const transaction=data?.transactions?.payments?.[0],pm=transaction?.payment_method||{},qrBase64=String(pm.qr_code_base64||''),qr=qrBase64?`data:image/png;base64,${qrBase64}`:null,copy=pm.qr_code?String(pm.qr_code):null,ticket=pm.ticket_url?String(pm.ticket_url):null,external=String(data.id||'')
    await env.DB.prepare(`UPDATE payments SET external_id=?,checkout_url=?,pix_qr_code=?,pix_copy_paste=?,raw_status=? WHERE id=?`).bind(external||null,ticket,qr,copy,String(data.status||'created'),paymentId).run()
    await env.DB.prepare(`UPDATE appointments SET payment_method='pix',payment_provider='mercadopago',payment_external_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(external||null,appointmentId).run()
    return json({ok:true,payment_id:paymentId,provider:'mercadopago',pix_qr_code:qr,pix_copy_paste:copy,checkout_url:ticket,amount_cents:amount,payment_deadline_at:deadline})
  }
  if(!env.INFINITEPAY_HANDLE)return json({ok:false,payment_id:paymentId,message:'InfinitePay ainda não configurada.'},503)
  const r=await fetch('https://api.checkout.infinitepay.io/links',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:env.INFINITEPAY_HANDLE,items:[{quantity:1,price:amount,description:'Sessão psicológica recorrente'}],order_nsu:String(paymentId),redirect_url:`${origin}/?payment=return&provider=infinitepay`,webhook_url:`${origin}/api/payments/webhook/infinitepay`,customer:{name:p.full_name,email:p.email,phone_number:p.phone}})})
  const data=await r.json().catch(()=>({})) as any,checkout=data.url||data.checkout_url||data.link||null,external=String(data.slug||data.id||'')
  if(!r.ok||!checkout){await env.DB.prepare(`UPDATE payments SET status='failed',raw_status=? WHERE id=?`).bind(JSON.stringify(data).slice(0,500),paymentId).run();return json({ok:false,message:'Não foi possível abrir o checkout da InfinitePay.'},502)}
  await env.DB.prepare(`UPDATE payments SET external_id=?,checkout_url=?,raw_status='created' WHERE id=?`).bind(external||null,checkout,paymentId).run();await env.DB.prepare(`UPDATE appointments SET payment_method='credit_card',payment_provider='infinitepay',payment_external_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(external||null,appointmentId).run()
  return json({ok:true,payment_id:paymentId,provider:'infinitepay',checkout_url:checkout,amount_cents:amount,payment_deadline_at:deadline})
}
