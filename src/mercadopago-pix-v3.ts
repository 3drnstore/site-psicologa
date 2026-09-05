import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()

async function patient(request:Request,env:Env){
  const token=readCookie(request,'ps_session')
  if(!token)return null
  return env.DB.prepare(`SELECT p.* FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token),nowIso()).first<any>()
}

async function setting(env:Env,key:string,fallback=''){
  const row=await env.DB.prepare(`SELECT value FROM settings WHERE key=?`).bind(key).first<any>()
  return row?.value??fallback
}

function mpError(data:any,status:number){
  const message=String(data?.message||data?.error||'Erro não identificado pelo Mercado Pago.')
  const cause=Array.isArray(data?.cause)?data.cause.map((c:any)=>c?.description||c?.code).filter(Boolean).join('; '):''
  const detail=String(data?.status_detail||data?.details||cause||'').trim()
  return `Mercado Pago (${status}): ${message}${detail?` — ${detail}`:''}`
}

export async function handleMercadoPagoPixV3(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/payments/checkout'||request.method!=='POST')return null
  const body=await request.json().catch(()=>({})) as any
  if(body.method!=='pix')return null

  try{
    const p=await patient(request,env)
    if(!p)return json({ok:false,message:'Faça login para continuar.'},401)

    const appointmentId=Number(body.appointment_id||0)
    if(!appointmentId)return json({ok:false,message:'Reserva inválida.'},400)

    const ap=await env.DB.prepare(`SELECT * FROM appointments WHERE id=? AND patient_id=?`).bind(appointmentId,p.id).first<any>()
    if(!ap||ap.status!=='pending_payment')return json({ok:false,message:'Reserva não disponível para pagamento.'},409)
    const deadline=ap.payment_deadline_at||ap.reserved_until
    if(!deadline||new Date(deadline).getTime()<=Date.now())return json({ok:false,message:'O prazo de pagamento desta reserva terminou e o horário será liberado.'},409)

    const configured=Math.max(0,Number(await setting(env,'pix_price_cents',await setting(env,'consultation_price_cents','0')))||0)
    if(configured<=0)return json({ok:false,message:'O valor Pix ainda não foi configurado pela profissional.'},409)

    const existing=await env.DB.prepare(`SELECT * FROM payments WHERE appointment_id=? AND provider='mercadopago' AND status='pending' AND external_id IS NOT NULL ORDER BY id DESC LIMIT 1`).bind(appointmentId).first<any>()
    if(existing&&(existing.pix_qr_code||existing.pix_copy_paste||existing.checkout_url)){
      await env.DB.prepare(`UPDATE availability SET status='held' WHERE id=? AND status='free'`).bind(ap.availability_id).run()
      return json({ok:true,payment_id:Number(existing.id),provider:'mercadopago',pix_qr_code:existing.pix_qr_code,pix_copy_paste:existing.pix_copy_paste,checkout_url:existing.checkout_url,amount_cents:Number(existing.amount_cents),payment_deadline_at:deadline,test_mode:String(env.MERCADOPAGO_TEST_MODE||'').toLowerCase()==='true'})
    }

    if(!env.MERCADOPAGO_ACCESS_TOKEN)return json({ok:false,message:'Access Token do Mercado Pago não está configurado no servidor.'},503)

    const testMode=String(env.MERCADOPAGO_TEST_MODE||'').toLowerCase()==='true'
    const chargedAmount=testMode?5000:configured
    const amount=(chargedAmount/100).toFixed(2)
    const remainingMinutes=Math.floor((new Date(deadline).getTime()-Date.now())/60000)
    if(remainingMinutes<1)return json({ok:false,message:'O prazo de pagamento desta reserva terminou.'},409)
    const expirationMinutes=Math.max(30,Math.min(43200,remainingMinutes))

    await env.DB.batch([
      env.DB.prepare(`UPDATE appointments SET amount_cents=?,payment_method='pix',payment_provider='mercadopago',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(chargedAmount,appointmentId),
      env.DB.prepare(`UPDATE availability SET status='held',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='free'`).bind(ap.availability_id),
    ])

    const inserted=await env.DB.prepare(`INSERT INTO payments (appointment_id,provider,method,status,amount_cents,raw_status) VALUES (?,'mercadopago','pix','pending',?,'creating')`).bind(appointmentId,chargedAmount).run()
    const paymentId=Number(inserted.meta.last_row_id)

    const payload={
      type:'online',
      total_amount:amount,
      external_reference:`consulta-${appointmentId}-pagamento-${paymentId}`,
      processing_mode:'automatic',
      transactions:{payments:[{amount,payment_method:{id:'pix',type:'bank_transfer'},expiration_time:`PT${expirationMinutes}M`}]},
      payer:testMode
        ?{email:'test_user_br@testuser.com',first_name:'APRO'}
        :{email:p.email,first_name:String(p.full_name||'Paciente').split(' ')[0]}
    }

    const response=await fetch('https://api.mercadopago.com/v1/orders',{
      method:'POST',
      headers:{authorization:`Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,'content-type':'application/json',accept:'application/json','X-Idempotency-Key':crypto.randomUUID()},
      body:JSON.stringify(payload)
    })
    const data=await response.json().catch(()=>({})) as any

    if(!response.ok){
      const detail=mpError(data,response.status)
      await env.DB.prepare(`UPDATE payments SET status='failed',raw_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(detail,paymentId).run()
      return json({ok:false,message:detail},502)
    }

    const tx=data?.transactions?.payments?.[0]||{}
    const pm=tx?.payment_method||{}
    const orderId=String(data?.id||'')
    const qrBase64=String(pm?.qr_code_base64||'')
    const qrDataUrl=qrBase64?`data:image/png;base64,${qrBase64}`:null
    const copyPaste=pm?.qr_code?String(pm.qr_code):null
    const ticketUrl=pm?.ticket_url?String(pm.ticket_url):null
    const rawStatus=`${String(tx?.status||data?.status||'created')}:${String(tx?.status_detail||data?.status_detail||'')}`

    if(!orderId)return json({ok:false,message:'O Mercado Pago respondeu sem o identificador da cobrança.'},502)
    if(!qrDataUrl&&!copyPaste&&!ticketUrl){
      await env.DB.prepare(`UPDATE payments SET external_id=?,raw_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(orderId,`${rawStatus}:missing_pix_data`,paymentId).run()
      return json({ok:false,message:'O Mercado Pago criou a cobrança, mas não retornou QR Code, copia-e-cola nem link Pix.'},502)
    }

    await env.DB.prepare(`UPDATE payments SET external_id=?,checkout_url=?,pix_qr_code=?,pix_copy_paste=?,raw_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(orderId,ticketUrl,qrDataUrl,copyPaste,rawStatus,paymentId).run()
    await env.DB.prepare(`UPDATE appointments SET payment_external_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(orderId,appointmentId).run()

    return json({ok:true,payment_id:paymentId,provider:'mercadopago',pix_qr_code:qrDataUrl,pix_copy_paste:copyPaste,checkout_url:ticketUrl,amount_cents:chargedAmount,payment_deadline_at:deadline,test_mode:testMode})
  }catch(error){
    const detail=error instanceof Error?error.message:String(error)
    console.error('Mercado Pago Pix V3 error:',detail)
    return json({ok:false,message:`Não foi possível gerar o Pix: ${detail}`},500)
  }
}
