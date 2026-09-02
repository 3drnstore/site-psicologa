import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const now=()=>new Date().toISOString()

async function ensurePricingSchema(env:Env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()
  const defaults:[string,string][]=[
    ['consultation_price_cents','0'],
    ['pix_price_cents','0'],
    ['card_price_cents','0'],
    ['appointment_duration_minutes','50'],
    ['hold_minutes','15'],
    ['pix_discount_percent','0'],
  ]
  for(const [key,value] of defaults){
    await env.DB.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)`).bind(key,value).run()
  }
}

async function admin(request:Request,env:Env){
  const token=readCookie(request,'ps_admin_session')
  if(!token)return null
  return env.DB.prepare(`SELECT a.id FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),now()).first<any>()
}

async function readSettings(env:Env){
  const result=await env.DB.prepare(`SELECT key,value FROM settings WHERE key IN ('consultation_price_cents','card_price_cents','pix_price_cents','appointment_duration_minutes','hold_minutes')`).all<any>()
  const map=Object.fromEntries((result.results||[]).map((r:any)=>[r.key,r.value]))
  const legacy=Number(map.consultation_price_cents||0)
  const card=Number(map.card_price_cents||legacy)
  const pix=Number(map.pix_price_cents||legacy)
  return {
    consultation_price_cents:card,
    card_price_cents:card,
    pix_price_cents:pix,
    appointment_duration_minutes:Number(map.appointment_duration_minutes||50),
    hold_minutes:Number(map.hold_minutes||15),
  }
}

async function put(env:Env,key:string,value:number){
  await env.DB.prepare(`INSERT INTO settings (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(key,String(value)).run()
}

export async function handlePricingV2(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/admin/settings')return null
  try{
    await ensurePricingSchema(env)
    const a=await admin(request,env)
    if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
    if(request.method==='GET')return json({ok:true,settings:await readSettings(env)})
    if(request.method==='PUT'){
      const data=await request.json().catch(()=>({})) as any
      const card=Math.max(0,Math.round(Number(data.card_price_cents??data.consultation_price_cents??0)))
      const pix=Math.max(0,Math.round(Number(data.pix_price_cents??card)))
      const duration=Math.max(10,Math.round(Number(data.appointment_duration_minutes||50)))
      const hold=Math.max(5,Math.round(Number(data.hold_minutes||15)))
      await put(env,'card_price_cents',card)
      await put(env,'pix_price_cents',pix)
      await put(env,'consultation_price_cents',card)
      await put(env,'appointment_duration_minutes',duration)
      await put(env,'hold_minutes',hold)
      await put(env,'pix_discount_percent',0)
      return json({ok:true,settings:await readSettings(env)})
    }
    return json({ok:false,message:'Método não permitido.'},405)
  }catch(error){
    console.error('Pricing API error:',error)
    return json({ok:false,message:'Não foi possível carregar ou salvar os valores da sessão.'},500)
  }
}
