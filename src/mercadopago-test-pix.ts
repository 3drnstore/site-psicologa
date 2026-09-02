import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()

async function patient(request:Request,env:Env){
  const token=readCookie(request,'ps_session')
  if(!token)return null
  return env.DB.prepare(`SELECT p.* FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token),nowIso()).first<any>()
}

function isTestMode(env:Env){
  return String(env.MERCADOPAGO_TEST_MODE??'true').toLowerCase()!=='false'
}

async function fetchOrder(env:Env,orderId:string){
  if(!env.MERCADOPAGO_ACCESS_TOKEN)return null
  const r=await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`,{headers:{authorization:`Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,accept:'application/json'}})
  if(!r.ok)return null
  return await r.json() as any
}

async function confirmTestPayment(env:Env,payment:any,order:any){
  const tx=order?.transactions?.payments?.[0]
  const status=String(order?.status||'').toLowerCase()
  const detail=String(order?.status_detail||tx?.status_detail||'').toLowerCase()
  const method=String(tx?.payment_method?.id||'').toLowerCase()
  const cents=Math.round(Number(order?.total_amount??tx?.amount??0)*100)
  if(status==='processed'&&detail==='accredited'&&method==='pix'&&cents===5000){
    const ap=await env.DB.prepare(`SELECT availability_id FROM appointments WHERE id=?`).bind(payment.appointment_id).first<any>()
    if(!ap)return false
    await env.DB.batch([
      env.DB.prepare(`UPDATE payments SET status='approved',raw_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(`${status}:${detail}`,payment.id),
      env.DB.prepare(`UPDATE appointments SET status='confirmed',paid_at=CURRENT_TIMESTAMP,payment_method='pix',payment_provider='mercadopago',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(payment.appointment_id),
      env.DB.prepare(`UPDATE availability SET status='confirmed',public_visibility='visible',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(ap.availability_id),
    ])
    return true
  }
  await env.DB.prepare(`UPDATE payments SET raw_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(`${status}:${detail}`,payment.id).run()
  return false
}

export async function handleMercadoPagoTestPix(request:Request,env:Env,path:string,ctx:ExecutionContext):Promise<Response|null>{
  if(!isTestMode(env))return null

  if(path==='/api/payments/checkout'&&request.method==='POST'){
    const clone=request.clone()
    const body=await clone.json().catch(()=>({})) as any
    if(body.method!=='pix')return null
    const p=await patient(request,env)
    if(!p)return json({ok:false,message:'Faça login para continuar.'},401)
    const appointmentId=Number(body.appointment_id)
    const ap=await env.DB.prepare(`SELECT * FROM appointments WHERE id=? AND patient_id=?`).bind(appointmentId,p.id).first<any>()
    if(!ap||ap.status!=='pending_payment')return json({ok:false,message:'Reserva não disponível para pagamento.'},409)
    if(ap.reserved_until&&new Date(ap.reserved_until).getTime()<=Date.now())return json({ok:false,message:'O tempo desta reserva expirou. Escolha o horário novamente.'},409)
    if(!env.MERCADOPAGO_ACCESS_TOKEN)return json({ok:false,message:'Mercado Pago ainda não configurado.'},503)

    const existing=await env.DB.prepare(`SELECT * FROM payments WHERE appointment_id=? AND provider='mercadopago' AND status='pending' AND raw_reference LIKE 'sandbox_pix:%' ORDER BY id DESC LIMIT 1`).bind(appointmentId).first<any>()
    if(existing?.external_id){
      const order=await fetchOrder(env,String(existing.external_id))
      if(order)await confirmTestPayment(env,existing,order)
      const fresh=await env.DB.prepare(`SELECT status FROM appointments WHERE id=?`).bind(appointmentId).first<any>()
      if(fresh?.status==='confirmed')return json({ok:true,status:'approved',provider:'mercadopago',test_mode:true,amount_cents:5000,session_amount_cents:Number(ap.amount_cents||0)})
      return json({ok:true,provider:'mercadopago',test_mode:true,amount_cents:5000,session_amount_cents:Number(ap.amount_cents||0),pix_qr_code:existing.pix_qr_code,pix_copy_paste:existing.pix_copy_paste,checkout_url:existing.checkout_url})
    }

    const ins=await env.DB.prepare(`INSERT INTO payments (appointment_id,provider,method,status,amount_cents,raw_reference) VALUES (?,'mercadopago','pix','pending',5000,?)`).bind(appointmentId,`sandbox_pix:session_amount=${Number(ap.amount_cents||0)}`).run()
    const paymentId=Number(ins.meta.last_row_id)
    const payload={
      type:'online',
      external_reference:`consulta_test_${appointmentId}_${paymentId}`,
      total_amount:'50.00',
      processing_mode:'automatic',
      payer:{email:'test_user_br@testuser.com',first_name:'APRO'},
      transactions:{payments:[{amount:'50.00',payment_method:{id:'pix',type:'bank_transfer'}}]},
    }
    const r=await fetch('https://api.mercadopago.com/v1/orders',{method:'POST',headers:{authorization:`Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,'content-type':'application/json',accept:'application/json','X-Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(payload)})
    const d=await r.json().catch(()=>({})) as any
    if(!r.ok){
      const detail=String(d?.message||d?.error||JSON.stringify(d)).slice(0,800)
      await env.DB.prepare(`UPDATE payments SET status='failed',raw_status=? WHERE id=?`).bind(detail,paymentId).run()
      return json({ok:false,message:`Mercado Pago (teste): ${detail}`},502)
    }
    const orderId=String(d.id||'')
    const tx=d?.transactions?.payments?.[0]
    const pm=tx?.payment_method||{}
    const qrBase64=String(pm.qr_code_base64||'')
    const qrDataUrl=qrBase64?`data:image/png;base64,${qrBase64}`:null
    const copyPaste=pm.qr_code?String(pm.qr_code):null
    const ticketUrl=pm.ticket_url?String(pm.ticket_url):null
    if(!orderId||(!qrDataUrl&&!copyPaste&&!ticketUrl))return json({ok:false,message:'O Mercado Pago criou a cobrança de teste, mas não retornou os dados do Pix.'},502)
    await env.DB.prepare(`UPDATE payments SET external_id=?,checkout_url=?,pix_qr_code=?,pix_copy_paste=?,raw_status=? WHERE id=?`).bind(orderId,ticketUrl,qrDataUrl,copyPaste,`${String(d.status||'created')}:${String(d.status_detail||'')}`,paymentId).run()
    await env.DB.prepare(`UPDATE appointments SET payment_method='pix',payment_provider='mercadopago',payment_external_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(orderId,appointmentId).run()
    return json({ok:true,payment_id:paymentId,provider:'mercadopago',test_mode:true,amount_cents:5000,session_amount_cents:Number(ap.amount_cents||0),pix_qr_code:qrDataUrl,pix_copy_paste:copyPaste,checkout_url:ticketUrl})
  }

  const statusMatch=path.match(/^\/api\/payments\/status\/(\d+)$/)
  if(statusMatch&&request.method==='GET'){
    const p=await patient(request,env);if(!p)return json({ok:false,message:'Faça login para continuar.'},401)
    const appointmentId=Number(statusMatch[1])
    const ap=await env.DB.prepare(`SELECT * FROM appointments WHERE id=? AND patient_id=?`).bind(appointmentId,p.id).first<any>()
    if(!ap)return json({ok:false,message:'Consulta não encontrada.'},404)
    const payment=await env.DB.prepare(`SELECT * FROM payments WHERE appointment_id=? AND provider='mercadopago' AND raw_reference LIKE 'sandbox_pix:%' ORDER BY id DESC LIMIT 1`).bind(appointmentId).first<any>()
    if(!payment)return null
    if(payment.external_id&&payment.status!=='approved'){
      const order=await fetchOrder(env,String(payment.external_id));if(order)await confirmTestPayment(env,payment,order)
    }
    const fresh=await env.DB.prepare(`SELECT status,paid_at,reserved_until FROM appointments WHERE id=?`).bind(appointmentId).first<any>()
    return json({ok:true,appointment:fresh,test_mode:true})
  }

  if(path==='/api/payments/webhook/mercadopago'&&request.method==='POST'){
    const payload=await request.json().catch(()=>({})) as any
    const orderId=String(payload?.data?.id||payload?.id||'')
    if(orderId){
      const payment=await env.DB.prepare(`SELECT * FROM payments WHERE provider='mercadopago' AND external_id=? AND raw_reference LIKE 'sandbox_pix:%' ORDER BY id DESC LIMIT 1`).bind(orderId).first<any>()
      if(payment)ctx.waitUntil((async()=>{const order=await fetchOrder(env,orderId);if(order)await confirmTestPayment(env,payment,order)})())
      else return null
    }
    return json({ok:true},200)
  }

  return null
}
