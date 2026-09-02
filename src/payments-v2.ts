import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()

async function patient(request:Request,env:Env){
  const token=readCookie(request,'ps_session'); if(!token)return null
  return env.DB.prepare(`SELECT p.* FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token),nowIso()).first<any>()
}

async function setting(env:Env,key:string,fallback=''){const r=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first<any>();return r?.value??fallback}
async function methodPrice(env:Env,method:'pix'|'credit_card',fallback:number){
  const key=method==='pix'?'pix_price_cents':'card_price_cents'
  const raw=await setting(env,key,'')
  if(raw!=='')return Math.max(0,Math.round(Number(raw)||0))
  const legacy=Number(await setting(env,'consultation_price_cents',String(fallback)))
  return Math.max(0,Math.round(legacy||fallback||0))
}

async function googleAccessToken(env:Env){
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_REFRESH_TOKEN)return null
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})})
  if(!r.ok)return null; return ((await r.json()) as any).access_token||null
}

async function createCalendarEvent(env:Env,appointmentId:number){
  const ap=await env.DB.prepare(`SELECT a.google_calendar_event_id,av.starts_at,av.ends_at,p.full_name,p.email,p.phone FROM appointments a JOIN availability av ON av.id=a.availability_id JOIN patients p ON p.id=a.patient_id WHERE a.id=?`).bind(appointmentId).first<any>()
  if(!ap||ap.google_calendar_event_id)return ap?.google_calendar_event_id||null
  const token=await googleAccessToken(env); if(!token)return null
  const calendar=encodeURIComponent(env.GOOGLE_CALENDAR_ID||'primary')
  const r=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({summary:`Consulta – ${ap.full_name}`,description:`Consulta confirmada pelo site. Contato: ${ap.phone||ap.email}.`,start:{dateTime:ap.starts_at,timeZone:'America/Sao_Paulo'},end:{dateTime:ap.ends_at,timeZone:'America/Sao_Paulo'}})})
  if(!r.ok)return null; const ev=await r.json() as any
  if(ev.id)await env.DB.prepare(`UPDATE appointments SET google_calendar_event_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(ev.id,appointmentId).run()
  return ev.id||null
}

async function confirm(env:Env,payment:any,rawStatus:string,actualMethod?:string){
  if(payment.status==='approved')return
  const ap=await env.DB.prepare('SELECT * FROM appointments WHERE id=?').bind(payment.appointment_id).first<any>(); if(!ap)return
  await env.DB.batch([
    env.DB.prepare(`UPDATE payments SET status='approved',raw_status=?,method=COALESCE(?,method),updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(rawStatus,actualMethod||null,payment.id),
    env.DB.prepare(`UPDATE appointments SET status='confirmed',amount_cents=?,paid_at=CURRENT_TIMESTAMP,payment_method=COALESCE(?,payment_method),updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(Number(payment.amount_cents),actualMethod||null,ap.id),
    env.DB.prepare(`UPDATE availability SET status='confirmed',public_visibility='visible',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(ap.availability_id)
  ])
  await createCalendarEvent(env,Number(ap.id))
}

async function verifySumUp(env:Env,checkoutId:string,payment:any){
  if(!env.SUMUP_API_KEY)return false
  const r=await fetch(`https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(checkoutId)}`,{headers:{authorization:`Bearer ${env.SUMUP_API_KEY}`}})
  if(!r.ok)return false
  const data=await r.json() as any
  const paid=String(data.status||'').toUpperCase()==='PAID'
  const cents=Math.round(Number(data.amount||0)*100)
  if(paid && cents===Number(payment.amount_cents)){await confirm(env,payment,'PAID','pix');return true}
  await env.DB.prepare(`UPDATE payments SET raw_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(String(data.status||'unknown'),payment.id).run();return false
}

async function verifyInfinitePay(env:Env,payload:any,payment:any){
  if(!env.INFINITEPAY_HANDLE)return false
  const slug=payload.invoice_slug||payload.slug; const transaction=payload.transaction_nsu
  if(!slug||!transaction)return false
  const r=await fetch('https://api.checkout.infinitepay.io/payment_check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:env.INFINITEPAY_HANDLE,order_nsu:String(payment.id),transaction_nsu:transaction,slug})})
  if(!r.ok)return false
  const data=await r.json() as any
  if(data.paid===true && Number(data.amount)===Number(payment.amount_cents)){
    const method=String(data.capture_method||payload.capture_method||'credit_card')==='pix'?'pix':'credit_card'
    await confirm(env,payment,'paid',method);return true
  }
  await env.DB.prepare(`UPDATE payments SET raw_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(data.paid?'amount_mismatch':'not_paid',payment.id).run();return false
}

export async function handlePaymentsV2(request:Request,env:Env,path:string,ctx:ExecutionContext):Promise<Response|null>{
  if(path==='/api/payments/checkout'&&request.method==='POST'){
    const p=await patient(request,env); if(!p)return json({ok:false,message:'Faça login para continuar.'},401)
    const data=await request.json().catch(()=>({})) as any
    const appointmentId=Number(data.appointment_id); const requested=data.method==='pix'?'pix':data.method==='card'?'credit_card':''
    if(!requested)return json({ok:false,message:'Forma de pagamento inválida.'},400)
    const ap=await env.DB.prepare(`SELECT * FROM appointments WHERE id=? AND patient_id=?`).bind(appointmentId,p.id).first<any>()
    if(!ap||ap.status!=='pending_payment')return json({ok:false,message:'Reserva não disponível para pagamento.'},409)
    const amount=await methodPrice(env,requested as 'pix'|'credit_card',Number(ap.amount_cents||0))
    const provider=requested==='pix'?'sumup':'infinitepay'
    await env.DB.prepare(`UPDATE appointments SET amount_cents=?,payment_method=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(amount,requested,appointmentId).run()
    const ins=await env.DB.prepare(`INSERT INTO payments (appointment_id,provider,method,status,amount_cents) VALUES (?,?,?,'pending',?)`).bind(appointmentId,provider,requested,amount).run()
    const paymentId=Number(ins.meta.last_row_id); const origin=env.APP_ORIGIN||new URL(request.url).origin

    if(requested==='pix'){
      if(!env.SUMUP_API_KEY||!env.SUMUP_MERCHANT_CODE)return json({ok:false,payment_id:paymentId,message:'SumUp ainda não configurada.'},503)
      const r=await fetch('https://api.sumup.com/v0.1/checkouts',{method:'POST',headers:{authorization:`Bearer ${env.SUMUP_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({checkout_reference:`ps-${paymentId}`,amount:amount/100,currency:'BRL',merchant_code:env.SUMUP_MERCHANT_CODE,description:'Consulta psicológica',return_url:`${origin}/api/payments/webhook/sumup`,hosted_checkout:{enabled:true},redirect_url:`${origin}/?payment=return&provider=sumup`})})
      const d=await r.json().catch(()=>({})) as any
      if(!r.ok){await env.DB.prepare(`UPDATE payments SET status='failed',raw_status=? WHERE id=?`).bind(JSON.stringify(d).slice(0,1000),paymentId).run();return json({ok:false,message:'Não foi possível gerar o Pix na SumUp.'},502)}
      const external=String(d.id||''); const checkoutUrl=d.hosted_checkout_url||d.hosted_checkout?.url||d.checkout_url||d.url||null
      await env.DB.prepare(`UPDATE payments SET external_id=?,checkout_url=?,raw_status=? WHERE id=?`).bind(external||null,checkoutUrl,String(d.status||'PENDING'),paymentId).run()
      await env.DB.prepare(`UPDATE appointments SET payment_provider='sumup',payment_external_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(external||null,appointmentId).run()
      return json({ok:true,payment_id:paymentId,provider:'sumup',checkout_url:checkoutUrl,amount_cents:amount})
    }

    if(!env.INFINITEPAY_HANDLE)return json({ok:false,payment_id:paymentId,message:'InfinitePay ainda não configurada.'},503)
    const r=await fetch('https://api.checkout.infinitepay.io/links',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:env.INFINITEPAY_HANDLE,items:[{quantity:1,price:amount,description:'Consulta psicológica'}],order_nsu:String(paymentId),redirect_url:`${origin}/?payment=return&provider=infinitepay`,webhook_url:`${origin}/api/payments/webhook/infinitepay`,customer:{name:p.full_name,email:p.email,phone_number:p.phone}})})
    const d=await r.json().catch(()=>({})) as any
    if(!r.ok){await env.DB.prepare(`UPDATE payments SET status='failed',raw_status=? WHERE id=?`).bind(JSON.stringify(d).slice(0,1000),paymentId).run();return json({ok:false,message:'Não foi possível abrir o checkout da InfinitePay.'},502)}
    const checkoutUrl=d.url||d.checkout_url||d.link||null; const external=String(d.slug||d.id||'')
    await env.DB.prepare(`UPDATE payments SET external_id=?,checkout_url=?,raw_status='created' WHERE id=?`).bind(external||null,checkoutUrl,paymentId).run()
    await env.DB.prepare(`UPDATE appointments SET payment_provider='infinitepay',payment_external_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(external||null,appointmentId).run()
    return json({ok:true,payment_id:paymentId,provider:'infinitepay',checkout_url:checkoutUrl,amount_cents:amount})
  }

  if(path==='/api/payments/webhook/sumup'&&request.method==='POST'){
    const payload=await request.json().catch(()=>({})) as any; const checkoutId=String(payload.id||'')
    if(!checkoutId)return new Response(null,{status:204})
    const payment=await env.DB.prepare(`SELECT * FROM payments WHERE provider='sumup' AND external_id=? ORDER BY id DESC LIMIT 1`).bind(checkoutId).first<any>()
    if(payment)ctx.waitUntil(verifySumUp(env,checkoutId,payment))
    return new Response(null,{status:204})
  }

  if(path==='/api/payments/webhook/infinitepay'&&request.method==='POST'){
    const payload=await request.json().catch(()=>({})) as any; const id=Number(payload.order_nsu)
    const payment=id?await env.DB.prepare(`SELECT * FROM payments WHERE id=? AND provider='infinitepay'`).bind(id).first<any>():null
    if(payment)ctx.waitUntil(verifyInfinitePay(env,payload,payment))
    return new Response(null,{status:200})
  }

  return null
}
