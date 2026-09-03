import { sha256 } from './auth'
import type { Env } from './types'

type GuardRow={key_hash:string;failures:number;window_started_at:string;blocked_until:string|null}
const WINDOW_MS=15*60_000
const BLOCK_MS=30*60_000
const IP_LIMIT=6
const ACCOUNT_LIMIT=5

const nowIso=()=>new Date().toISOString()
const clientIp=(request:Request)=>request.headers.get('CF-Connecting-IP')||request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()||'unknown'

async function ensureTable(env:Env){
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS admin_login_guard (
    key_hash TEXT PRIMARY KEY,
    failures INTEGER NOT NULL DEFAULT 0,
    window_started_at TEXT NOT NULL,
    blocked_until TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`)
}

async function key(kind:'ip'|'account',value:string){return sha256(`${kind}:${value}`)}

async function row(env:Env,keyHash:string){return env.DB.prepare('SELECT key_hash,failures,window_started_at,blocked_until FROM admin_login_guard WHERE key_hash=?').bind(keyHash).first<GuardRow>()}

function activeBlock(r:GuardRow|null,now:number){return Boolean(r?.blocked_until&&new Date(r.blocked_until).getTime()>now)}

export async function checkAdminLoginGuard(request:Request,env:Env,email:string){
  await ensureTable(env)
  const ipKey=await key('ip',clientIp(request))
  const accountKey=await key('account',email.toLowerCase())
  const [ipRow,accountRow]=await Promise.all([row(env,ipKey),row(env,accountKey)])
  const now=Date.now()
  const blocked=[ipRow,accountRow].filter(r=>activeBlock(r,now)) as GuardRow[]
  if(blocked.length){
    const until=Math.max(...blocked.map(r=>new Date(r.blocked_until as string).getTime()))
    return {allowed:false,retryAfter:Math.max(1,Math.ceil((until-now)/1000))}
  }
  return {allowed:true,ipKey,accountKey}
}

async function registerFailure(env:Env,keyHash:string,limit:number){
  const now=Date.now(), existing=await row(env,keyHash)
  const started=existing?new Date(existing.window_started_at).getTime():0
  const reset=!existing||now-started>WINDOW_MS
  const failures=reset?1:Number(existing?.failures||0)+1
  const windowStarted=reset?new Date(now).toISOString():existing!.window_started_at
  const blockedUntil=failures>=limit?new Date(now+BLOCK_MS).toISOString():null
  await env.DB.prepare(`INSERT INTO admin_login_guard(key_hash,failures,window_started_at,blocked_until,updated_at)
    VALUES(?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key_hash) DO UPDATE SET failures=excluded.failures,window_started_at=excluded.window_started_at,blocked_until=excluded.blocked_until,updated_at=CURRENT_TIMESTAMP`)
    .bind(keyHash,failures,windowStarted,blockedUntil).run()
}

export async function recordAdminLoginFailure(env:Env,ipKey:string,accountKey:string){
  await Promise.all([registerFailure(env,ipKey,IP_LIMIT),registerFailure(env,accountKey,ACCOUNT_LIMIT)])
}

export async function clearAdminAccountFailures(env:Env,accountKey:string){
  await env.DB.prepare('DELETE FROM admin_login_guard WHERE key_hash=?').bind(accountKey).run()
}

export async function verifyTurnstile(request:Request,env:Env,token:string){
  if(!env.TURNSTILE_SECRET_KEY)return {ok:true,required:false}
  if(!token)return {ok:false,required:true}
  const form=new FormData()
  form.set('secret',env.TURNSTILE_SECRET_KEY)
  form.set('response',token)
  const ip=clientIp(request);if(ip&&ip!=='unknown')form.set('remoteip',ip)
  const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:form})
  const data=await response.json().catch(()=>({})) as {success?:boolean}
  return {ok:Boolean(data.success),required:true}
}

export function adminSecurityConfig(env:Env){return {turnstile_site_key:env.TURNSTILE_SITE_KEY||'',turnstile_enabled:Boolean(env.TURNSTILE_SITE_KEY&&env.TURNSTILE_SECRET_KEY)}}
