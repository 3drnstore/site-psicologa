import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const now=()=>new Date().toISOString()

type Cell={starts_at:string;ends_at:string}
type Mode='free'|'blocked'|'delete'

async function admin(request:Request,env:Env){
  const token=readCookie(request,'ps_admin_session'); if(!token)return null
  return env.DB.prepare(`SELECT a.id FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`)
    .bind(await sha256(token),now()).first<any>()
}

function validCell(cell:Cell){
  const s=new Date(cell.starts_at),e=new Date(cell.ends_at)
  if(Number.isNaN(s.getTime())||Number.isNaN(e.getTime())||e<=s)return false
  const weekday=s.getUTCDay()
  const duration=(e.getTime()-s.getTime())/60000
  return weekday>=1&&weekday<=6&&duration===60
}

export async function handleAgendaBulk(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/admin/availability/bulk'||request.method!=='POST')return null
  const a=await admin(request,env); if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
  const body=await request.json().catch(()=>({})) as any
  const mode=String(body.mode||'') as Mode
  const cells=(Array.isArray(body.cells)?body.cells:[]).slice(0,200).map((c:any)=>({starts_at:String(c.starts_at||''),ends_at:String(c.ends_at||'')})) as Cell[]
  if(!['free','blocked','delete'].includes(mode)||!cells.length)return json({ok:false,message:'Selecione pelo menos um horário e escolha uma ação.'},400)
  if(cells.some(c=>!validCell(c)))return json({ok:false,message:'A grade aceita blocos de 1 hora, de segunda a sábado.'},400)

  let changed=0,skipped=0
  for(const cell of cells){
    const exact=await env.DB.prepare(`SELECT id,status FROM availability WHERE starts_at=? AND ends_at=? LIMIT 1`).bind(cell.starts_at,cell.ends_at).first<any>()
    const overlap=exact?null:await env.DB.prepare(`SELECT id,status,starts_at,ends_at FROM availability WHERE starts_at < ? AND ends_at > ? LIMIT 1`).bind(cell.ends_at,cell.starts_at).first<any>()

    if(mode==='delete'){
      if(!exact){skipped++;continue}
      if(['held','confirmed'].includes(String(exact.status))){skipped++;continue}
      const linked=await env.DB.prepare(`SELECT id FROM appointments WHERE availability_id=? AND status IN ('pending_payment','confirmed') LIMIT 1`).bind(exact.id).first<any>()
      if(linked){skipped++;continue}
      await env.DB.prepare('DELETE FROM availability WHERE id=?').bind(exact.id).run();changed++;continue
    }

    if(overlap){skipped++;continue}

    if(exact){
      if(['held','confirmed'].includes(String(exact.status))){skipped++;continue}
      await env.DB.prepare(`UPDATE availability SET status=?,public_visibility='visible',source='manual',recurring_block_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(mode==='free'?'free':'blocked',exact.id).run();changed++
    }else{
      await env.DB.prepare(`INSERT INTO availability (starts_at,ends_at,status,public_visibility,source) VALUES (?,?,?,'visible','manual')`)
        .bind(cell.starts_at,cell.ends_at,mode==='free'?'free':'blocked').run();changed++
    }
  }

  return json({ok:true,changed,skipped,message:skipped?`${changed} horário(s) alterado(s); ${skipped} não puderam ser alterados por conflito, reserva ou consulta confirmada.`:`${changed} horário(s) alterado(s).`})
}
