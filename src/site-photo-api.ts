import { readAdminSession } from './admin-session-reader'
import type { Env } from './types'

const json=(data:unknown,status=200,headers:HeadersInit={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}})
const MAX_SIZE=5*1024*1024
const CHUNK_SIZE=512*1024

async function requirePsychologist(request:Request,env:Env){
  const admin=await readAdminSession(request,env)
  if(!admin)return {admin:null,response:json({ok:false,message:'Acesso profissional necessário.'},401)}
  if(admin.role!=='psychologist')return {admin,response:json({ok:false,message:'Esta ação exige acesso de Psicóloga / Administrador.'},403)}
  return {admin,response:null}
}

function detectMime(bytes:Uint8Array){
  if(bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a)return'image/png'
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return'image/jpeg'
  if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return'image/webp'
  return null
}

function normalizeBytes(raw:any):Uint8Array{
  if(raw instanceof ArrayBuffer)return new Uint8Array(raw)
  if(ArrayBuffer.isView(raw))return new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength)
  if(Array.isArray(raw))return Uint8Array.from(raw)
  if(raw&&typeof raw==='object')return Uint8Array.from(Object.keys(raw).sort((a,b)=>Number(a)-Number(b)).map(k=>Number(raw[k])))
  return new Uint8Array()
}

function photoMeta(meta:any,includeFileName=false){
  if(!meta)return null
  const version=String(meta.version||meta.updated_at||'')
  return {
    ...(includeFileName?{file_name:String(meta.file_name||'foto-profissional')}:{ }),
    mime_type:String(meta.mime_type||'image/jpeg'),
    size_bytes:Number(meta.size_bytes||0),
    version,
    updated_at:meta.updated_at||null,
    url:`/api/site/professional-photo?v=${encodeURIComponent(version)}`,
  }
}

async function readMeta(env:Env){
  return env.DB.prepare('SELECT file_name,mime_type,size_bytes,version,updated_at FROM site_professional_photo_meta WHERE id=1').first<any>()
}

async function audit(env:Env,adminId:string,action:string,metadata?:unknown){
  await env.DB.prepare(`INSERT INTO audit_log (id,actor_type,actor_id,action,entity_type,entity_id,metadata_json) VALUES (?,'admin',? ,?,'site_professional_photo','1',?)`)
    .bind(crypto.randomUUID(),adminId,action,metadata?JSON.stringify(metadata):null).run()
}

export async function handleSitePhoto(request:Request,env:Env,path:string):Promise<Response|null>{
  const isAdmin=path==='/api/admin/site-photo'
  const isPublicPhoto=path==='/api/site/professional-photo'
  const isPublicMeta=path==='/api/site/professional-photo/meta'
  if(!isAdmin&&!isPublicPhoto&&!isPublicMeta)return null

  if(isAdmin){
    const auth=await requirePsychologist(request,env)
    if(auth.response)return auth.response

    if(request.method==='GET'){
      return json({ok:true,photo:photoMeta(await readMeta(env),true)})
    }

    if(request.method==='DELETE'){
      await env.DB.batch([
        env.DB.prepare('DELETE FROM site_professional_photo_chunks'),
        env.DB.prepare('DELETE FROM site_professional_photo_meta WHERE id=1'),
      ])
      await audit(env,auth.admin!.id,'site_photo_deleted')
      return json({ok:true,photo:null})
    }

    if(request.method==='POST'){
      const form=await request.formData()
      const file=form.get('photo')
      if(!(file instanceof File))return json({ok:false,message:'Selecione uma imagem para enviar.'},400)
      if(file.size<=0||file.size>MAX_SIZE)return json({ok:false,message:'A imagem deve ter no máximo 5 MB.'},400)

      const bytes=new Uint8Array(await file.arrayBuffer())
      const mimeType=detectMime(bytes)
      if(!mimeType)return json({ok:false,message:'Use uma imagem JPG, PNG ou WebP válida.'},400)

      const version=crypto.randomUUID()
      const statements=[env.DB.prepare('DELETE FROM site_professional_photo_chunks')]
      for(let offset=0,index=0;offset<bytes.length;offset+=CHUNK_SIZE,index++){
        statements.push(env.DB.prepare('INSERT INTO site_professional_photo_chunks(chunk_index,data) VALUES(?,?)')
          .bind(index,bytes.slice(offset,Math.min(offset+CHUNK_SIZE,bytes.length))))
      }
      statements.push(env.DB.prepare(`INSERT INTO site_professional_photo_meta(id,file_name,mime_type,size_bytes,version,updated_at)
        VALUES(1,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET file_name=excluded.file_name,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,version=excluded.version,updated_at=CURRENT_TIMESTAMP`)
        .bind(file.name||'foto-profissional',mimeType,file.size,version))
      await env.DB.batch(statements)
      await audit(env,auth.admin!.id,'site_photo_uploaded',{file_name:file.name,mime_type:mimeType,size_bytes:file.size})
      return json({ok:true,photo:photoMeta(await readMeta(env),true)})
    }

    return json({ok:false,message:'Método não permitido.'},405)
  }

  if(isPublicMeta){
    if(request.method!=='GET'&&request.method!=='HEAD')return json({ok:false,message:'Método não permitido.'},405)
    const photo=photoMeta(await readMeta(env))
    if(request.method==='HEAD')return new Response(null,{status:photo?200:404,headers:{'cache-control':'no-store'}})
    return json({ok:true,photo})
  }

  if(request.method!=='GET'&&request.method!=='HEAD')return json({ok:false,message:'Método não permitido.'},405)
  const meta=await readMeta(env)
  if(!meta)return json({ok:false,message:'Foto profissional ainda não cadastrada.'},404)
  const chunks=await env.DB.prepare('SELECT data FROM site_professional_photo_chunks ORDER BY chunk_index').all<any>()
  if(!chunks.results?.length)return json({ok:false,message:'Foto profissional indisponível.'},404)

  const parts=chunks.results.map((row:any)=>normalizeBytes(row.data))
  const total=parts.reduce((n:number,part:Uint8Array)=>n+part.byteLength,0)
  if(!total)return json({ok:false,message:'Foto profissional indisponível.'},404)
  const out=new Uint8Array(total);let offset=0
  for(const part of parts){out.set(part,offset);offset+=part.byteLength}
  const detected=detectMime(out)
  if(!detected||detected!==meta.mime_type)return json({ok:false,message:'A foto armazenada está corrompida. Envie a imagem novamente na área profissional.'},409)

  const headers={
    'content-type':String(meta.mime_type),
    'content-length':String(out.byteLength),
    'cache-control':'public, max-age=300',
    'etag':`"${String(meta.version)}"`,
    'x-content-type-options':'nosniff',
  }
  if(request.method==='HEAD')return new Response(null,{headers})
  return new Response(out,{headers})
}
