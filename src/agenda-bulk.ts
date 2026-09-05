import { readCookie, sha256 } from './auth'
import { removePortalAvailabilityFromGoogle, syncPortalAvailabilityToGoogle } from './google-calendar-sync'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const now=()=>new Date().toISOString()

type Cell={starts_at:string;ends_at:string}
type Mode='free'|'occupied'|'blocked'|'delete'
type Existing={id:number;starts_at:string;ends_at:string;status:string}

async function admin(request:Request,env:Env){
  const token=readCookie(request,'ps_admin_session'); if(!token)return null
  return env.DB.prepare(`SELECT a.id FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),now()).first<any>()
}
async function tableExists(env:Env,name:string){return Boolean(await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(name).first<any>())}
function validCell(cell:Cell){const s=new Date(cell.starts_at),e=new Date(cell.ends_at);if(Number.isNaN(s.getTime())||Number.isNaN(e.getTime())||e<=s)return false;const weekday=s.getUTCDay(),duration=(e.getTime()-s.getTime())/60000;return weekday>=1&&weekday<=6&&duration===50}
function isPastCell(cell:Cell){return new Date(cell.starts_at).getTime()<Date.now()}

export async function handleAgendaBulk(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/admin/availability/bulk'||request.method!=='POST')return null
  const a=await admin(request,env); if(!a)return json({ok:false,message:'Acesso profissional necessário.'},401)
  const body=await request.json().catch(()=>({})) as any
  const mode=String(body.mode||'') as Mode
  const cells=(Array.isArray(body.cells)?body.cells:[]).slice(0,200).map((c:any)=>({starts_at:String(c.starts_at||''),ends_at:String(c.ends_at||'')})) as Cell[]
  if(!['free','occupied','blocked','delete'].includes(mode)||!cells.length)return json({ok:false,message:'Selecione pelo menos um horário e escolha uma ação.'},400)
  if(cells.some(c=>!validCell(c)))return json({ok:false,message:'A grade aceita sessões de 50 minutos, de segunda a sábado.'},400)
  if(cells.some(isPastCell))return json({ok:false,message:'Horários passados são somente para consulta e não podem ser alterados.'},409)

  const minStart=cells.reduce((a,c)=>c.starts_at<a?c.starts_at:a,cells[0].starts_at),maxEnd=cells.reduce((a,c)=>c.ends_at>a?c.ends_at:a,cells[0].ends_at)
  const existingResult=await env.DB.prepare(`SELECT id,starts_at,ends_at,status FROM availability WHERE starts_at < ? AND ends_at > ?`).bind(maxEnd,minStart).all<Existing>()
  const existing=(existingResult.results||[]) as Existing[],exactByKey=new Map(existing.map(s=>[`${s.starts_at}|${s.ends_at}`,s]))
  const hasAppointments=await tableExists(env,'appointments'),protectedIds=new Set<number>()
  if(hasAppointments&&existing.length){const ids=existing.map(s=>s.id),placeholders=ids.map(()=>'?').join(',');const linked=await env.DB.prepare(`SELECT availability_id FROM appointments WHERE availability_id IN (${placeholders}) AND status IN ('pending_payment','confirmed')`).bind(...ids).all<any>();for(const row of linked.results||[])protectedIds.add(Number(row.availability_id))}

  const statements:any[]=[],changedCells:Cell[]=[],deleteIds:number[]=[];let skipped=0
  for(const cell of cells){
    const key=`${cell.starts_at}|${cell.ends_at}`,exact=exactByKey.get(key),overlap=exact?null:existing.find(s=>s.starts_at<cell.ends_at&&s.ends_at>cell.starts_at)
    if(mode==='delete'){
      if(!exact||['held','confirmed'].includes(String(exact.status))||protectedIds.has(exact.id)){skipped++;continue}
      deleteIds.push(exact.id);statements.push(env.DB.prepare('DELETE FROM availability WHERE id=?').bind(exact.id));changedCells.push(cell);exactByKey.delete(key);continue
    }
    if(overlap){skipped++;continue}
    if(exact){
      if(['held','confirmed'].includes(String(exact.status))||protectedIds.has(exact.id)){skipped++;continue}
      statements.push(env.DB.prepare(`UPDATE availability SET status=?,public_visibility='visible',source='manual',recurring_block_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(mode,exact.id));changedCells.push(cell)
    }else{
      statements.push(env.DB.prepare(`INSERT INTO availability (starts_at,ends_at,status,public_visibility,source) VALUES (?,?,?,'visible','manual')`).bind(cell.starts_at,cell.ends_at,mode));changedCells.push(cell)
    }
  }

  let googleAttempts=0,googleFailures=0
  for(const id of deleteIds){googleAttempts++;try{if(!(await removePortalAvailabilityFromGoogle(env,id)))googleFailures++}catch{googleFailures++}}
  if(statements.length)await env.DB.batch(statements)
  if(mode!=='delete')for(const cell of changedCells){const row=await env.DB.prepare(`SELECT id FROM availability WHERE starts_at=? AND ends_at=? ORDER BY id DESC LIMIT 1`).bind(cell.starts_at,cell.ends_at).first<any>();if(row?.id){googleAttempts++;try{if(!(await syncPortalAvailabilityToGoogle(env,Number(row.id))))googleFailures++}catch{googleFailures++}}}

  const changed=changedCells.length
  const base=skipped?`${changed} horário(s) alterado(s); ${skipped} não puderam ser alterados por conflito, reserva ou sessão confirmada.`:`${changed} horário(s) alterado(s).`
  const googleMessage=googleAttempts===0?' Google Agenda: nenhuma sincronização foi necessária.':googleFailures?` Google Agenda: FALHA em ${googleFailures} de ${googleAttempts} tentativa(s).`:` Google Agenda: sincronização enviada com sucesso (${googleAttempts} tentativa(s)).`
  return json({ok:true,changed,skipped,changed_cells:changedCells,google_sync:{attempted:googleAttempts,failed:googleFailures,ok:googleFailures===0},message:`${base}${googleMessage}`})
}
