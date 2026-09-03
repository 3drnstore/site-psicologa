const encoder=new TextEncoder()
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(value:string){
  const clean=value.toUpperCase().replace(/[^A-Z2-7]/g,'')
  let bits='',out:number[]=[]
  for(const c of clean){const n=alphabet.indexOf(c);if(n<0)continue;bits+=n.toString(2).padStart(5,'0');while(bits.length>=8){out.push(parseInt(bits.slice(0,8),2));bits=bits.slice(8)}}
  return new Uint8Array(out)
}
function base32Encode(bytes:Uint8Array){let bits='',out='';for(const b of bytes)bits+=b.toString(2).padStart(8,'0');for(let i=0;i<bits.length;i+=5){const chunk=bits.slice(i,i+5).padEnd(5,'0');out+=alphabet[parseInt(chunk,2)]}return out}
export function newTotpSecret(){return base32Encode(crypto.getRandomValues(new Uint8Array(20)))}
async function codeAt(secret:string,counter:number){
  const key=await crypto.subtle.importKey('raw',base32Decode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign'])
  const msg=new ArrayBuffer(8),view=new DataView(msg);view.setUint32(4,counter,false)
  const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,msg)),offset=sig[sig.length-1]&15
  const n=((sig[offset]&127)<<24)|(sig[offset+1]<<16)|(sig[offset+2]<<8)|sig[offset+3]
  return String(n%1000000).padStart(6,'0')
}
export async function verifyTotp(secret:string,code:string,at=Date.now()){
  const clean=code.replace(/\D/g,'');if(clean.length!==6)return false
  const counter=Math.floor(at/30000)
  for(let drift=-1;drift<=1;drift++)if(await codeAt(secret,counter+drift)===clean)return true
  return false
}
export function totpUri(secret:string,email:string){return `otpauth://totp/${encodeURIComponent('PsicoGestão:'+email)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent('PsicoGestão')}&algorithm=SHA1&digits=6&period=30`}
