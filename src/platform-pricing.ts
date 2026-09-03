import { randomToken, readCookie, sha256 } from './auth'
import type { Env } from './types'

export type PricingOrigin='particular'|'platform_1'|'platform_2'
const ORIGINS:PricingOrigin[]=['particular','platform_1','platform_2']
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const now=()=>new Date().toISOString()
let schemaReady=false

async function setting(env:Env,key:string,fallback=''){
  const row=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first<any>()
  return row?.value??fallback
}
async function put(env:Env,key:string,value:string|number){
  await env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(key,String(value)).run()
}
async function admin(request:Request,env:Env){
  const token=readCookie(request,'ps_admin_session');if(!token)return null
  return env.DB.prepare(`SELECT a.id,a.role FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),now()).first<any>()
}

async function ensureOriginColumn(env:Env){
  if(schemaReady)return
  const info=await env.DB.prepare('PRAGMA table_info(patients)').all<any>()
  const exists=(info.results||[]).some((row:any)=>row.name==='pricing_origin')
  if(!exists)await env.DB.prepare(`ALTER TABLE patients ADD COLUMN pricing_origin TEXT DEFAULT 'particular'`).run()
  await env.DB.prepare(`UPDATE patients SET pricing_origin='particular' WHERE pricing_origin IS NULL OR pricing_origin=''`).run()
  schemaReady=true
}

export async function ensurePlatformPricing(env:Env){
  await ensureOriginColumn(env)
  const defaults:[string,string][]=[['platform_1_name','Plataforma 1'],['platform_1_price_cents','3000'],['platform_2_name','Plataforma 2'],['platform_2_price_cents','6000']]
  for(const [key,value] of defaults)await env.DB.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').bind(key,value).run()
  for(const origin of ['platform_1','platform_2'] as const){
    const key=`${origin}_invite_token`
    if(!(await setting(env,key,'')))await put(env,key,randomToken(24))
  }
}

export async function originFromInvite(env:Env,token:string):Promise<PricingOrigin|null>{
  const clean=String(token||'').trim();if(!clean)return null
  await ensurePlatformPricing(env)
  for(const origin of ['platform_1','platform_2'] as const)if((await setting(env,`${origin}_invite_token`,''))===clean)return origin
  return null
}

export async function pricingForOrigin(env:Env,origin:string|undefined|null,method:'pix'|'card'='card'){
  await ensurePlatformPricing(env)
  const normalized=ORIGINS.includes(origin as PricingOrigin)?origin as PricingOrigin:'particular'
  if(normalized==='platform_1'||normalized==='platform_2'){
    const name=await setting(env,`${normalized}_name`,normalized==='platform_1'?'Plataforma 1':'Plataforma 2')
    const price=Math.max(0,Math.round(Number(await setting(env,`${normalized}_price_cents`,'0'))||0))
    return {origin:normalized,label:name,pix_price_cents:price,card_price_cents:price,consultation_price_cents:price}
  }
  const legacy=Math.max(0,Math.round(Number(await setting(env,'consultation_price_cents','0'))||0))
  const pix=Math.max(0,Math.round(Number(await setting(env,'pix_price_cents',String(legacy)))||0))
  const card=Math.max(0,Math.round(Number(await setting(env,'card_price_cents',String(legacy)))||0))
  return {origin:'particular' as const,label:'Particular',pix_price_cents:pix,card_price_cents:card,consultation_price_cents:method==='pix'?pix:card}
}

async function tableData(request:Request,env:Env){
  await ensurePlatformPricing(env)
  const base=env.APP_ORIGIN||new URL(request.url).origin
  const oneToken=await setting(env,'platform_1_invite_token',''),twoToken=await setting(env,'platform_2_invite_token','')
  return {
    particular:{key:'particular',name:'Particular'},
    platform_1:{key:'platform_1',name:await setting(env,'platform_1_name','Plataforma 1'),price_cents:Number(await setting(env,'platform_1_price_cents','3000')),invite_token:oneToken,registration_url:`${base}/?invite=${encodeURIComponent(oneToken)}`},
    platform_2:{key:'platform_2',name:await setting(env,'platform_2_name','Plataforma 2'),price_cents:Number(await setting(env,'platform_2_price_cents','6000')),invite_token:twoToken,registration_url:`${base}/?invite=${encodeURIComponent(twoToken)}`},
  }
}

export async function handlePlatformPricing(request:Request,env:Env,path:string):Promise<Response|null>{
  const isTables=path==='/api/admin/pricing-tables'
  const regen=path.match(/^\/api\/admin\/pricing-tables\/(platform_[12])\/regenerate-link$/)
  const patientOrigin=path.match(/^\/api\/admin\/patients\/(\d+)\/pricing-origin$/)
  if(!isTables&&!regen&&!patientOrigin)return null
  const a=await admin(request,env);if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
  if(a.role!=='psychologist')return json({ok:false,message:'Esta ação exige acesso de Psicóloga / Administrador.'},403)
  await ensurePlatformPricing(env)

  if(isTables&&request.method==='GET')return json({ok:true,tables:await tableData(request,env)})
  if(isTables&&request.method==='PUT'){
    const b=await request.json().catch(()=>({})) as any
    for(const origin of ['platform_1','platform_2'] as const){
      const value=b[origin]||{}
      const name=String(value.name||'').trim().slice(0,80)
      const price=Math.max(0,Math.round(Number(value.price_cents)||0))
      if(!name)return json({ok:false,message:'Informe o nome das duas plataformas.'},400)
      await put(env,`${origin}_name`,name);await put(env,`${origin}_price_cents`,price)
    }
    return json({ok:true,tables:await tableData(request,env),message:'Tabelas de preço atualizadas.'})
  }
  if(regen&&request.method==='POST'){
    const origin=regen[1] as 'platform_1'|'platform_2';await put(env,`${origin}_invite_token`,randomToken(24))
    return json({ok:true,tables:await tableData(request,env),message:'Novo link de cadastro gerado.'})
  }
  if(patientOrigin&&request.method==='PATCH'){
    const b=await request.json().catch(()=>({})) as any,origin=String(b.pricing_origin||'') as PricingOrigin
    if(!ORIGINS.includes(origin))return json({ok:false,message:'Origem de atendimento inválida.'},400)
    const id=Number(patientOrigin[1]);const exists=await env.DB.prepare('SELECT id FROM patients WHERE id=?').bind(id).first<any>()
    if(!exists)return json({ok:false,message:'Paciente não encontrado.'},404)
    await env.DB.prepare('UPDATE patients SET pricing_origin=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(origin,id).run()
    return json({ok:true,message:'Origem do paciente atualizada.',pricing_origin:origin})
  }
  return json({ok:false,message:'Método não permitido.'},405)
}
