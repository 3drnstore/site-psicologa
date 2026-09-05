import { readCookie, sha256 } from './auth'
import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const TZ='America/Sao_Paulo'
const nowIso=()=>new Date().toISOString()

async function admin(request:Request,env:Env){const token=readCookie(request,'ps_admin_session');if(!token)return null;return env.DB.prepare(`SELECT a.* FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),nowIso()).first<any>()}
function monthKey(d=new Date()){const p=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit'}).formatToParts(d);return `${p.find(x=>x.type==='year')?.value}-${p.find(x=>x.type==='month')?.value}`}
function monthDiff(current:string,target:string){const [cy,cm]=current.split('-').map(Number),[ty,tm]=target.split('-').map(Number);return(cy*12+cm)-(ty*12+tm)}
function validMonth(value:string){return /^\d{4}-(0[1-9]|1[0-2])$/.test(value)}
function monthRange(key:string){const [y,m]=key.split('-').map(Number),next=m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`;return{from:`${key}-01T00:00:00-03:00`,to:`${next}-01T00:00:00-03:00`}}
function ptDateTime(v:string){return new Intl.DateTimeFormat('pt-BR',{timeZone:TZ,dateStyle:'short',timeStyle:'short'}).format(new Date(v))}
function monthTitle(key:string){const [y,m]=key.split('-').map(Number);return new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(y,m-1,1)).replace(/^./,c=>c.toUpperCase())}
function money(cents:number){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(cents)||0)/100)}

type StatementEvent={kind:'received'|'refund';at:string;amount_cents:number;appointment_id:number;patient_name:string;description:string}
async function statement(env:Env,key:string){
  const range=monthRange(key)
  const rows=await env.DB.prepare(`SELECT a.id AS appointment_id,a.status,a.amount_cents,a.paid_at,a.updated_at,a.cancellation_reason,p.full_name AS patient_name FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE (a.paid_at IS NOT NULL AND datetime(a.paid_at)>=datetime(?) AND datetime(a.paid_at)<datetime(?)) OR (a.status='cancelled' AND a.paid_at IS NOT NULL AND datetime(a.updated_at)>=datetime(?) AND datetime(a.updated_at)<datetime(?)) ORDER BY datetime(COALESCE(a.updated_at,a.paid_at))`).bind(range.from,range.to,range.from,range.to).all<any>()
  const events:StatementEvent[]=[]
  for(const row of rows.results||[]){
    if(row.paid_at){const t=new Date(row.paid_at).getTime();if(t>=new Date(range.from).getTime()&&t<new Date(range.to).getTime())events.push({kind:'received',at:row.paid_at,amount_cents:Number(row.amount_cents||0),appointment_id:Number(row.appointment_id),patient_name:String(row.patient_name||'Paciente'),description:'Pagamento recebido'})}
    if(row.status==='cancelled'&&row.paid_at&&row.updated_at){const t=new Date(String(row.updated_at).replace(' ','T')+'Z').getTime();if(t>=new Date(range.from).getTime()&&t<new Date(range.to).getTime())events.push({kind:'refund',at:new Date(t).toISOString(),amount_cents:Number(row.amount_cents||0),appointment_id:Number(row.appointment_id),patient_name:String(row.patient_name||'Paciente'),description:row.cancellation_reason?`Cancelamento: ${String(row.cancellation_reason)}`:'Consulta paga cancelada'})}
  }
  events.sort((a,b)=>new Date(a.at).getTime()-new Date(b.at).getTime()||(a.kind==='received'?-1:1))
  const received=events.filter(e=>e.kind==='received').reduce((s,e)=>s+e.amount_cents,0),refunds=events.filter(e=>e.kind==='refund').reduce((s,e)=>s+e.amount_cents,0)
  return{month:key,title:monthTitle(key),events,received_cents:received,refunds_cents:refunds,net_cents:received-refunds}
}

const cp1252Extra:Record<number,number>={0x20ac:0x80,0x201a:0x82,0x0192:0x83,0x201e:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02c6:0x88,0x2030:0x89,0x0160:0x8a,0x2039:0x8b,0x0152:0x8c,0x017d:0x8e,0x2018:0x91,0x2019:0x92,0x201c:0x93,0x201d:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02dc:0x98,0x2122:0x99,0x0161:0x9a,0x203a:0x9b,0x0153:0x9c,0x017e:0x9e,0x0178:0x9f}
function pdfHex(value:string){let out='';for(const ch of value){const cp=ch.codePointAt(0)||63;let b=cp<=255?cp:cp1252Extra[cp]??63;out+=b.toString(16).padStart(2,'0')}return `<${out}>`}
function makePdf(data:Awaited<ReturnType<typeof statement>>){
  const lines=[`Extrato financeiro - ${data.title}`,`Recebimentos: ${money(data.received_cents)}   Estornos: ${money(data.refunds_cents)}   Saldo liquido: ${money(data.net_cents)}`,'',...data.events.map(e=>`${ptDateTime(e.at)}   ${e.kind==='received'?'+':'-'} ${money(e.amount_cents)}   ${e.patient_name}   ${e.description}   Consulta #${e.appointment_id}`)]
  if(data.events.length===0)lines.push('Nenhum lancamento neste mes.')
  const chunks:string[][]=[];for(let i=0;i<lines.length;i+=38)chunks.push(lines.slice(i,i+38))
  const objects:string[]=[]
  objects[1]='<< /Type /Catalog /Pages 2 0 R >>'
  const fontId=3;objects[fontId]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  let next=4;const pageIds:number[]=[]
  chunks.forEach((chunk,pageIndex)=>{const pageId=next++,contentId=next++;pageIds.push(pageId);const cmds=['BT','/F1 10 Tf'];chunk.forEach((line,i)=>{const y=800-i*19;cmds.push(`1 0 0 1 45 ${y} Tm ${pdfHex(line)} Tj`)});cmds.push(`1 0 0 1 45 35 Tm ${pdfHex(`Pagina ${pageIndex+1} de ${chunks.length}`)} Tj`,'ET');const stream=cmds.join('\n');objects[contentId]=`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;objects[pageId]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`})
  objects[2]=`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  let pdf='%PDF-1.4\n';const offsets:number[]=[0];for(let i=1;i<objects.length;i++){offsets[i]=pdf.length;pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`}const xref=pdf.length;pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;for(let i=1;i<objects.length;i++)pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(pdf)
}

export async function handleFinanceStatement(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/admin/finance-statement'&&path!=='/api/admin/finance-statement.pdf')return null
  const current=await admin(request,env);if(!current)return json({ok:false,message:'Acesso administrativo necessário.'},401)
  if(request.method!=='GET')return json({ok:false,message:'Método não permitido.'},405)
  const url=new URL(request.url),requested=url.searchParams.get('month')||monthKey(),currentMonth=monthKey()
  if(!validMonth(requested)||monthDiff(currentMonth,requested)<0||monthDiff(currentMonth,requested)>3)return json({ok:false,message:'O extrato pode ser consultado no mês atual ou em até 3 meses anteriores.'},400)
  const data=await statement(env,requested)
  if(path.endsWith('.pdf')){const bytes=makePdf(data);return new Response(bytes,{headers:{'content-type':'application/pdf','content-disposition':`attachment; filename="extrato-${requested}.pdf"`,'cache-control':'no-store'}})}
  return json({ok:true,...data,available_months:Array.from({length:4},(_,i)=>{const [y,m]=currentMonth.split('-').map(Number),d=new Date(y,m-1-i,1);return{key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,label:new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(d).replace(/^./,c=>c.toUpperCase())}})})
}
