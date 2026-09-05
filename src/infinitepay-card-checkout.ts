import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const nowIso=()=>new Date().toISOString()

async function patient(request:Request,env:Env){
  const token=readCookie(request,'ps_session')
  if(!token)return null
  return env.DB.prepare(`SELECT p.* FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.token_hash=? AND s.expires_at>? AND COALESCE(p.portal_active,1)=1`).bind(await sha256(token),nowIso()).first<any>()
}

async function setting(env:Env,key:string){
  const row=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first<any>()
  return row?.value==null?'':String(row.value)
}

function infiniteHandle(env:Env){
  return String(env.INFINITEPAY_HANDLE||'').trim().replace(/^\$/,'')
}

function brazilPhone(value:unknown){
  const digits=String(value||'').replace(/\D/g,'')
  if(!digits)return ''
  const normalized=digits.startsWith('55')?digits:`55${digits}`
  return `+${normalized}`
}

function providerDetail(data:any){
  const raw=data?.message||data?.error_description||data?.error||data?.detail||data?.reason||''
  return String(raw||'').replace(/\s+/g,' ').trim().slice(0,240)
}

export async function handleInfinitePayCardCheckout(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/payments/checkout'||request.method!=='POST')return null
  const probe=await request.clone().json().catch(()=>({})) as any
  if(probe.method!=='card')return null

  const p=await patient(request,env)
  if(!p)return json({ok:false,message:'Faça login para continuar.'},401)
  const appointmentId=Number(probe.appointment_id)
  if(!appointmentId)return json({ok:false,message:'Reserva inválida.'},400)

  const appointment=await env.DB.prepare(`SELECT * FROM appointments WHERE id=? AND patient_id=?`).bind(appointmentId,p.id).first<any>()
  if(!appointment||appointment.status!=='pending_payment')return json({ok:false,message:'Reserva não disponível para pagamento.'},409)
  const deadline=appointment.payment_deadline_at||appointment.reserved_until
  if(!deadline||new Date(deadline).getTime()<=Date.now())return json({ok:false,message:'O prazo de pagamento desta reserva terminou e o horário será liberado.'},409)

  const configuredCard=Number(await setting(env,'card_price_cents'))
  const preserveAppointmentPrice=appointment.reservation_kind==='recurring'||['platform_1','platform_2'].includes(String(p.pricing_origin||''))
  const amount=Math.max(0,Math.round(preserveAppointmentPrice?Number(appointment.amount_cents||0):(configuredCard||Number(appointment.amount_cents||0))))
  if(amount<=0)return json({ok:false,message:'O valor da sessão ainda não foi configurado pela profissional.'},409)

  const handle=infiniteHandle(env)
  if(!handle)return json({ok:false,message:'InfinitePay ainda não configurada.'},503)

  const existing=await env.DB.prepare(`SELECT * FROM payments WHERE appointment_id=? AND provider='infinitepay' AND status='pending' AND checkout_url IS NOT NULL ORDER BY id DESC LIMIT 1`).bind(appointmentId).first<any>()
  if(existing?.checkout_url)return json({ok:true,payment_id:Number(existing.id),provider:'infinitepay',checkout_url:existing.checkout_url,amount_cents:Number(existing.amount_cents),payment_deadline_at:deadline})

  await env.DB.prepare(`UPDATE appointments SET amount_cents=?,payment_method='credit_card',payment_provider='infinitepay',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(amount,appointmentId).run()
  const inserted=await env.DB.prepare(`INSERT INTO payments(appointment_id,provider,method,status,amount_cents,raw_status) VALUES(?,'infinitepay','credit_card','pending',?,'creating')`).bind(appointmentId,amount).run()
  const paymentId=Number(inserted.meta.last_row_id)
  const origin=env.APP_ORIGIN||new URL(request.url).origin
  const phone=brazilPhone(p.phone)
  const customer:any={name:String(p.full_name||'Paciente'),email:String(p.email||'')}
  if(phone)customer.phone_number=phone

  let response:Response
  let data:any={}
  try{
    response=await fetch('https://api.checkout.infinitepay.io/links',{
      method:'POST',
      headers:{'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({
        handle,
        items:[{quantity:1,price:amount,description:'Consulta psicológica'}],
        order_nsu:String(paymentId),
        redirect_url:`${origin}/?payment=return&provider=infinitepay`,
        webhook_url:`${origin}/api/payments/webhook/infinitepay`,
        customer,
      }),
    })
    data=await response.json().catch(()=>({}))
  }catch(error){
    const detail=error instanceof Error?error.message:String(error)
    await env.DB.prepare(`UPDATE payments SET status='failed',raw_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(detail.slice(0,1000),paymentId).run()
    return json({ok:false,message:'Não foi possível conectar ao checkout da InfinitePay.'},502)
  }

  const checkoutUrl=data?.url||data?.checkout_url||data?.link||null
  const external=String(data?.slug||data?.id||'')
  if(!response.ok||!checkoutUrl){
    await env.DB.prepare(`UPDATE payments SET status='failed',raw_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(JSON.stringify(data).slice(0,1000),paymentId).run()
    const detail=providerDetail(data)
    return json({ok:false,message:detail?`InfinitePay: ${detail}`:'Não foi possível abrir o checkout da InfinitePay.'},502)
  }

  await env.DB.prepare(`UPDATE payments SET external_id=?,checkout_url=?,raw_status='created',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(external||null,checkoutUrl,paymentId).run()
  await env.DB.prepare(`UPDATE appointments SET payment_external_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(external||null,appointmentId).run()
  return json({ok:true,payment_id:paymentId,provider:'infinitepay',checkout_url:checkoutUrl,amount_cents:amount,payment_deadline_at:deadline})
}
