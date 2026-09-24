import type { Env } from './types'

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})
const MAX_SIZE=8*1024*1024
const CHUNK_SIZE=512*1024

async function ensureManualSchema(env:Env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS patient_manual_meta (
    id INTEGER PRIMARY KEY CHECK(id=1),
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run()
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS patient_manual_chunks (
    chunk_index INTEGER PRIMARY KEY,
    data BLOB NOT NULL
  )`).run()
}

export async function handlePatientManual(request:Request,env:Env,path:string):Promise<Response|null>{
  if(path!=='/api/admin/patient-manual'&&path!=='/api/patient/manual')return null
  await ensureManualSchema(env)

  if(path==='/api/admin/patient-manual'){
    if(request.method==='GET'){
      const manual=await env.DB.prepare('SELECT file_name,mime_type,size_bytes,updated_at FROM patient_manual_meta WHERE id=1').first<any>()
      return json({ok:true,manual:manual||null})
    }
    if(request.method==='DELETE'){
      await env.DB.batch([
        env.DB.prepare('DELETE FROM patient_manual_chunks'),
        env.DB.prepare('DELETE FROM patient_manual_meta WHERE id=1')
      ])
      return json({ok:true})
    }
    if(request.method==='POST'){
      const form=await request.formData()
      const file=form.get('manual')
      if(!(file instanceof File))return json({ok:false,message:'Selecione um arquivo PDF.'},400)
      if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf'))return json({ok:false,message:'O manual deve ser um arquivo PDF.'},400)
      if(file.size<=0||file.size>MAX_SIZE)return json({ok:false,message:'O PDF deve ter no máximo 8 MB.'},400)
      const bytes=new Uint8Array(await file.arrayBuffer())
      const statements=[env.DB.prepare('DELETE FROM patient_manual_chunks')]
      for(let offset=0,index=0;offset<bytes.length;offset+=CHUNK_SIZE,index++){
        statements.push(env.DB.prepare('INSERT INTO patient_manual_chunks(chunk_index,data) VALUES(?,?)').bind(index,bytes.slice(offset,Math.min(offset+CHUNK_SIZE,bytes.length))))
      }
      statements.push(env.DB.prepare(`INSERT INTO patient_manual_meta(id,file_name,mime_type,size_bytes,updated_at)
        VALUES(1,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET file_name=excluded.file_name,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,updated_at=CURRENT_TIMESTAMP`)
        .bind(file.name,'application/pdf',file.size))
      await env.DB.batch(statements)
      return json({ok:true,manual:{file_name:file.name,mime_type:'application/pdf',size_bytes:file.size}})
    }
    return json({ok:false,message:'Método não permitido.'},405)
  }

  if(request.method!=='GET')return json({ok:false,message:'Método não permitido.'},405)
  const meta=await env.DB.prepare('SELECT file_name,mime_type,size_bytes FROM patient_manual_meta WHERE id=1').first<any>()
  if(!meta)return json({ok:false,message:'Manual ainda não disponibilizado.'},404)
  const chunks=await env.DB.prepare('SELECT data FROM patient_manual_chunks ORDER BY chunk_index').all<any>()
  if(!chunks.results?.length)return json({ok:false,message:'Manual indisponível.'},404)
  const normalizeBytes=(raw:any):Uint8Array=>{
    if(raw instanceof ArrayBuffer)return new Uint8Array(raw)
    if(ArrayBuffer.isView(raw))return new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength)
    if(Array.isArray(raw))return Uint8Array.from(raw)
    if(raw&&typeof raw==='object')return Uint8Array.from(Object.keys(raw).sort((a,b)=>Number(a)-Number(b)).map(k=>Number(raw[k])))
    return new Uint8Array()
  }
  const parts=chunks.results.map((row:any)=>normalizeBytes(row.data))
  const total=parts.reduce((n:number,part:Uint8Array)=>n+part.byteLength,0)
  if(!total)return json({ok:false,message:'Manual indisponível.'},404)
  const out=new Uint8Array(total);let offset=0
  for(const part of parts){out.set(part,offset);offset+=part.byteLength}
  if(out[0]!==37||out[1]!==80||out[2]!==68||out[3]!==70)return json({ok:false,message:'O manual armazenado está corrompido. Envie o PDF novamente na área profissional.'},409)
  const safeName=String(meta.file_name||'Manual do Usuário.pdf').replace(/[\r\n"]/g,'')
  return new Response(out,{headers:{
    'content-type':'application/pdf',
    'content-length':String(out.byteLength),
    'content-disposition':`attachment; filename="manual-paciente.pdf"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    'cache-control':'private, no-store',
    'x-content-type-options':'nosniff'
  }})
}
