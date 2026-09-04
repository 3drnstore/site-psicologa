import type { Env } from './types'

const encoder=new TextEncoder(),decoder=new TextDecoder()
const VERSION='aes-256-gcm-envelope-v1'

function toBase64(bytes:Uint8Array){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary)}
function fromBase64(value:string){const binary=atob(value);const out=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);return out}

async function masterKey(env:Env){
  const secret=String(env.CLINICAL_MASTER_KEY||'').trim()
  if(!secret)throw new Error('CLINICAL_MASTER_KEY não configurada no Cloudflare.')
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(secret))
  return crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt','decrypt'])
}

export type ClinicalEnvelope={
  note_ciphertext:string
  note_iv:string
  wrapped_dek:string
  wrap_iv:string
  encryption_version:string
}

export async function encryptClinicalNote(plainText:string,env:Env):Promise<ClinicalEnvelope>{
  const dek=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt'])
  const noteIv=crypto.getRandomValues(new Uint8Array(12))
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:noteIv},dek,encoder.encode(plainText))
  const rawDek=new Uint8Array(await crypto.subtle.exportKey('raw',dek))
  const kek=await masterKey(env)
  const wrapIv=crypto.getRandomValues(new Uint8Array(12))
  const wrapped=await crypto.subtle.encrypt({name:'AES-GCM',iv:wrapIv},kek,rawDek)
  rawDek.fill(0)
  return {note_ciphertext:toBase64(new Uint8Array(ciphertext)),note_iv:toBase64(noteIv),wrapped_dek:toBase64(new Uint8Array(wrapped)),wrap_iv:toBase64(wrapIv),encryption_version:VERSION}
}

export async function decryptClinicalNote(envelope:ClinicalEnvelope,env:Env){
  if(envelope.encryption_version!==VERSION)throw new Error('Versão de criptografia clínica não suportada.')
  const kek=await masterKey(env)
  const rawDek=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(envelope.wrap_iv)},kek,fromBase64(envelope.wrapped_dek))
  const dek=await crypto.subtle.importKey('raw',rawDek,{name:'AES-GCM'},false,['decrypt'])
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(envelope.note_iv)},dek,fromBase64(envelope.note_ciphertext))
  return decoder.decode(plain)
}

export const CLINICAL_ENCRYPTION_VERSION=VERSION
